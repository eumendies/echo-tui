import * as composerOps from '../input/composer';
import {isShellInteractionMode} from '../types/agent';
import {expandConversationReferenceForUserText} from '../agent/context/conversation-reference';
import {expandFileMentionsForUserText} from './utils';

import type {AgentToolPolicy, InteractionMode, ReasoningEffort} from '../types/agent';
import type {SandboxModeOverride} from '../sandbox/types';
import type {CommandHostApp, CommandStartOptions, CommandStartResult} from '../types/command';
import type {ToolResultAttachment} from '../types/tool';
import type {PendingConversationReference, UserTranscriptMetadata, UserTranscriptRecord} from '../types/transcript';
import type {AppContext} from './state/app-context';

type AssistantTurnSubmission = {
  userText: string; // 最终发送给 agent 的用户文本，已包含文件和会话引用展开结果。
  userRequestText: string; // 用户在 composer 中实际提交的原始文本，不包含内部 prompt 或文件展开。
  displayText?: string; // transcript 中展示的原始或命令转换前文本。
  metadata?: UserTranscriptMetadata; // 与本次用户消息一起持久化的领域元数据。
  modelProfileIdOverride?: string; // skill 或 workflow 为本轮指定的模型配置。
  reasoningEffortOverride?: ReasoningEffort; // skill 或 workflow 为本轮指定的推理强度。
  toolPolicy?: AgentToolPolicy; // workflow 为本轮声明的运行级工具策略。
  sandboxModeOverride?: SandboxModeOverride; // workflow 为本轮声明的运行级沙箱收紧。
  attachments?: ToolResultAttachment[]; // 文件 mention 产生的多模态附件。
};

type SubmissionCommandPort = {
  hasActiveSession(): boolean; // 当前是否存在会阻止 composer 提交的命令会话。
  matches(text: string): boolean; // 文本是否命中任意 slash command，用于决定 pending 是否可被 claim。
  startFromText(text: string, options?: CommandStartOptions): CommandStartResult; // 尝试处理 slash 命令并返回后续提交路由。
};

type SubmitDraftOptions = {
  interactionMode?: InteractionMode; // 已接收的普通排队输入保留接收时选择，不读取后来界面值。
  conversationReference?: PendingConversationReference; // 本次提交捕获的历史会话引用。
  commandResult?: Extract<CommandStartResult, {kind: 'submit_user_message'}>; // 命令 handler 已解析的提交结果，跳过 slash 再解析。
  onAssistantTurnStarted?: () => void; // user turn 占用 response lock 后释放提交预处理锁。
};

type ComposerSubmissionControllerOptions = {
  appContext: AppContext; // 提供 composer、pending、turn 和引用等 app 语义状态。
  command: SubmissionCommandPort; // 负责 slash command 匹配与命令会话状态。
  reference: Pick<CommandHostApp['reference'], 'prepareForSubmission'>; // 在发送前生成最终会话引用投影。
  startAssistantTurn(submission: AssistantTurnSubmission): Promise<void>; // 进入真实 assistant turn 生命周期的领域边界。
  submitShellCommand(command: string): Promise<void>; // 在 shell mode 中执行已消费的 composer 文本。
  showReferenceError(error: string): void; // 展示引用准备失败的本地 surface。
  render(): void; // 提交被阻止或瞬时状态变化时刷新当前可见投影。
};

/**
 * 管理 composer 消费、pending 单槽 dispatch 和提交路由，确保同一草稿只记录与发送一次。
 */
class ComposerSubmissionController {
  private readonly appContext: AppContext;
  private readonly command: SubmissionCommandPort;
  private readonly reference: Pick<CommandHostApp['reference'], 'prepareForSubmission'>;
  private readonly startAssistantTurn: (submission: AssistantTurnSubmission) => Promise<void>;
  private readonly submitShellCommand: (command: string) => Promise<void>;
  private readonly showReferenceError: (error: string) => void;
  private readonly render: () => void;
  private startingPendingTurn = false;

  constructor(options: ComposerSubmissionControllerOptions) {
    this.appContext = options.appContext;
    this.command = options.command;
    this.reference = options.reference;
    this.startAssistantTurn = options.startAssistantTurn;
    this.submitShellCommand = options.submitShellCommand;
    this.showReferenceError = options.showReferenceError;
    this.render = options.render;
  }

  /**
   * 命令 handler 完成多步收集后提交用户消息；跳过 slash 再解析，复用附件展开、引用与 turn 生命周期。
   */
  async submitCommandMessage(input: {text: string; displayText?: string; metadata?: UserTranscriptMetadata}): Promise<boolean> {
    return this.submitDraft(input.text, {
      commandResult: {
        kind: 'submit_user_message',
        text: input.text,
        displayText: input.displayText,
        metadata: input.metadata
      }
    });
  }

  /**
   * 提交 live composer；活动 turn 按固定策略排队或准备引导，单槽被占用时保留新草稿及光标。
   */
  async submitComposer(): Promise<void> {
    // pending 正在抢占下一轮，或其他交互 surface/初始化流程已接管输入，此次 Enter 不提交 composer。
    if (this.startingPendingTurn || this.command.hasActiveSession() || this.appContext.conversationReferenceContext.isPreparing() || this.appContext.getMcpBootstrapStatus() === 'initializing') {
      this.render();
      return;
    }

    const hasActiveAssistantTurn = this.appContext.turnContext.canInterruptAssistantTurn();

    // response lock 已释放但单槽仍有消息时，优先发送旧 pending，避免当前草稿越过它。
    if (!hasActiveAssistantTurn && !this.appContext.turnContext.responding && this.appContext.pendingMessageContext.getPending()) {
      await this.dispatchPendingMessage();
      return;
    }

    // 非 assistant 流程仍占用 response lock，或 composer 没有内容时，不创建新提交。
    if ((!hasActiveAssistantTurn && this.appContext.turnContext.responding) || composerOps.isEmpty(this.appContext.composerContext.composer)) {
      this.render();
      return;
    }

    const userInput = composerOps.getText(this.appContext.composerContext.composer);
    const interactionMode = this.appContext.getInteractionMode();

    // assistant turn 运行期间先尝试响应期命令，未处理的输入才进入 pending 单槽。
    if (hasActiveAssistantTurn) {
      const commandResult = this.command.startFromText(userInput, {duringAssistantTurn: true});

      // 已允许的响应期命令已立即启动，只消费本次 composer，不改动已有 pending。
      if (commandResult.kind === 'handled') {
        this.consumeComposerInput(userInput);
        this.render();
        return;
      }

      const activeTurn = this.appContext.turnContext.activeAssistantTurn!;
      // slash（包括动态 skill/MCP）和 shell 必须保留下一轮路由；运行中不扩展引用选择。
      if (activeTurn.messagePolicy === 'steer' && !userInput.trimStart().startsWith('/')
        && !isShellInteractionMode(interactionMode)
        && !this.appContext.conversationReferenceContext.getPending()) {
        const messageId = this.appContext.pendingMessageContext.beginSteer(userInput, activeTurn.id);
        if (messageId === null) {
          this.render();
          return;
        }
        this.consumeComposerInput(userInput);
        this.render();
        await this.prepareSteeringMessage(messageId, userInput, interactionMode);
        return;
      }
    }

    // active turn 的 pending 单槽已被占用时，保留当前 composer 草稿，避免覆盖旧消息。
    const pendingMode = !userInput.trimStart().startsWith('/') && !isShellInteractionMode(interactionMode) ? interactionMode : undefined;
    if (hasActiveAssistantTurn && !this.appContext.pendingMessageContext.enqueue(userInput, pendingMode)) {
      this.render();
      return;
    }

    this.consumeComposerInput(userInput);

    // active turn 中的普通输入已成功排队，本次不启动新的 assistant turn。
    if (hasActiveAssistantTurn) {
      this.render();
      return;
    }

    const conversationReference = this.appContext.conversationReferenceContext.getPending();
    // 空闲提交在引用准备失败或取消时恢复尚未被新输入占用的 composer。
    if (!await this.submitDraft(userInput, {interactionMode: pendingMode, conversationReference: conversationReference || undefined})) {
      // 用户已在异步准备期间输入新草稿时，不用旧输入覆盖它。
      if (composerOps.isEmpty(this.appContext.composerContext.composer)) {
        this.appContext.composerContext.setText(userInput);
      }
      return;
    }

    await this.dispatchPendingMessage();
  }

  /**
   * response lock 和旧运行身份均释放后串行消费单槽，已准备素材直接移交；同步锁避免重复派发。
   */
  async dispatchPendingMessage(): Promise<void> {
    if (this.startingPendingTurn || this.appContext.turnContext.responding || this.appContext.turnContext.activeAssistantTurn) {
      return;
    }

    this.startingPendingTurn = true;
    try {
      // onComplete 已释放响应锁但旧 runner 仍在收尾时不创建新 checkpoint；外层提交收尾后再次派发。
      while (!this.appContext.turnContext.responding && !this.appContext.turnContext.activeAssistantTurn) {
        const pendingText = this.appContext.pendingMessageContext.getPending();
        if (this.command.hasActiveSession() && pendingText && this.command.matches(pendingText)) {
          // command surface 关闭前不 claim queued command，避免 runtime 将它降级成普通模型消息。
          return;
        }

        const pendingMessage = this.appContext.pendingMessageContext.claimForDispatch();
        if (!pendingMessage) {
          return;
        }

        if (pendingMessage.record) {
          const record = pendingMessage.record;
          // 已准备输入只在此移交一次；不重读文件、不重路由成 shell/命令，也不重复写入输入历史。
          const assistantTurn = this.startAssistantTurn({
            userText: record.text,
            userRequestText: pendingMessage.text,
            displayText: record.displayText,
            metadata: record.metadata,
            attachments: record.attachments
          });
          this.startingPendingTurn = false;
          await assistantTurn;
          continue;
        }

        await this.submitDraft(pendingMessage.text, {
          interactionMode: pendingMessage.interactionMode,
          onAssistantTurnStarted: () => {
            this.startingPendingTurn = false;
          }
        });
      }
    } finally {
      this.startingPendingTurn = false;
    }
  }

  /** 消费一次已接受的 live composer 输入，并保证 history 只记录一次。 */
  private consumeComposerInput(userInput: string): void {
    this.appContext.composerContext.leaveHistoryBrowsing();
    this.appContext.composerContext.recordInput(userInput);
    this.appContext.composerContext.reset();
  }

  /** 准备素材前捕获提交模式；引导拒绝失败读取，普通提交保留既有 unavailable 诊断。 */
  private async prepareUserRecord(userText: string, displayText?: string, metadata?: UserTranscriptMetadata, rejectFileErrors = false): Promise<UserTranscriptRecord> {
    const interactionMode = metadata?.interactionMode ?? this.appContext.getInteractionMode();
    const expanded = await expandFileMentionsForUserText(userText, this.appContext.getCurrentCwd(), {
      autoCompressImages: this.appContext.getAutoCompressImages()
    });
    if (rejectFileErrors && expanded.errors?.length) throw new Error(expanded.errors.join('; '));
    return {
      role: 'user',
      text: expanded.text,
      ...(displayText || expanded.text !== userText || expanded.attachments ? {displayText: displayText || userText} : {}),
      metadata: {...metadata, interactionMode},
      ...(expanded.attachments ? {attachments: expanded.attachments} : {})
    };
  }

  /** 槽位身份隔离准备完成；只有素材成功才通知抢占，失效 turn 则交给空闲 dispatcher。 */
  private async prepareSteeringMessage(messageId: number, userInput: string, interactionMode: InteractionMode): Promise<void> {
    let record: UserTranscriptRecord;
    try {
      record = await this.prepareUserRecord(userInput, undefined, {interactionMode}, true);
    } catch (error: unknown) {
      if (this.appContext.pendingMessageContext.failPreparation(messageId, error instanceof Error ? error.message : String(error))) this.render();
      return;
    }
    // 就绪通知或渲染异常属于运行错误，不应把准备成功的消息重新标成素材失败。
    if (!this.appContext.pendingMessageContext.completePreparation(messageId, record)) return;
    this.render();
    // 素材准备可能跨过原 turn 的结束；就绪后再尝试空闲派发，避免消息留在单槽中无人发送。
    // 原 turn 尚未收尾时 dispatcher 直接返回，消息仍由当前运行在安全边界应用。
    await this.dispatchPendingMessage();
  }

  /**
   * 处理已从 composer 消费的文本，依次执行命令、shell、文件 mention、引用和 assistant 路由。
   * 返回 false 时调用方应恢复原始 composer 文本。
   */
  private async submitDraft(userInput: string, options: SubmitDraftOptions = {}): Promise<boolean> {
    const conversationReference = options.conversationReference;
    const userRequestText = userInput;
    let userText = userInput;

    // 命令 handler 已解析的提交结果直接沿用；否则先尝试处理 slash command。
    const commandResult = options.commandResult ?? this.command.startFromText(userText);

    if (commandResult.kind === 'handled') {
      return true;
    }

    let displayText: string | undefined;
    let userMetadata: UserTranscriptMetadata | undefined;
    let modelProfileIdOverride: string | undefined;
    let reasoningEffortOverride: ReasoningEffort | undefined;
    let toolPolicy: AgentToolPolicy | undefined;
    let sandboxModeOverride: SandboxModeOverride | undefined;

    // shell mode，当作 shell command 执行。
    if (commandResult.kind === 'not_matched' && isShellInteractionMode(options.interactionMode ?? this.appContext.getInteractionMode())) {
      await this.submitShellCommand(userText);
      return true;
    }

    // workflow (/init /review) 和 direct skill invocation 会请求提交用户消息。
    if (commandResult.kind === 'submit_user_message') {
      userText = commandResult.text;
      displayText = commandResult.displayText;
      userMetadata = commandResult.metadata;
      modelProfileIdOverride = commandResult.modelProfileId;
      reasoningEffortOverride = commandResult.reasoningEffortOverride;
      toolPolicy = commandResult.toolPolicy;
      sandboxModeOverride = commandResult.sandboxModeOverride;
    }

    // file mention 在真正发送时读取文件
    const userRecord = await this.prepareUserRecord(userText, displayText, {
      ...userMetadata,
      ...(options.interactionMode ? {interactionMode: options.interactionMode} : {})
    });
    userText = userRecord.text;
    displayText = userRecord.displayText;
    userMetadata = userRecord.metadata;

    // 处理会话引用
    if (conversationReference) {
      displayText = displayText || userInput;

      // 引用素材选择时只保存中立快照；发送前才使用本轮 model/effort 完成全文或总结投影。
      const preparationResult = await this.reference.prepareForSubmission({
        modelProfileIdOverride,
        reference: conversationReference,
        reasoningEffortOverride
      });

      if (!preparationResult.ok) {
        if (preparationResult.reason === 'failed') {
          this.showReferenceError(preparationResult.error || '引用总结失败');
          this.render();
        }
        return false;
      }

      const preparedReference = preparationResult.reference;
      userText = expandConversationReferenceForUserText(preparedReference, userText);
      userMetadata = {
        ...(userMetadata || {}),
        conversationReference: {
          projectionMode: preparedReference.projectionMode,
          sourcePath: preparedReference.sourcePath,
          sourceSessionId: preparedReference.sourceSessionId,
          title: preparedReference.title
        }
      };

      this.appContext.conversationReferenceContext.clearPending();
    }

    // 真正发起请求
    const assistantTurn = this.startAssistantTurn({
      userText,
      userRequestText,
      displayText,
      metadata: userMetadata,
      modelProfileIdOverride,
      reasoningEffortOverride,
      toolPolicy,
      sandboxModeOverride,
      attachments: userRecord.attachments
    });
    options.onAssistantTurnStarted?.();
    await assistantTurn;
    return true;
  }
}

export {
  ComposerSubmissionController
};

export type {
  AssistantTurnSubmission,
  ComposerSubmissionControllerOptions,
  SubmissionCommandPort
};

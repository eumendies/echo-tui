import * as composerOps from '../input/composer';
import {isShellInteractionMode} from '../types/agent';
import {expandConversationReferenceForUserText} from '../agent/context/conversation-reference';
import {expandFileMentionsForUserText} from './utils';

import type {ReasoningEffort} from '../types/agent';
import type {CommandHostApp, CommandStartOptions, CommandStartResult} from '../types/command';
import type {ToolResultAttachment} from '../types/tool';
import type {PendingConversationReference, UserTranscriptMetadata} from '../types/transcript';
import type {AppContext} from './state/app-context';

type AssistantTurnSubmission = {
  userText: string; // 最终发送给 agent 的用户文本，已包含文件和会话引用展开结果。
  displayText?: string; // transcript 中展示的原始或命令转换前文本。
  metadata?: UserTranscriptMetadata; // 与本次用户消息一起持久化的领域元数据。
  modelProfileIdOverride?: string; // skill 或 workflow 为本轮指定的模型配置。
  reasoningEffortOverride?: ReasoningEffort; // skill 或 workflow 为本轮指定的推理强度。
  attachments?: ToolResultAttachment[]; // 文件 mention 产生的多模态附件。
};

type SubmissionCommandPort = {
  hasActiveSession(): boolean; // 当前是否存在会阻止 composer 提交的命令会话。
  matches(text: string): boolean; // 文本是否命中任意 slash command，用于决定 pending 是否可被 claim。
  startFromText(text: string, options?: CommandStartOptions): CommandStartResult; // 尝试处理 slash 命令并返回后续提交路由。
};

type SubmitDraftOptions = {
  conversationReference?: PendingConversationReference; // 本次提交捕获的历史会话引用。
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
   * 提交 live composer；活动 assistant turn 中把文本写入单槽，其他 response lock 保持阻止语义。
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

    // assistant turn 运行期间先尝试响应期命令，未处理的输入才进入 pending 单槽。
    if (hasActiveAssistantTurn) {
      const commandResult = this.command.startFromText(userInput, {duringAssistantTurn: true});

      // 已允许的响应期命令已立即启动，只消费本次 composer，不改动已有 pending。
      if (commandResult.kind === 'handled') {
        this.consumeComposerInput(userInput);
        this.render();
        return;
      }
    }

    // active turn 的 pending 单槽已被占用时，保留当前 composer 草稿，避免覆盖旧消息。
    if (hasActiveAssistantTurn && !this.appContext.pendingMessageContext.enqueue(userInput)) {
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
    if (!await this.submitDraft(userInput, {conversationReference: conversationReference || undefined})) {
      // 用户已在异步准备期间输入新草稿时，不用旧输入覆盖它。
      if (composerOps.isEmpty(this.appContext.composerContext.composer)) {
        this.appContext.composerContext.setText(userInput);
      }
      return;
    }

    await this.dispatchPendingMessage();
  }

  /**
   * response lock 释放后串行 claim 并发送 pending 单槽；同步锁避免完成与中断回调重复派发。
   */
  async dispatchPendingMessage(): Promise<void> {
    if (this.startingPendingTurn || this.appContext.turnContext.responding) {
      return;
    }

    this.startingPendingTurn = true;
    try {
      while (!this.appContext.turnContext.responding) {
        const pendingText = this.appContext.pendingMessageContext.getPending();
        if (this.command.hasActiveSession() && pendingText && this.command.matches(pendingText)) {
          // command surface 关闭前不 claim queued command，避免 runtime 将它降级成普通模型消息。
          return;
        }

        const pendingMessage = this.appContext.pendingMessageContext.claim();
        if (!pendingMessage) {
          return;
        }

        await this.submitDraft(pendingMessage, {
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

  /**
   * 处理已从 composer 消费的文本，依次执行命令、shell、文件 mention、引用和 assistant 路由。
   * 返回 false 时调用方应恢复原始 composer 文本。
   */
  private async submitDraft(userInput: string, options: SubmitDraftOptions = {}): Promise<boolean> {
    const conversationReference = options.conversationReference;
    let userText = userInput;

    // 先尝试处理slash command，若命中则直接返回。
    const commandResult = this.command.startFromText(userText);

    if (commandResult.kind === 'handled') {
      return true;
    }

    let displayText: string | undefined;
    let userMetadata: UserTranscriptMetadata | undefined;
    let userAttachments: ToolResultAttachment[] | undefined;
    let modelProfileIdOverride: string | undefined;
    let reasoningEffortOverride: ReasoningEffort | undefined;

    // shell mode，当作 shell command 执行。
    if (commandResult.kind === 'not_matched' && isShellInteractionMode(this.appContext.getInteractionMode())) {
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
    }

    // file mention 在真正发送时读取文件
    const expanded = await expandFileMentionsForUserText(userText, this.appContext.getCurrentCwd(), {
      autoCompressImages: this.appContext.getAutoCompressImages()
    });
    if (expanded.text !== userText || expanded.attachments) {
      displayText = displayText || userText;
      userText = expanded.text;
      userAttachments = expanded.attachments;
    }

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
      displayText,
      metadata: userMetadata,
      modelProfileIdOverride,
      reasoningEffortOverride,
      attachments: userAttachments
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

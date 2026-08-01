import * as composerOps from '../input/composer';
import {isShellInteractionMode} from '../types/agent';
import {expandConversationReferenceForUserText} from '../agent/context/conversation-reference';
import {expandFileMentionsForUserText} from './utils';

import type {ReasoningEffort} from '../types/agent';
import type {CommandHostApp, CommandStartResult} from '../types/command';
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
  startFromText(text: string): CommandStartResult; // 尝试处理 slash 命令并返回后续提交路由。
};

type ComposerSubmissionControllerOptions = {
  appContext: AppContext; // 提供 composer、pending、turn 和引用等 app 语义状态。
  command: SubmissionCommandPort; // 负责 slash command 匹配与命令会话状态。
  reference: Pick<CommandHostApp['reference'], 'prepareForSubmission'>; // 在发送前生成最终会话引用投影。
  startAssistantTurn(submission: AssistantTurnSubmission): Promise<void>; // 进入真实 assistant turn 生命周期的领域边界。
  submitShellCommand(command: string): Promise<void>; // 在 shell mode 中执行已消费的 composer 文本。
  showReferenceError(error: string): void; // 展示引用准备失败的本地 surface。
  renderFooter(): void; // 提交被阻止或瞬时状态变化时重绘 footer。
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
  private readonly renderFooter: () => void;
  private dispatchingPendingMessage = false;

  constructor(options: ComposerSubmissionControllerOptions) {
    this.appContext = options.appContext;
    this.command = options.command;
    this.reference = options.reference;
    this.startAssistantTurn = options.startAssistantTurn;
    this.submitShellCommand = options.submitShellCommand;
    this.showReferenceError = options.showReferenceError;
    this.renderFooter = options.renderFooter;
  }

  /**
   * 提交 live composer；活动 assistant turn 中把文本写入单槽，其他 response lock 保持阻止语义。
   */
  async submitComposer(): Promise<void> {
    if (this.dispatchingPendingMessage || this.command.hasActiveSession() || this.appContext.conversationReferenceContext.isPreparing() || this.appContext.getMcpBootstrapStatus() === 'initializing') {
      this.renderFooter();
      return;
    }

    const hasActiveAssistantTurn = this.appContext.turnContext.canInterruptAssistantTurn();

    if (!hasActiveAssistantTurn && !this.appContext.turnContext.responding && this.appContext.pendingMessageContext.getPending()) {
      await this.dispatchPendingMessage();
      return;
    }

    if ((!hasActiveAssistantTurn && this.appContext.turnContext.responding) || composerOps.isEmpty(this.appContext.composerContext.composer)) {
      this.renderFooter();
      return;
    }

    const userInput = composerOps.getText(this.appContext.composerContext.composer);
    if (hasActiveAssistantTurn && !this.appContext.pendingMessageContext.enqueue(userInput)) {
      this.renderFooter();
      return;
    }

    this.appContext.composerContext.leaveHistoryBrowsing();
    this.appContext.composerContext.recordInput(userInput);
    this.appContext.composerContext.reset();

    if (hasActiveAssistantTurn) {
      this.renderFooter();
      return;
    }

    const conversationReference = this.appContext.conversationReferenceContext.getPending();
    if (!await this.submitDraft(userInput, conversationReference || undefined)) {
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
    if (this.dispatchingPendingMessage || this.appContext.turnContext.responding) {
      return;
    }

    this.dispatchingPendingMessage = true;
    try {
      while (!this.appContext.turnContext.responding) {
        const pendingMessage = this.appContext.pendingMessageContext.claim();
        if (!pendingMessage) {
          return;
        }

        await this.submitDraft(pendingMessage);
      }
    } finally {
      this.dispatchingPendingMessage = false;
    }
  }

  /**
   * 处理已从 composer 消费的文本，依次执行命令、shell、文件 mention、引用和 assistant 路由。
   * 返回 false 时调用方应恢复原始 composer 文本。
   */
  private async submitDraft(userInput: string, conversationReference?: PendingConversationReference): Promise<boolean> {
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
          this.renderFooter();
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
    await this.startAssistantTurn({
      userText,
      displayText,
      metadata: userMetadata,
      modelProfileIdOverride,
      reasoningEffortOverride,
      attachments: userAttachments
    });
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

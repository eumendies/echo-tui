import * as composerOps from '../input/composer';
import {INPUT_EVENTS} from '../input/event-types';
import {createKeyParser} from '../input/key-parser';
import {isShellInteractionMode} from '../types/agent';

import type {InputEvent} from '../types/input';
import type {AppContext} from './state/app-context';
import type {FilePickerContext} from './state/file-picker-context';
import type {ToolApprovalContext} from './state/tool-approval-context';
import type {UserQuestionContext} from './state/user-question-context';

type InputCommandPort = {
  hasActiveSession(): boolean; // 当前是否由 command session 独占输入。
  handleEvent(event: InputEvent): Promise<void> | undefined; // 把事件交给活跃 command session。
};

type LocalSurfacePort = {
  hasActive(): boolean; // 是否存在由 main 持有的 reference/MCP info surface。
  dismiss(): void; // 按 main 定义的优先级关闭当前本地 surface。
};

type InputEventControllerOptions = {
  appContext: AppContext; // 提供 composer、turn、mode、pending 和 suggestion 语义状态。
  userQuestion: Pick<UserQuestionContext, 'hasActiveRequest' | 'handleEvent'>; // 最高优先级的用户问题 modal。
  toolApproval: Pick<ToolApprovalContext, 'hasActiveRequest' | 'handleEvent' | 'toggleAllowAllForSession'>; // 工具审批 modal 与会话快捷键。
  filePicker: Pick<FilePickerContext, 'hasActiveRequest' | 'handleEvent' | 'open'>; // 文件选择 surface 与 @ 触发入口。
  command: InputCommandPort; // 活跃 slash command session 的输入端口。
  localSurface: LocalSurfacePort; // main 持有的 reference error 和 MCP diagnostic surface。
  cancelReferencePreparation(): void; // 取消发送前运行中的会话引用总结。
  dispatchPendingMessage(): Promise<void>; // command session 关闭后重试尚未 claim 的 queued command。
  submitComposer(): Promise<void>; // 提交或排队 live composer。
  interruptActiveShellCommand(): boolean; // 尝试中断当前 shell mode 进程。
  interruptActiveTurn(): boolean; // 尝试中断当前 assistant turn。
  exit(): void; // 执行 app 退出与终端清理。
  renderFooter(): void; // 瞬时输入状态变化后重绘 footer。
};

/**
 * 持有跨 chunk key parser，并按固定优先级把输入事件路由到 modal、surface、composer 和生命周期动作。
 */
class InputEventController {
  private readonly appContext: AppContext;
  private readonly userQuestion: Pick<UserQuestionContext, 'hasActiveRequest' | 'handleEvent'>;
  private readonly toolApproval: Pick<ToolApprovalContext, 'hasActiveRequest' | 'handleEvent' | 'toggleAllowAllForSession'>;
  private readonly filePicker: Pick<FilePickerContext, 'hasActiveRequest' | 'handleEvent' | 'open'>;
  private readonly command: InputCommandPort;
  private readonly localSurface: LocalSurfacePort;
  private readonly cancelReferencePreparation: () => void;
  private readonly dispatchPendingMessage: () => Promise<void>;
  private readonly submitComposer: () => Promise<void>;
  private readonly interruptActiveShellCommand: () => boolean;
  private readonly interruptActiveTurn: () => boolean;
  private readonly exit: () => void;
  private readonly renderFooter: () => void;
  private readonly keyParser = createKeyParser();

  constructor(options: InputEventControllerOptions) {
    this.appContext = options.appContext;
    this.userQuestion = options.userQuestion;
    this.toolApproval = options.toolApproval;
    this.filePicker = options.filePicker;
    this.command = options.command;
    this.localSurface = options.localSurface;
    this.cancelReferencePreparation = options.cancelReferencePreparation;
    this.dispatchPendingMessage = options.dispatchPendingMessage;
    this.submitComposer = options.submitComposer;
    this.interruptActiveShellCommand = options.interruptActiveShellCommand;
    this.interruptActiveTurn = options.interruptActiveTurn;
    this.exit = options.exit;
    this.renderFooter = options.renderFooter;
  }

  /**
   * 解析一个 stdin chunk，并等待该 chunk 中所有异步 command/submit 处理完成。
   */
  readonly handleChunk = (chunk: string | Buffer): Promise<void> => {
    const pendingWork: Array<Promise<void>> = [];

    for (const event of this.keyParser.parse(chunk)) {
      const result = this.handleEvent(event);

      if (result) {
        pendingWork.push(result);
      }
    }

    return Promise.all(pendingWork).then(() => undefined);
  };

  /**
   * 按既有 surface 和快捷键优先级处理单个语义输入事件。
   */
  readonly handleEvent = (event: InputEvent): Promise<void> | void => {
    if (this.userQuestion.hasActiveRequest()) {
      this.userQuestion.handleEvent(event);
      return undefined;
    }

    if (this.toolApproval.hasActiveRequest()) {
      this.toolApproval.handleEvent(event);
      return undefined;
    }

    if (this.filePicker.hasActiveRequest()) {
      this.filePicker.handleEvent(event);
      return undefined;
    }

    if (this.command.hasActiveSession()) {
      const result = this.command.handleEvent(event);
      const dispatchAfterClose = (): void => {
        // queued command 等当前 surface 关闭后，才能回到正常 command runtime 路由。
        if (!this.command.hasActiveSession()) {
          void this.dispatchPendingMessage();
        }
      };

      if (result) {
        return result.then(dispatchAfterClose);
      }

      dispatchAfterClose();
      return undefined;
    }

    if (this.appContext.conversationReferenceContext.isPreparing()) {
      if (event.type === INPUT_EVENTS.ESCAPE) {
        this.cancelReferencePreparation();
      } else if (event.type === INPUT_EVENTS.EXIT) {
        this.exit();
      }
      return undefined;
    }

    if (this.localSurface.hasActive()) {
      if (event.type === INPUT_EVENTS.EXIT) {
        this.exit();
        return undefined;
      }

      if (event.type === INPUT_EVENTS.ESCAPE || event.type === INPUT_EVENTS.SUBMIT) {
        this.localSurface.dismiss();
        this.renderFooter();
      }
      return undefined;
    }

    if (this.appContext.handleModelTuningEvent(event)) {
      this.renderFooter();
      return undefined;
    }

    if (event.type === INPUT_EVENTS.TOGGLE_MODEL_TUNING) {
      this.appContext.openModelTuning();
      this.renderFooter();
      return undefined;
    }

    if (event.type === INPUT_EVENTS.SHIFT_TAB) {
      this.toolApproval.toggleAllowAllForSession();
      return undefined;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === '@' && !isShellInteractionMode(this.appContext.getInteractionMode())) {
      this.appContext.composerContext.leaveHistoryBrowsing();
      composerOps.insertText(this.appContext.composerContext.composer, '@');
      this.filePicker.open(this.appContext.composerContext.composer.cursor - 1);
      return undefined;
    }

    if (this.appContext.getMcpBootstrapStatus() !== 'initializing' && this.appContext.handleSlashSuggestionEvent(event)) {
      this.renderFooter();
      return undefined;
    }

    if (event.type === INPUT_EVENTS.TAB) {
      if (!this.appContext.turnContext.responding && this.appContext.getMcpBootstrapStatus() !== 'initializing') {
        this.appContext.cycleInteractionMode();
      }
      this.renderFooter();
      return undefined;
    }

    if (composerOps.applyComposerEditEvent(this.appContext.composerContext.composer, event)) {
      this.appContext.composerContext.leaveHistoryBrowsing();
      this.renderFooter();
      return undefined;
    }

    switch (event.type) {
      case INPUT_EVENTS.MOVE_UP:
        if (!this.appContext.composerContext.browseHistory(-1)) {
          composerOps.moveUp(this.appContext.composerContext.composer);
        }
        this.renderFooter();
        return undefined;
      case INPUT_EVENTS.MOVE_DOWN:
        if (!this.appContext.composerContext.browseHistory(1)) {
          composerOps.moveDown(this.appContext.composerContext.composer);
        }
        this.renderFooter();
        return undefined;
      case INPUT_EVENTS.INSERT_NEWLINE:
        this.appContext.composerContext.leaveHistoryBrowsing();
        composerOps.insertNewline(this.appContext.composerContext.composer);
        this.renderFooter();
        return undefined;
      case INPUT_EVENTS.ESCAPE:
        if (this.appContext.pendingMessageContext.getPending()) {
          this.appContext.pendingMessageContext.clear();
          this.renderFooter();
          return undefined;
        }
        if (this.appContext.conversationReferenceContext.getPending()) {
          this.appContext.conversationReferenceContext.clearPending();
          this.renderFooter();
          return undefined;
        }
        if (this.interruptActiveShellCommand()) {
          return undefined;
        }
        if (this.interruptActiveTurn()) {
          return undefined;
        }
        return undefined;
      case INPUT_EVENTS.SUBMIT:
        return this.submitComposer();
      case INPUT_EVENTS.EXIT:
        this.exit();
        return undefined;
      default:
        return undefined;
    }
  };
}

export {
  InputEventController
};

export type {
  InputCommandPort,
  InputEventControllerOptions,
  LocalSurfacePort
};

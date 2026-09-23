import * as composerOps from '../input/composer';
import {INPUT_EVENTS} from '../input/event-types';
import {createKeyParser} from '../input/key-parser';
import {isShellInteractionMode} from '../types/agent';

import type {InputEvent} from '../types/input';
import {ActiveInputResolver} from './active-input-resolver';
import type {AppContext} from './state/app-context';
import type {FooterPointerController} from './footer-pointer-controller';

type InputEventControllerOptions = {
  appContext: AppContext; // 提供普通 composer fallback 所需的状态与语义方法。
  resolver: ActiveInputResolver; // 按唯一注册顺序解析当前非协议输入消费者。
  openFilePicker(triggerStart: number): void; // 普通 composer 输入 @ 后打开文件选择器。
  openSubagentView(): void; // Ctrl+O 在没有 active surface 时尝试打开子 Agent窗口。
  toggleAllowAllForSession(): void; // 普通输入态 Shift+Tab 的工具授权快捷键。
  submitComposer(): Promise<void>; // 提交或排队 live composer。
  interruptActiveShellCommand(): boolean; // 尝试中断当前 shell mode 进程。
  interruptActiveTurn(): boolean; // 尝试中断当前 assistant turn。
  exit(): void; // 执行 app 退出与终端清理。
  render(): void; // 瞬时输入状态变化后刷新当前可见投影。
  pointer?: Pick<FooterPointerController, 'handleEvent'>; // footer 鼠标命中与 CPR 的临时控制器。
};

/**
 * 持有跨 chunk key parser，并将协议事件、active consumer 与普通 composer fallback 保持在同一输入协调边界。
 */
class InputEventController {
  private readonly appContext: AppContext;
  private readonly resolver: ActiveInputResolver;
  private readonly openFilePicker: (triggerStart: number) => void;
  private readonly openSubagentView: () => void;
  private readonly toggleAllowAllForSession: () => void;
  private readonly submitComposer: () => Promise<void>;
  private readonly interruptActiveShellCommand: () => boolean;
  private readonly interruptActiveTurn: () => boolean;
  private readonly exit: () => void;
  private readonly render: () => void;
  private readonly pointer: Pick<FooterPointerController, 'handleEvent'> | null;
  private readonly keyParser = createKeyParser();
  private lastInputAt = 0;

  constructor(options: InputEventControllerOptions) {
    this.appContext = options.appContext;
    this.resolver = options.resolver;
    this.openFilePicker = options.openFilePicker;
    this.openSubagentView = options.openSubagentView;
    this.toggleAllowAllForSession = options.toggleAllowAllForSession;
    this.submitComposer = options.submitComposer;
    this.interruptActiveShellCommand = options.interruptActiveShellCommand;
    this.interruptActiveTurn = options.interruptActiveTurn;
    this.exit = options.exit;
    this.render = options.render;
    this.pointer = options.pointer || null;
  }

  /**
   * 解析一个 stdin chunk，并等待该 chunk 中所有异步 command/submit 处理完成。
   */
  readonly handleChunk = (chunk: string | Buffer): Promise<void> => {
    this.lastInputAt = Date.now();
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
   * 优先消费终端协议事件，再把语义事件交给 resolver 的当前消费者；只有明确放行时才进入 composer fallback。
   */
  readonly handleEvent = (event: InputEvent): Promise<void> | void => {
    this.lastInputAt = Date.now();
    if (this.pointer?.handleEvent(event)) {
      return undefined;
    }

    const consumer = this.resolver.resolve();

    if (!consumer) {
      return this.handleComposerFallback(event);
    }

    const result = consumer.handleEvent(event);

    if (isPromiseLike(result)) {
      return result.then((handled) => {
        if (handled === false) {
          return this.handleComposerFallback(event);
        }
      });
    }

    return result === false ? this.handleComposerFallback(event) : undefined;
  };

  /**
   * 处理没有 active surface 消费的主 composer 事件；此处保留历史、模式、@、Esc 与提交的既有顺序。
   */
  private handleComposerFallback(event: InputEvent): Promise<void> | void {
    if (event.type === INPUT_EVENTS.OPEN_SUBAGENT_VIEW) {
      this.openSubagentView();
      return undefined;
    }

    if (event.type === INPUT_EVENTS.TOGGLE_MODEL_TUNING) {
      this.appContext.openModelTuning();
      this.render();
      return undefined;
    }

    if (event.type === INPUT_EVENTS.SHIFT_TAB) {
      this.toggleAllowAllForSession();
      return undefined;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === '@' && !isShellInteractionMode(this.appContext.getInteractionMode())) {
      this.appContext.composerContext.leaveHistoryBrowsing();
      composerOps.insertText(this.appContext.composerContext.composer, '@');
      this.openFilePicker(this.appContext.composerContext.composer.cursor - 1);
      return undefined;
    }

    if (event.type === INPUT_EVENTS.TAB) {
      if (!this.appContext.turnContext.responding && this.appContext.getMcpBootstrapStatus() !== 'initializing') {
        this.appContext.cycleInteractionMode();
      }
      this.render();
      return undefined;
    }

    if (composerOps.applyComposerEditEvent(this.appContext.composerContext.composer, event)) {
      this.appContext.composerContext.leaveHistoryBrowsing();
      this.render();
      return undefined;
    }

    switch (event.type) {
      case INPUT_EVENTS.MOVE_UP:
        if (!this.appContext.composerContext.browseHistory(-1)) {
          composerOps.moveUp(this.appContext.composerContext.composer);
        }
        this.render();
        return undefined;
      case INPUT_EVENTS.MOVE_DOWN:
        if (!this.appContext.composerContext.browseHistory(1)) {
          composerOps.moveDown(this.appContext.composerContext.composer);
        }
        this.render();
        return undefined;
      case INPUT_EVENTS.INSERT_NEWLINE:
        this.appContext.composerContext.leaveHistoryBrowsing();
        composerOps.insertNewline(this.appContext.composerContext.composer);
        this.render();
        return undefined;
      case INPUT_EVENTS.ESCAPE:
        if (this.appContext.pendingMessageContext.getPending()) {
          this.appContext.pendingMessageContext.clear();
          this.render();
          return undefined;
        }
        if (this.appContext.conversationReferenceContext.getPending()) {
          this.appContext.conversationReferenceContext.clearPending();
          this.render();
          return undefined;
        }
        if (this.interruptActiveShellCommand()) {
          return undefined;
        }
        this.interruptActiveTurn();
        return undefined;
      case INPUT_EVENTS.SUBMIT:
        return this.submitComposer();
      case INPUT_EVENTS.EXIT:
        this.exit();
        return undefined;
      default:
        return undefined;
    }
  }

  /**
   * 返回最近一次输入事件的毫秒时间戳；0 表示本实例尚未收到输入。更新提示的空闲门控读取该值。
   */
  getLastInputAt(): number {
    return this.lastInputAt;
  }
}

function isPromiseLike(value: unknown): value is Promise<boolean | void> {
  return Boolean(value && typeof value === 'object' && 'then' in value && typeof value.then === 'function');
}

export {
  InputEventController
};

export type {
  InputEventControllerOptions
};

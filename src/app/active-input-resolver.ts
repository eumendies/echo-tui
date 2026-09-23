import {INPUT_EVENTS} from '../input/event-types';

import type {CommandSurface} from '../types/command';
import type {InputEvent} from '../types/input';
import type {FooterMouseTarget} from '../types/render';
import type {AutoUpdateController} from './auto-update-controller';
import type {FilePickerContext} from './state/file-picker-context';
import type {AppContext} from './state/app-context';
import type {ToolApprovalContext} from './state/tool-approval-context';
import type {UserQuestionContext} from './state/user-question-context';
import type {SubagentViewController} from './subagent-view-controller';

type FooterRenderOwner = 'view' | 'btw' | 'main';

type InputConsumerResult = boolean | void | Promise<boolean | void>;

type InputConsumer = {
  id: string; // 在一次 footer frame 与当前输入仲裁之间关联的稳定身份。
  isActive(): boolean; // 返回该消费者此刻是否应优先接收语义输入。
  handleEvent(event: InputEvent): InputConsumerResult; // 处理键盘语义事件；仅 false 表示继续交给低优先级 fallback。
  getSurface?(owner: FooterRenderOwner): CommandSurface | null; // 按当前可见 owner 返回可投影的 footer surface；无 surface 时省略。
  isModal?: boolean; // 标识全局 modal 层，供更新提示门控和静态 footer 重绘判断。
  canHandlePointer?(): boolean; // 返回当前 surface 是否实际支持 pointer，false 时不得因候选 region 启用鼠标协议。
  handlePointer?(target: FooterMouseTarget, activate: boolean): InputConsumerResult; // 处理已校准命中的鼠标语义 target；省略表示只支持键盘。
};

type PointerInputConsumer = InputConsumer & {
  handlePointer(target: FooterMouseTarget, activate: boolean): InputConsumerResult; // 已验证 identity 的 hover 或左键激活语义入口。
};

type CommandInputPort = {
  getSurface(): CommandSurface | null; // 返回当前 command session 的瞬时 footer surface。
  handleEvent(event: InputEvent): Promise<void> | undefined; // 将输入交给活跃 command session。
  handlePointer(target: FooterMouseTarget, activate: boolean): Promise<void> | undefined; // 转发已校准的 command 语义命中。
  hasActiveSession(): boolean; // 标识 command session 是否正在独占输入。
  hasPointerHandler(): boolean; // 仅当当前 handler 显式支持时才允许投影 executable identity。
};

type LocalInputSurfacePort = {
  dismiss(): void; // 按调用方既有优先级关闭当前本地 info surface。
  getSurface(): CommandSurface | null; // 返回 reference/MCP 等 main 持有的本地 surface。
};

type ActiveInputRoutingOptions = {
  appContext: AppContext; // 提供 reference、model tuning、slash suggestion 与普通 app 瞬时状态。
  autoUpdate: Pick<AutoUpdateController, 'getSurface' | 'handleEvent' | 'hasActiveRequest'>; // 最低优先级更新 modal。
  cancelReferencePreparation(): void; // 取消仍在准备中的会话引用总结。
  command: CommandInputPort; // 活跃 slash command session 的输入与 surface 端口。
  dispatchPendingMessage(): Promise<void>; // command session 关闭后重新尝试 queued message。
  exit(): void; // 保留 reference/local surface 对 Exit 的全局退出语义。
  filePicker: Pick<FilePickerContext, 'getSurface' | 'handleEvent' | 'handlePointerEntry' | 'hasActiveRequest'>; // composer @ 文件选择 surface。
  localSurface: LocalInputSurfacePort; // main 持有的 reference error 与 MCP diagnostic surface。
  render(): void; // 需要主动重绘的 model/slash/local 语义入口。
  subagentView: Pick<SubagentViewController, 'handleEvent' | 'isActive'>; // 只读子 Agent窗口输入端口。
  toolApproval: Pick<ToolApprovalContext, 'getSurface' | 'handleEvent' | 'handlePointerOption' | 'hasActiveRequest'>; // 工具审批 modal。
  userQuestion: Pick<UserQuestionContext, 'getSurface' | 'handleEvent' | 'handlePointerOption' | 'handlePointerTab' | 'hasActiveRequest'>; // 用户问题 modal。
};

/**
 * 按组合根给定的固定顺序解析当前有效输入消费者；不缓存 active 状态，避免异步 modal 关闭后需要手工恢复下层。
 */
class ActiveInputResolver {
  private readonly consumers: readonly InputConsumer[];

  constructor(consumers: readonly InputConsumer[]) {
    this.consumers = consumers;
  }

  /** 返回当前最高优先级消费者；没有 active 状态时交由普通 composer fallback。 */
  resolve(): InputConsumer | null {
    return this.consumers.find((consumer) => consumer.isActive()) || null;
  }

  /** 返回当前有效消费者可展示的 footer surface；owner 边界由消费者自身保持。 */
  getSurface(owner: FooterRenderOwner): CommandSurface | null {
    return this.resolve()?.getSurface?.(owner) || null;
  }

  /** 返回当前 active modal 的 surface，供不应周期重绘静态卡片的调用点判断。 */
  getActiveModalSurface(): CommandSurface | null {
    for (const consumer of this.consumers) {
      if (consumer.isModal && consumer.isActive()) {
        return consumer.getSurface?.('main') || null;
      }
    }
    return null;
  }

  /** 检查是否存在非指定消费者的 active 输入层，用于自动更新等空闲门控。 */
  hasActiveExcept(excludedId: string): boolean {
    return this.consumers.some((consumer) => consumer.id !== excludedId && consumer.isActive());
  }

  /** 仅在当前有效消费者显式支持 pointer 语义时返回它，防止布局类别推断业务处理者。 */
  getPointerConsumer(): PointerInputConsumer | null {
    const consumer = this.resolve();
    return consumer?.handlePointer && consumer.canHandlePointer?.() !== false ? consumer as PointerInputConsumer : null;
  }
}

/**
 * 在 resolver 所在模块组装现有 app 状态的 consumer adapter 与唯一优先级，避免 main.ts 同时承担生命周期和长责任链。
 */
function createActiveInputRouting(options: ActiveInputRoutingOptions): ActiveInputResolver {
  return new ActiveInputResolver([
    {
      id: 'user-question',
      isActive: () => options.userQuestion.hasActiveRequest(),
      handleEvent: (event) => options.userQuestion.handleEvent(event),
      getSurface: () => options.userQuestion.getSurface(),
      isModal: true,
      handlePointer(target, activate) {
        if (target.kind === 'choice_option') {
          return options.userQuestion.handlePointerOption(target.index, activate && !target.inlineInput);
        }
        return target.kind === 'choice_tab' ? options.userQuestion.handlePointerTab(target.index) : false;
      }
    },
    {
      id: 'tool-approval',
      isActive: () => options.toolApproval.hasActiveRequest(),
      handleEvent: (event) => options.toolApproval.handleEvent(event),
      getSurface: () => options.toolApproval.getSurface(),
      isModal: true,
      handlePointer(target, activate) {
        return target.kind === 'choice_option'
          ? options.toolApproval.handlePointerOption(target.index, activate && !target.inlineInput)
          : false;
      }
    },
    {
      id: 'file-picker',
      isActive: () => options.filePicker.hasActiveRequest(),
      handleEvent(event) {
        options.filePicker.handleEvent(event);
        return true;
      },
      getSurface: () => options.filePicker.getSurface(),
      isModal: true,
      handlePointer(target, activate) {
        return target.kind === 'file_picker_entry'
          ? options.filePicker.handlePointerEntry(target.index, activate)
          : false;
      }
    },
    {
      id: 'auto-update',
      isActive: () => options.autoUpdate.hasActiveRequest(),
      handleEvent: (event) => options.autoUpdate.handleEvent(event),
      getSurface: () => options.autoUpdate.getSurface(),
      isModal: true
    },
    {
      id: 'subagent-view',
      isActive: () => options.subagentView.isActive(),
      handleEvent: (event) => options.subagentView.handleEvent(event)
    },
    {
      id: 'command-session',
      isActive: () => options.command.hasActiveSession(),
      handleEvent(event) {
        const result = options.command.handleEvent(event);
        const dispatchAfterClose = (): void => {
          // queued command 只能在当前 session 已关闭后回到普通提交路径。
          if (!options.command.hasActiveSession()) {
            void options.dispatchPendingMessage();
          }
        };

        if (result) {
          return result.then(() => {
            dispatchAfterClose();
            return true;
          });
        }

        dispatchAfterClose();
        return true;
      },
      getSurface: (owner) => owner === 'main' ? options.command.getSurface() : null,
      canHandlePointer: () => options.command.hasPointerHandler(),
      handlePointer: (target, activate) => options.command.handlePointer(target, activate)
    },
    {
      id: 'reference-preparation',
      isActive: () => options.appContext.conversationReferenceContext.isPreparing(),
      handleEvent(event) {
        if (event.type === INPUT_EVENTS.ESCAPE) {
          options.cancelReferencePreparation();
        } else if (event.type === INPUT_EVENTS.EXIT) {
          options.exit();
        }
        return true;
      }
    },
    {
      id: 'local-info',
      isActive: () => options.localSurface.getSurface() !== null,
      handleEvent(event) {
        if (event.type === INPUT_EVENTS.EXIT) {
          options.exit();
        } else if (event.type === INPUT_EVENTS.ESCAPE || event.type === INPUT_EVENTS.SUBMIT) {
          options.localSurface.dismiss();
          options.render();
        }
        return true;
      },
      getSurface: (owner) => owner === 'main' ? options.localSurface.getSurface() : null
    },
    {
      id: 'model-tuning',
      isActive: () => options.appContext.modelTuningContext.isActive(),
      handleEvent(event) {
        const handled = options.appContext.handleModelTuningEvent(event);
        if (handled) {
          options.render();
        }
        return handled;
      }
    },
    {
      id: 'slash-suggestion',
      isActive: () => options.appContext.getMcpBootstrapStatus() !== 'initializing' && options.appContext.getSlashSuggestionState() !== null,
      handleEvent(event) {
        const handled = options.appContext.handleSlashSuggestionEvent(event);
        if (handled) {
          options.render();
        }
        return handled;
      },
      handlePointer(target, activate) {
        if (target.kind !== 'slash_suggestion') {
          return false;
        }
        const handled = options.appContext.handleSlashSuggestionPointer(target.index, activate);
        if (handled) {
          options.render();
        }
        return handled;
      }
    }
  ]);
}

export {
  ActiveInputResolver,
  createActiveInputRouting
};

export type {
  ActiveInputRoutingOptions,
  FooterRenderOwner,
  InputConsumer,
  InputConsumerResult,
  PointerInputConsumer
};

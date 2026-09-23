import {INPUT_EVENTS} from '../../input/event-types';

import type {
  CommandHost,
  CommandRuntimeDependencies,
  CommandStartOptions,
  CommandStartResult,
  CommandSession,
  CommandSessionPatch,
  CommandSurface
} from '../../types/command';
import type {InputEvent, MouseWheelDirection} from '../../types/input';
import type {FooterMouseTarget, FooterWheelPane} from '../../types/render';

/**
 * 创建 slash command runtime，集中管理命令会话、surface 快照和会话内事件分发。
 *
 * runtime 不解释业务 effect；handler 通过 CommandHost 直接调用受控 app 能力。
 */
function createCommandRuntime(dependencies: CommandRuntimeDependencies) {
  const resolveSlashCommand = dependencies.resolveSlashCommand;
  let activeCommandSession: CommandSession | null = null;
  let didMutateSession = false;

  const host: CommandHost = {
    ...dependencies.host,
    session: {
      open<TData extends object = Record<string, unknown>>(session: CommandSession<TData>): void {
        activeCommandSession = session as CommandSession;
        didMutateSession = true;
      },
      update<TData extends object = Record<string, unknown>>(patch: CommandSessionPatch<TData>): void {
        if (!activeCommandSession) {
          throw new Error('command session update requires an active command session');
        }

        activeCommandSession = {
          ...activeCommandSession,
          ...patch
        } as CommandSession;
        didMutateSession = true;
      },
      close(): void {
        activeCommandSession = null;
        didMutateSession = true;
      },
      getActive(): CommandSession | null {
        return activeCommandSession;
      }
    }
  };

  /**
   * 调用 handler 后统一按 session 变化情况重绘 footer。
   */
  function renderIfNeeded(): void {
    if (didMutateSession) {
      dependencies.host.ui.render();
      didMutateSession = false;
    }
  }

  /**
   * 尝试从提交文本启动 slash 命令；未命中或当前不可启动时交还 app 继续既有路由。
   */
  function startFromText(text: string, options: CommandStartOptions = {}): CommandStartResult {
    const matchedSlashHandler = resolveSlashCommand(text);

    if (!matchedSlashHandler) {
      return {kind: 'not_matched'};
    }

    if (activeCommandSession) {
      return {kind: 'not_matched'};
    }

    if (options.duringAssistantTurn && !matchedSlashHandler.allowDuringAssistantTurn) {
      return {kind: 'not_matched'};
    }

    didMutateSession = false;
    const result = matchedSlashHandler.start(text, host);
    renderIfNeeded();

    if (result?.kind === 'not_matched') {
      return {kind: 'not_matched'};
    }

    return result || {kind: 'handled'};
  }

  /**
   * 把输入事件分发给当前活跃 command session；活跃会话会消费所有非退出事件。
   */
  function isPromiseLike(value: unknown): value is Promise<unknown> {
    return Boolean(value && typeof value === 'object' && 'then' in value && typeof value.then === 'function');
  }

  /**
   * 在 handler 调用后同步已变更的会话，并在异步收尾后复用同一重绘规则。
   */
  function renderAfterHandler(result: void | Promise<void>): Promise<void> | undefined {
    renderIfNeeded();

    if (!isPromiseLike(result)) {
      return undefined;
    }

    return result.then(
      () => {
        renderIfNeeded();
      },
      (error: unknown) => {
        renderIfNeeded();
        throw error;
      }
    );
  }

  function handleEvent(event: InputEvent): Promise<void> | undefined {
    if (!activeCommandSession) {
      return undefined;
    }

    if (event.type === INPUT_EVENTS.EXIT) {
      dependencies.host.ui.exit();
      return undefined;
    }

    if (!activeCommandSession.handler.handleEvent) {
      return undefined;
    }

    didMutateSession = false;
    return renderAfterHandler(activeCommandSession.handler.handleEvent(activeCommandSession, event, host));
  }

  function hasActiveSession(): boolean {
    return Boolean(activeCommandSession);
  }

  /**
   * 判断当前会话是否明确接收已校准的 footer 语义命中，避免未适配命令开启鼠标协议。
   */
  function hasPointerHandler(): boolean {
    return Boolean(activeCommandSession?.handler.handlePointer);
  }

  /** 判断当前会话是否声明滚轮能力；不因点击能力而放开滚轮分发。 */
  function hasWheelHandler(): boolean {
    return Boolean(activeCommandSession?.handler.handleWheel);
  }

  /**
   * 将当前 frame 的语义命中转交给 active handler；命令业务和 target 合法性仍由 handler 决定。
   */
  function handlePointer(target: FooterMouseTarget, activate: boolean): Promise<void> | undefined {
    const session = activeCommandSession;

    if (!session?.handler.handlePointer) {
      return undefined;
    }

    didMutateSession = false;
    return renderAfterHandler(session.handler.handlePointer(session, target, activate, host));
  }

  /** 将已校准的栏位和方向交给活跃 handler，并按实际 session 变更决定重绘。 */
  function handleWheel(pane: FooterWheelPane, direction: MouseWheelDirection): Promise<void> | undefined {
    const session = activeCommandSession;
    if (!session?.handler.handleWheel) {
      return undefined;
    }

    didMutateSession = false;
    return renderAfterHandler(session.handler.handleWheel(session, pane, direction, host));
  }

  function getSurface(): CommandSurface | null {
    return activeCommandSession ? structuredClone(activeCommandSession.surface) : null;
  }

  return {
    getSurface,
    handleEvent,
    handlePointer,
    handleWheel,
    hasActiveSession,
    hasPointerHandler,
    hasWheelHandler,
    startFromText
  };
}

export {
  createCommandRuntime
};

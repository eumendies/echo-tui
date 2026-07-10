import {resolveSlashCommand as defaultResolveSlashCommand} from '../../commands/resolve-slash-command';
import {INPUT_EVENTS} from '../../input/event-types';

import type {
  CommandHost,
  CommandRuntimeDependencies,
  CommandStartResult,
  CommandSession,
  CommandSessionPatch,
  CommandSurface
} from '../../types/command';
import type {InputEvent} from '../../types/input';

type RuntimeSnapshot = {
  activeCommandSession: {
    commandName: string;
    data?: Record<string, unknown> | null;
    surface: CommandSurface;
  } | null;
};

/**
 * 创建 slash command runtime，集中管理命令会话、surface 快照和会话内事件分发。
 *
 * runtime 不解释业务 effect；handler 通过 CommandHost 直接调用受控 app 能力。
 */
function createCommandRuntime(dependencies: CommandRuntimeDependencies) {
  const resolveSlashCommand = dependencies.resolveSlashCommand || defaultResolveSlashCommand;
  let activeCommandSession: CommandSession | null = null;
  let didMutateSession = false;

  const host: CommandHost = {
    ...dependencies.host,
    session: {
      open<TData extends object = Record<string, unknown>>(session: CommandSession<TData>): void {
        activeCommandSession = session as CommandSession;
        dependencies.host.composer.leaveHistoryBrowsing();
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
        dependencies.host.composer.leaveHistoryBrowsing();
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
      dependencies.host.ui.renderFooter();
      didMutateSession = false;
    }
  }

  /**
   * 尝试从提交文本启动 slash 命令；未命中时返回 false 让 app 继续普通提交。
   */
  function startFromText(text: string): CommandStartResult {
    const matchedSlashHandler = resolveSlashCommand(text);

    if (!matchedSlashHandler) {
      return {kind: 'not_matched'};
    }

    didMutateSession = false;
    const result = matchedSlashHandler.start(text, host) as void | CommandStartResult;
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
    const result = activeCommandSession.handler.handleEvent(activeCommandSession, event, host);
    renderIfNeeded();

    if (isPromiseLike(result)) {
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

    return undefined;
  }

  /**
   * 返回当前是否存在活跃 command session。
   */
  function hasActiveSession(): boolean {
    return Boolean(activeCommandSession);
  }

  /**
   * 返回当前 command surface 的可渲染快照。
   */
  function getSurface(): CommandSurface | null {
    return activeCommandSession ? structuredClone(activeCommandSession.surface) : null;
  }

  /**
   * 返回测试和调试使用的 command runtime 状态快照。
   */
  function getSnapshot(): RuntimeSnapshot {
    return {
      activeCommandSession: activeCommandSession ? {
        commandName: activeCommandSession.commandName,
        data: structuredClone(activeCommandSession.data),
        surface: structuredClone(activeCommandSession.surface)
      } : null
    };
  }

  return {
    getSnapshot,
    getSurface,
    handleEvent,
    hasActiveSession,
    startFromText
  };
}

export {
  createCommandRuntime
};

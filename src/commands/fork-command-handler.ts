import {INPUT_EVENTS} from '../input/event-types';

import type {CommandHandler, CommandHost, CommandSession, InfoCommandSurface} from '../types/command';
import type {InputEvent} from '../types/input';
import type {TranscriptForkResult} from '../types/transcript';

/** 将分叉结果投影为瞬时反馈，不向新旧 transcript 追加命令记录。 */
function createForkSurface(result: TranscriptForkResult): InfoCommandSurface {
  if (!result.ok && result.reason === 'empty') {
    return {
      kind: 'info',
      title: '/fork 无法分叉',
      lines: ['当前会话为空，请先完成至少一轮对话。'],
      dismissHint: 'Enter/Esc 关闭'
    };
  }

  if (!result.ok) {
    return {
      kind: 'info',
      title: '/fork 失败',
      lines: [result.error || '无法创建分叉会话。'],
      dismissHint: 'Enter/Esc 关闭'
    };
  }

  return {
    kind: 'info',
    title: '/fork 分叉成功',
    lines: [
      `新会话：${result.sessionId}`,
      `源会话 ${result.sourceSessionId} 仍可通过 /resume 恢复。`,
      '后续对话将写入新会话。'
    ],
    dismissHint: 'Enter/Esc 关闭'
  };
}

/** 等待后台任务收尾时使用的中间提示;只在确有受管任务时出现。 */
function createForkPendingSurface(): InfoCommandSurface {
  return {
    kind: 'info',
    title: '/fork 准备分叉',
    lines: ['正在停止当前会话的后台任务…'],
    dismissHint: '请稍候'
  };
}

export class ForkCommandHandler implements CommandHandler {
  name = 'fork';
  description = '分叉当前会话';

  /** 只接受无参数命令，避免把未来参数语法静默忽略。 */
  match(text: string): boolean {
    return text.trimEnd() === '/fork';
  }

  /**
   * 创建独立 session；只有存在受管后台任务时才走异步清理路径。
   */
  start(_text: string, host: CommandHost): void {
    const leavingSessionId = host.transcript.getCurrentSessionId();

    if (!leavingSessionId || !host.background.hasSessionTasks(leavingSessionId)) {
      host.session.open({
        commandName: 'fork',
        handler: this,
        surface: createForkSurface(host.transcript.forkSession()),
        data: null
      });
      return;
    }

    // 先停止离开会话的任务再交接新身份;分叉失败时原任务继续运行。
    host.session.open({
      commandName: 'fork',
      handler: this,
      surface: createForkPendingSurface(),
      data: null
    });
    void (async () => {
      const result = host.transcript.forkSession();

      if (result.ok) {
        await host.transcript.stopSessionTasks(leavingSessionId);
      }

      if (host.session.getActive()?.commandName !== 'fork') {
        return;
      }

      host.session.update({surface: createForkSurface(result), data: null});
      host.ui.render();
    })();
  }

  /** Enter 或 Esc 关闭反馈；其他输入不改变会话。 */
  handleEvent(_session: CommandSession, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.SUBMIT || event.type === INPUT_EVENTS.ESCAPE) {
      host.session.close();
    }
  }
}

export {createForkSurface, createForkPendingSurface};

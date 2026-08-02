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

export class ForkCommandHandler implements CommandHandler {
  name = 'fork';
  description = '分叉当前会话';

  /** 只接受无参数命令，避免把未来参数语法静默忽略。 */
  match(text: string): boolean {
    return text.trimEnd() === '/fork';
  }

  /** 立即创建独立 session，并用只读 surface 展示结构化结果。 */
  start(_text: string, host: CommandHost): void {
    host.session.open({
      commandName: 'fork',
      handler: this,
      surface: createForkSurface(host.transcript.forkSession()),
      data: null
    });
  }

  /** Enter 或 Esc 关闭反馈；其他输入不改变会话。 */
  handleEvent(_session: CommandSession, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.SUBMIT || event.type === INPUT_EVENTS.ESCAPE) {
      host.session.close();
    }
  }
}

export {createForkSurface};

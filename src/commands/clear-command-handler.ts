import { INPUT_EVENTS } from '../input/event-types';
import type { CommandHandler, CommandHost, CommandSession, ConfirmCommandSurface } from '../types/command';
import type { InputEvent } from '../types/input';

const CLEAR_SURFACE: ConfirmCommandSurface & {
  title: string;
  bodyLines: string[];
  confirmLabel: string;
  cancelLabel: string;
} = {
  kind: 'confirm',
  title: '/clear 清空会话',
  bodyLines: [
    '这会清空当前会话记录并开启一个新的会话。'
  ],
  confirmLabel: '清空',
  cancelLabel: '取消'
};

/**
 * 为 /clear 创建独立的 confirm surface，避免共享可变数组引用。
 *
 */
export function createClearSurface(): ConfirmCommandSurface {
  return {
    ...CLEAR_SURFACE,
    bodyLines: [...CLEAR_SURFACE.bodyLines]
  };
}

export class ClearCommandHandler implements CommandHandler {
  name = 'clear';
  description = '清空当前会话';

  /**
   * 只匹配纯 /clear，带参数或后缀的输入继续走普通消息路径。
   *
   */
  match(text: string): boolean {
    return text === '/clear';
  }

  /**
   * 启动 /clear，打开确认型 command surface。
   *
   */
  start(_text: string, host: CommandHost): void {
    host.composer.reset();
    host.session.open({
      commandName: 'clear',
      handler: this,
      surface: createClearSurface(),
      data: null
    });
  }

  /**
   * /clear 活跃时消费 Enter/Esc；确认后只清空 transcript，不清空输入历史。
   *
   */
  handleEvent(_session: CommandSession, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.SUBMIT) {
      host.session.close();
      host.composer.reset();
      host.transcript.clear();
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      host.session.close();
      host.composer.reset();
    }
  }
}

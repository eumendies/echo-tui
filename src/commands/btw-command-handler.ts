import {INPUT_EVENTS} from '../input/event-types';

import type {CommandHandler, CommandHost, CommandSession} from '../types/command';
import type {InputEvent} from '../types/input';

type BtwCommandData = {
  opened: true; // 标识 command session 已成功切换到 BTW controller。
};

/** 解析 `/btw` 并把后续输入委托给 app 级临时会话 controller。 */
class BtwCommandHandler implements CommandHandler<BtwCommandData> {
  name = 'btw';
  description = '打开临时只读旁路会话';
  allowDuringAssistantTurn = true;

  match(text: string): boolean {
    return /^\/btw(?:\s|$)/u.test(text);
  }

  start(text: string, host: CommandHost): void {
    const initialQuestion = text.replace(/^\/btw(?:\s+)?/u, '');
    host.session.open({
      commandName: 'btw',
      handler: this,
      surface: {kind: 'btw', title: 'BTW', dismissHint: 'Esc 返回主会话'},
      data: {opened: true}
    });
    host.btw.open(initialQuestion || undefined);
  }

  handleEvent(_session: CommandSession<BtwCommandData>, event: InputEvent, host: CommandHost): Promise<void> | void {
    if (event.type === INPUT_EVENTS.ESCAPE) {
      host.btw.close();
      host.session.close();
      host.ui.renderResizeRecovery();
      return;
    }
    return host.btw.handleEvent(event);
  }
}

export {BtwCommandHandler};

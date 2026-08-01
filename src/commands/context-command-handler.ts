import {INPUT_EVENTS} from '../input/event-types';

import type {CommandHandler, CommandHost, CommandSession, ContextUsageCommandSurface, InfoCommandSurface} from '../types/command';
import type {InputEvent} from '../types/input';

function createContextUnavailableSurface(): InfoCommandSurface {
  return {
    kind: 'info',
    title: '/context',
    lines: [
      '请先完成一次模型请求；/context不使用本地实时估算。'
    ],
    dismissHint: 'Esc 关闭'
  };
}

function createContextUsageSurface(host: CommandHost): ContextUsageCommandSurface | InfoCommandSurface {
  const usage = host.context.getUsage();

  if (!usage) {
    return createContextUnavailableSurface();
  }

  return {
    kind: 'context',
    title: 'Context',
    usage,
    dismissHint: '上下文占用详情 · 按任意键关闭'
  };
}

export class ContextCommandHandler implements CommandHandler {
  name = 'context';
  description = '查看 context 占用详情';

  /**
   * 只匹配 /context 和尾随空白，避免带参数内容被误消费。
   */
  match(text: string): boolean {
    return text.trimEnd() === '/context';
  }

  /**
   * 启动 /context，读取最近 provider usage 并打开只读详情面板。
   */
  start(_text: string, host: CommandHost): void {
    host.session.open({
      commandName: 'context',
      handler: this,
      surface: createContextUsageSurface(host),
      data: null
    });
  }

  /**
   * /context 是只读浮层；任意非退出事件都关闭面板并回到 composer。
   */
  handleEvent(_session: CommandSession, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.EXIT) {
      return;
    }

    host.session.close();
  }
}

export {
  createContextUnavailableSurface,
  createContextUsageSurface
};

import {INPUT_EVENTS} from '../input/event-types';

import type {CommandHandler, CommandHost, CommandSession, InfoCommandSurface, UsageCommandSurface} from '../types/command';
import type {InputEvent} from '../types/input';
import type {UsageDailyAggregate} from '../types/usage';

const USAGE_WINDOW_SIZE = 14;

type UsageCommandData = {
  dailyUsage: UsageDailyAggregate[];
  offset: number;
};

function createUsageUnavailableSurface(): InfoCommandSurface {
  return {
    kind: 'info',
    title: '/usage',
    lines: [
      '暂无 token usage 记录；完成一次带 usage 的模型请求后再查看。'
    ],
    dismissHint: 'Esc 关闭'
  };
}

function createUsageSurface(dailyUsage: UsageDailyAggregate[], offset: number): UsageCommandSurface {
  return {
    kind: 'usage',
    title: 'Token 用量',
    dailyUsage,
    offset: clampOffset(offset, dailyUsage),
    dismissHint: 'Token 用量 · Enter/Esc 关闭'
  };
}

function createUsageCommandData(dailyUsage: UsageDailyAggregate[]): UsageCommandData {
  return {
    dailyUsage,
    offset: maxOffset(dailyUsage)
  };
}

function maxOffset(dailyUsage: UsageDailyAggregate[]): number {
  return Math.max(0, dailyUsage.length - Math.min(USAGE_WINDOW_SIZE, dailyUsage.length));
}

function clampOffset(offset: number, dailyUsage: UsageDailyAggregate[]): number {
  return Math.max(0, Math.min(maxOffset(dailyUsage), offset));
}

function moveOffset(data: UsageCommandData, delta: number): UsageCommandData {
  return {
    dailyUsage: data.dailyUsage,
    offset: clampOffset(data.offset + delta, data.dailyUsage)
  };
}

export class UsageCommandHandler implements CommandHandler {
  name = 'usage';
  description = '查看每日 token 用量';

  /**
   * 只匹配纯 /usage，避免带参数输入被误消费。
   */
  match(text: string): boolean {
    return String(text) === '/usage';
  }

  /**
   * 启动 /usage，读取本地 usage 账本并打开只读每日用量面板。
   */
  start(_text: string, host: CommandHost): void {
    host.composer.reset();
    const dailyUsage = host.usage.listDailyUsage();

    if (dailyUsage.length === 0) {
      host.session.open({
        commandName: 'usage',
        handler: this,
        surface: createUsageUnavailableSurface(),
        data: null
      });
      return;
    }

    const data = createUsageCommandData(dailyUsage);
    host.session.open({
      commandName: 'usage',
      handler: this,
      surface: createUsageSurface(data.dailyUsage, data.offset),
      data
    });
  }

  /**
   * /usage 是只读面板；列表滚动键只移动日期窗口，关闭键返回 composer。
   */
  handleEvent(session: CommandSession<UsageCommandData>, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.EXIT) {
      return;
    }

    const data = session.data;

    if (!data) {
      if (event.type === INPUT_EVENTS.ESCAPE || event.type === INPUT_EVENTS.SUBMIT || event.type === INPUT_EVENTS.TEXT) {
        host.session.close();
        host.composer.reset();
      }
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE || event.type === INPUT_EVENTS.SUBMIT || (event.type === INPUT_EVENTS.TEXT && event.value === 'q')) {
      host.session.close();
      host.composer.reset();
      return;
    }

    let next = data;

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_LEFT) {
      next = moveOffset(data, -1);
    } else if (event.type === INPUT_EVENTS.MOVE_DOWN || event.type === INPUT_EVENTS.MOVE_RIGHT) {
      next = moveOffset(data, 1);
    } else if (event.type === INPUT_EVENTS.PAGE_UP) {
      next = moveOffset(data, -Math.min(USAGE_WINDOW_SIZE, data.dailyUsage.length));
    } else if (event.type === INPUT_EVENTS.PAGE_DOWN) {
      next = moveOffset(data, Math.min(USAGE_WINDOW_SIZE, data.dailyUsage.length));
    } else if (event.type === INPUT_EVENTS.MOVE_HOME) {
      next = {...data, offset: 0};
    } else if (event.type === INPUT_EVENTS.MOVE_END) {
      next = {...data, offset: maxOffset(data.dailyUsage)};
    }

    if (next !== data) {
      host.session.update({
        data: next,
        surface: createUsageSurface(next.dailyUsage, next.offset)
      });
    }
  }
}

export {
  createUsageSurface,
  createUsageUnavailableSurface
};

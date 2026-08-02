import {INPUT_EVENTS} from '../input/event-types';

import {calculateUsageNavigation} from '../render/footer/usage-surface';

import type {CommandHandler, CommandHost, CommandSession, InfoCommandSurface, UsageCommandSurface} from '../types/command';
import type {InputEvent} from '../types/input';
import type {UsageDailyAggregate} from '../types/usage';

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
    offset: Math.max(0, Math.floor(Number.isFinite(offset) ? offset : 0)),
    dismissHint: 'Token 用量 · Enter/Esc 关闭'
  };
}

function createUsageCommandData(dailyUsage: UsageDailyAggregate[], host: CommandHost): UsageCommandData {
  const data = {dailyUsage, offset: 0};
  return {
    dailyUsage,
    offset: resolveNavigation(data, host).maxOffset
  };
}

function resolveNavigation(data: UsageCommandData, host: CommandHost): {maxOffset: number; windowSize: number} {
  const viewport = host.usage.getViewport();
  return calculateUsageNavigation(createUsageSurface(data.dailyUsage, data.offset), viewport.width, viewport.maxLines);
}

function moveOffset(data: UsageCommandData, delta: number, maxOffset: number): UsageCommandData {
  return {
    dailyUsage: data.dailyUsage,
    offset: Math.max(0, Math.min(maxOffset, Math.min(data.offset, maxOffset) + delta))
  };
}

export class UsageCommandHandler implements CommandHandler {
  name = 'usage';
  description = '查看每日 token 用量';
  allowDuringAssistantTurn = true;

  /**
   * 只匹配 /usage 和尾随空白，避免带参数输入被误消费。
   */
  match(text: string): boolean {
    return text.trimEnd() === '/usage';
  }

  /**
   * 启动 /usage，读取本地 usage 账本并打开只读每日用量面板。
   */
  start(_text: string, host: CommandHost): void {
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

    const data = createUsageCommandData(dailyUsage, host);
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
      }
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE || event.type === INPUT_EVENTS.SUBMIT || (event.type === INPUT_EVENTS.TEXT && event.value === 'q')) {
      host.session.close();
      return;
    }

    let next = data;
    const navigation = resolveNavigation(data, host);

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_LEFT) {
      next = moveOffset(data, -1, navigation.maxOffset);
    } else if (event.type === INPUT_EVENTS.MOVE_DOWN || event.type === INPUT_EVENTS.MOVE_RIGHT) {
      next = moveOffset(data, 1, navigation.maxOffset);
    } else if (event.type === INPUT_EVENTS.PAGE_UP) {
      next = moveOffset(data, -navigation.windowSize, navigation.maxOffset);
    } else if (event.type === INPUT_EVENTS.PAGE_DOWN) {
      next = moveOffset(data, navigation.windowSize, navigation.maxOffset);
    } else if (event.type === INPUT_EVENTS.MOVE_HOME) {
      next = {...data, offset: 0};
    } else if (event.type === INPUT_EVENTS.MOVE_END) {
      next = {...data, offset: navigation.maxOffset};
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

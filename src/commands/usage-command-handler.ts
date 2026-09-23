import {INPUT_EVENTS} from '../input/event-types';
import {calculateUsageNavigation} from '../render/footer/usage-surface';

import type {CommandHandler, CommandHost, CommandSession, InfoCommandSurface, UsageCommandSurface} from '../types/command';
import type {InputEvent} from '../types/input';
import type {UsageDailyAggregate, UsageModelAggregate} from '../types/usage';

type UsageCommandData = {
  dailyOffset: number; // 按日列表可见窗口的起始索引。
  dailyUsage: UsageDailyAggregate[]; // 全部记录按本地日期聚合后的稳定快照。
  dayModels: UsageModelAggregate[]; // 当前选中日期内按 provider/模型聚合的快照。
  dayModelsOffset: number; // 当日模型明细可见窗口的起始索引。
  selectedDayIndex: number; // 当前选择日期在 dailyUsage 中的绝对索引。
  view: UsageCommandSurface['view']; // 当前处于日期选择还是当日模型明细。
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

function createUsageSurface(data: UsageCommandData): UsageCommandSurface {
  const selectedDay = data.dailyUsage[clampIndex(data.selectedDayIndex, data.dailyUsage.length)]?.localDay;
  const dayModels = data.view === 'dayModels';

  return {
    kind: 'usage',
    view: data.view,
    title: dayModels && selectedDay ? `Token 用量 · ${selectedDay} · 各模型` : 'Token 用量 · 按日期',
    dailyUsage: data.dailyUsage,
    modelUsage: dayModels ? data.dayModels : [],
    selectedIndex: clampIndex(data.selectedDayIndex, data.dailyUsage.length),
    offset: dayModels ? data.dayModelsOffset : data.dailyOffset,
    dismissHint: dayModels
      ? 'Esc/Backspace 返回日期 · q 关闭'
      : 'Enter 查看模型 · Esc/q 关闭'
  };
}

function createUsageCommandData(dailyUsage: UsageDailyAggregate[], host: CommandHost): UsageCommandData {
  const data: UsageCommandData = {
    view: 'daily',
    dailyUsage,
    dayModels: [],
    dailyOffset: 0,
    dayModelsOffset: 0,
    selectedDayIndex: clampIndex(dailyUsage.length - 1, dailyUsage.length)
  };

  return {
    ...data,
    dailyOffset: resolveNavigation(data, host).maxOffset
  };
}

function resolveNavigation(data: UsageCommandData, host: CommandHost): {maxOffset: number; windowSize: number} {
  const viewport = host.usage.getViewport();
  return calculateUsageNavigation(createUsageSurface(data), viewport.width, viewport.maxLines);
}

function clampIndex(index: number, length: number): number {
  return length > 0 ? Math.max(0, Math.min(length - 1, Math.floor(Number.isFinite(index) ? index : 0))) : 0;
}

function moveDateSelection(data: UsageCommandData, delta: number, navigation: {maxOffset: number; windowSize: number}): UsageCommandData {
  const selectedDayIndex = clampIndex(data.selectedDayIndex + delta, data.dailyUsage.length);
  const windowSize = Math.max(1, navigation.windowSize);
  let dailyOffset = Math.min(data.dailyOffset, navigation.maxOffset);

  if (selectedDayIndex < dailyOffset) {
    dailyOffset = selectedDayIndex;
  } else if (selectedDayIndex >= dailyOffset + windowSize) {
    dailyOffset = selectedDayIndex - windowSize + 1;
  }

  return {
    ...data,
    selectedDayIndex,
    dailyOffset: Math.max(0, Math.min(navigation.maxOffset, dailyOffset))
  };
}

function moveDetailOffset(data: UsageCommandData, delta: number, maxOffset: number): UsageCommandData {
  return {
    ...data,
    dayModelsOffset: Math.max(0, Math.min(maxOffset, Math.min(data.dayModelsOffset, maxOffset) + delta))
  };
}

export class UsageCommandHandler implements CommandHandler {
  name = 'usage';
  description = '查看每日 token 用量与当日模型明细';
  allowDuringAssistantTurn = true;

  /**
   * 只匹配 /usage 和尾随空白，避免带参数输入被误消费。
   */
  match(text: string): boolean {
    return text.trimEnd() === '/usage';
  }

  /**
   * 启动 /usage，读取本地 usage 账本并默认打开选中最新日期的只读用量面板。
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
      surface: createUsageSurface(data),
      data
    });
  }

  /**
   * /usage 是只读面板；日期列表选择后下钻当日模型明细，返回时保留原日期上下文。
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

    if (event.type === INPUT_EVENTS.TEXT && event.value === 'q') {
      host.session.close();
      return;
    }

    if (data.view === 'dayModels') {
      if (event.type === INPUT_EVENTS.ESCAPE || event.type === INPUT_EVENTS.BACKSPACE) {
        updateUsageSession({...data, view: 'daily'}, host);
        return;
      }

      const navigation = resolveNavigation(data, host);
      let next = data;

      if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_LEFT) {
        next = moveDetailOffset(data, -1, navigation.maxOffset);
      } else if (event.type === INPUT_EVENTS.MOVE_DOWN || event.type === INPUT_EVENTS.MOVE_RIGHT) {
        next = moveDetailOffset(data, 1, navigation.maxOffset);
      } else if (event.type === INPUT_EVENTS.PAGE_UP) {
        next = moveDetailOffset(data, -navigation.windowSize, navigation.maxOffset);
      } else if (event.type === INPUT_EVENTS.PAGE_DOWN) {
        next = moveDetailOffset(data, navigation.windowSize, navigation.maxOffset);
      } else if (event.type === INPUT_EVENTS.MOVE_HOME) {
        next = {...data, dayModelsOffset: 0};
      } else if (event.type === INPUT_EVENTS.MOVE_END) {
        next = {...data, dayModelsOffset: navigation.maxOffset};
      }

      if (next !== data) {
        updateUsageSession(next, host);
      }
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      host.session.close();
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      const selectedDay = data.dailyUsage[clampIndex(data.selectedDayIndex, data.dailyUsage.length)]?.localDay;

      if (selectedDay) {
        updateUsageSession({
          ...data,
          view: 'dayModels',
          dayModelsOffset: 0,
          dayModels: host.usage.listModelUsage({fromDay: selectedDay, toDay: selectedDay})
        }, host);
      }
      return;
    }

    const navigation = resolveNavigation(data, host);
    let next = data;

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_LEFT) {
      next = moveDateSelection(data, -1, navigation);
    } else if (event.type === INPUT_EVENTS.MOVE_DOWN || event.type === INPUT_EVENTS.MOVE_RIGHT) {
      next = moveDateSelection(data, 1, navigation);
    } else if (event.type === INPUT_EVENTS.PAGE_UP) {
      next = moveDateSelection(data, -navigation.windowSize, navigation);
    } else if (event.type === INPUT_EVENTS.PAGE_DOWN) {
      next = moveDateSelection(data, navigation.windowSize, navigation);
    } else if (event.type === INPUT_EVENTS.MOVE_HOME) {
      next = {...data, selectedDayIndex: 0, dailyOffset: 0};
    } else if (event.type === INPUT_EVENTS.MOVE_END) {
      next = {
        ...data,
        selectedDayIndex: clampIndex(data.dailyUsage.length - 1, data.dailyUsage.length),
        dailyOffset: navigation.maxOffset
      };
    }

    if (next !== data) {
      updateUsageSession(next, host);
    }
  }
}

function updateUsageSession(data: UsageCommandData, host: CommandHost): void {
  host.session.update({
    data,
    surface: createUsageSurface(data)
  });
}

export {
  createUsageSurface,
  createUsageUnavailableSurface
};

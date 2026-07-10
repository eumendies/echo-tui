import { INPUT_EVENTS } from '../input/event-types';
import type {
  CommandEffortInfo as HostEffortInfo,
  CommandEffortInfoResult as HostEffortInfoResult,
  CommandHandler,
  CommandHost,
  CommandSession,
  InfoCommandSurface,
  ScaleCommandSurface
} from '../types/command';
import type { InputEvent } from '../types/input';
import type { ReasoningEffort } from '../types/agent';

const EFFORT_CONFIG_PATH_HINT = '~/.echo/config.json';
const EFFORT_DISPLAY_LABELS: Record<ReasoningEffort, string> = {
  none: 'NONE',
  minimal: 'MIN',
  low: 'LOW',
  medium: 'MED',
  high: 'HIGH',
  xhigh: 'XHIGH'
};

type EffortCommandInfo = HostEffortInfo;
type EffortCommandInfoResult = HostEffortInfoResult;

export function createEffortSurface(effortCommandInfo: EffortCommandInfoResult): InfoCommandSurface {
  const error = 'error' in effortCommandInfo ? effortCommandInfo.error : undefined;
  const lines = [
    '当前未读取到推理等级配置。',
    error || `请检查 ${EFFORT_CONFIG_PATH_HINT} 中的 llm.models 配置。`
  ];

  return {
    kind: 'info',
    title: '/effort',
    lines,
    dismissHint: 'Esc 关闭'
  };
}

export function createEffortScaleSurface(data: EffortCommandInfo): ScaleCommandSurface {
  return {
    kind: 'scale',
    title: `/effort · ${data.currentModelLabel}`,
    leftLabel: 'fast',
    rightLabel: 'deep',
    options: data.efforts.map((effort) => ({ label: effort, description: EFFORT_DISPLAY_LABELS[effort] })),
    selectedIndex: data.selectedIndex,
    dismissHint: 'Enter 选择 · ←/→ 移动 · Esc 取消'
  };
}

function createEffortErrorSurface(error: string | undefined): InfoCommandSurface {
  return {
    kind: 'info',
    title: '/effort',
    lines: [
      '无法保存当前推理等级。',
      error || `请检查 ${EFFORT_CONFIG_PATH_HINT} 是否可写。`
    ],
    dismissHint: 'Esc 关闭'
  };
}

function moveEffortSelection(session: CommandSession<EffortCommandInfo>, direction: number, host: CommandHost): void {
  const data = session.data;

  if (!data) {
    return;
  }

  const selectedIndex = Math.min(Math.max(0, data.selectedIndex + direction), data.efforts.length - 1);
  const nextData = {
    ...data,
    selectedIndex
  };

  host.session.update({
    surface: createEffortScaleSurface(nextData),
    data: nextData
  });
}

function confirmEffortSelection(session: CommandSession<EffortCommandInfo>, host: CommandHost): void {
  const data = session.data;

  if (!data) {
    return;
  }

  const selectedEffort = data.efforts[data.selectedIndex];

  if (!selectedEffort) {
    return;
  }

  const result = host.model.selectEffort(selectedEffort);

  if (!result.ok) {
    host.session.update({
      surface: createEffortErrorSurface(result.error),
      data
    });
    return;
  }

  host.session.close();
  host.composer.reset();
}

export class EffortCommandHandler implements CommandHandler<EffortCommandInfo> {
  name = 'effort';
  description = '调整推理等级';

  match(text: string): boolean {
    return String(text) === '/effort';
  }

  start(_text: string, host: CommandHost): void {
    const effortCommandInfo = host.model.createEffortCommandInfo();
    const data = 'efforts' in effortCommandInfo && effortCommandInfo.efforts.length > 0
      ? effortCommandInfo
      : null;

    host.composer.reset();
    host.session.open({
      commandName: 'effort',
      handler: this,
      surface: data ? createEffortScaleSurface(data) : createEffortSurface(effortCommandInfo),
      data
    });
  }

  handleEvent(session: CommandSession<EffortCommandInfo>, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.MOVE_LEFT) {
      moveEffortSelection(session, -1, host);
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_RIGHT) {
      moveEffortSelection(session, 1, host);
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      confirmEffortSelection(session, host);
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      host.session.close();
      host.composer.reset();
    }
  }
}

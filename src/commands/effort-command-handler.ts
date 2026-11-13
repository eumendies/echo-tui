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
import { REASONING_EFFORTS } from '../types/agent';
import type { ReasoningEffort } from '../types/agent';

const EFFORT_CONFIG_PATH_HINT = '~/.echo/config.json';
const EFFORT_COMMAND_PREFIX = '/effort';
const EFFORT_DISPLAY_LABELS: Record<ReasoningEffort, string> = {
  none: 'NONE',
  low: 'LOW',
  medium: 'MED',
  high: 'HIGH',
  xhigh: 'XHIGH',
  max: 'MAX'
};

type EffortCommandInfo = HostEffortInfo;
type EffortCommandInfoResult = HostEffortInfoResult;

/**
 * 提取 `/effort` 之后的参数；无参数返回 null。
 */
function parseEffortArgument(text: string): string | null {
  const trimmed = text.trim();

  if (!trimmed.startsWith(EFFORT_COMMAND_PREFIX)) {
    return null;
  }

  const rest = trimmed.slice(EFFORT_COMMAND_PREFIX.length).trim();
  return rest === '' ? null : rest;
}

function isReasoningEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value);
}

/** 为非法 `/effort` 参数创建 info surface，列出全部合法级别与当前状态。 */
function createEffortQuerySurface(data: EffortCommandInfo, argument: string): InfoCommandSurface {
  const currentEffort = data.efforts[data.selectedIndex] ?? 'medium';

  return {
    kind: 'info',
    title: '/effort',
    lines: [
      `无法匹配推理等级：${argument}`,
      `可用级别：${data.efforts.join(' · ')}`,
      `当前：${data.currentModelLabel} · ${currentEffort}`
    ],
    dismissHint: 'Esc 关闭'
  };
}

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
}

export class EffortCommandHandler implements CommandHandler<EffortCommandInfo> {
  name = 'effort';
  description = '调整推理等级';

  match(text: string): boolean {
    return /^\/effort(?:\s+[\s\S]*)?$/.test(text);
  }

  /**
   * 无参数打开 scale 面板；带参数时按级别直接设置，
   * 非法级别展示合法值，配置错误与保存失败复用既有 surface。
   */
  start(text: string, host: CommandHost): void {
    const argument = parseEffortArgument(text);

    if (argument !== null) {
      this.startWithArgument(argument, host);
      return;
    }

    const effortCommandInfo = host.model.createEffortCommandInfo();
    const data = 'efforts' in effortCommandInfo && effortCommandInfo.efforts.length > 0
      ? effortCommandInfo
      : null;
    host.session.open({
      commandName: 'effort',
      handler: this,
      surface: data ? createEffortScaleSurface(data) : createEffortSurface(effortCommandInfo),
      data
    });
  }

  private startWithArgument(argument: string, host: CommandHost): void {
    const effortCommandInfo = host.model.createEffortCommandInfo();

    if (!('efforts' in effortCommandInfo) || effortCommandInfo.efforts.length === 0) {
      host.session.open({
        commandName: 'effort',
        handler: this,
        surface: createEffortSurface(effortCommandInfo),
        data: null
      });
      return;
    }

    const normalized = argument.toLowerCase();

    if (!isReasoningEffort(normalized)) {
      host.session.open({
        commandName: 'effort',
        handler: this,
        surface: createEffortQuerySurface(effortCommandInfo, argument),
        data: null
      });
      return;
    }

    const result = host.model.selectEffort(normalized);

    if (!result.ok) {
      host.session.open({
        commandName: 'effort',
        handler: this,
        surface: createEffortErrorSurface(result.error),
        data: null
      });
    }
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
    }
  }
}

export {createEffortQuerySurface, parseEffortArgument};

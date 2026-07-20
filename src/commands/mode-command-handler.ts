import {INPUT_EVENTS} from '../input/event-types';
import type {
  CommandHandler,
  CommandHost,
  CommandSession,
  InfoCommandSurface,
  SelectCommandSurface
} from '../types/command';
import type {InputEvent} from '../types/input';
import type {InteractionMode} from '../types/agent';

type ModeCommandData = {
  modes: ModeOption[];
  selectedIndex: number;
};

type ModeOption = {
  mode: InteractionMode;
  label: string;
  description: string;
};

const MODE_OPTIONS: ModeOption[] = [
  {mode: 'normal', label: 'normal', description: '普通对话，模型可使用默认工具'},
  {mode: 'plan', label: 'plan', description: '只读规划，适合探索和制定方案'},
  {mode: 'shell', label: 'shell', description: '执行 shell，结果进入模型上下文'},
  {mode: 'shell-local', label: 'shell-local', description: '执行 shell，仅本地显示结果'}
];

const MODE_USAGE_LINES = [
  '用法: /mode',
  '/mode normal',
  '/mode plan',
  '/mode shell',
  '/mode shell-local'
];

function parseModeArgument(text: string): InteractionMode | 'select' | 'invalid' {
  const parts = text.trim().split(/\s+/);

  if (parts.length === 1 && parts[0] === '/mode') {
    return 'select';
  }

  if (parts.length === 2 && isInteractionMode(parts[1])) {
    return parts[1];
  }

  return 'invalid';
}

function isInteractionMode(value: string): value is InteractionMode {
  return MODE_OPTIONS.some((option) => option.mode === value);
}

function createModeUsageSurface(): InfoCommandSurface {
  return {
    kind: 'info',
    title: '/mode',
    lines: MODE_USAGE_LINES,
    dismissHint: 'Esc 关闭'
  };
}

function createModeSelectData(currentMode: InteractionMode): ModeCommandData {
  const selectedIndex = Math.max(0, MODE_OPTIONS.findIndex((option) => option.mode === currentMode));
  return {
    modes: MODE_OPTIONS,
    selectedIndex
  };
}

function createModeSelectSurface(data: ModeCommandData): SelectCommandSurface {
  return {
    kind: 'select',
    title: '/mode 选择模式',
    options: data.modes.map((option) => ({
      label: option.label,
      description: option.description
    })),
    selectedIndex: data.selectedIndex,
    dismissHint: 'Enter 选择 · Up/Down 移动 · Esc 取消'
  };
}

function moveModeSelection(session: CommandSession<ModeCommandData>, direction: number, host: CommandHost): void {
  const data = session.data;

  if (!data) {
    return;
  }

  const selectedIndex = Math.min(Math.max(0, data.selectedIndex + direction), data.modes.length - 1);
  const nextData = {...data, selectedIndex};

  host.session.update({
    surface: createModeSelectSurface(nextData),
    data: nextData
  });
}

function confirmModeSelection(session: CommandSession<ModeCommandData>, host: CommandHost): void {
  const data = session.data;
  const selectedMode = data?.modes[data.selectedIndex]?.mode;

  if (!selectedMode) {
    return;
  }

  host.mode.setInteractionMode(selectedMode);
  host.session.close();
  host.composer.reset();
}

export class ModeCommandHandler implements CommandHandler<ModeCommandData> {
  name = 'mode';
  description = '切换交互模式';

  /**
   * 只接管 /mode 及其空格分隔参数，避免误吞 /model。
   */
  match(text: string): boolean {
    return /^\/mode(?:\s+.*)?$/.test(text);
  }

  /**
   * 直接参数立即切换模式；无参数打开选择 surface；非法参数显示用法。
   */
  start(text: string, host: CommandHost): void {
    const action = parseModeArgument(text);

    host.composer.reset();

    if (action === 'invalid') {
      host.session.open({
        commandName: 'mode',
        handler: this,
        surface: createModeUsageSurface(),
        data: null
      });
      return;
    }

    if (action === 'select') {
      const data = createModeSelectData(host.mode.getInteractionMode());
      host.session.open({
        commandName: 'mode',
        handler: this,
        surface: createModeSelectSurface(data),
        data
      });
      return;
    }

    host.mode.setInteractionMode(action);
  }

  /**
   * mode 选择 surface 支持上下移动、Enter 确认和 Esc 关闭。
   */
  handleEvent(session: CommandSession<ModeCommandData>, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.MOVE_UP) {
      moveModeSelection(session, -1, host);
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_DOWN) {
      moveModeSelection(session, 1, host);
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      confirmModeSelection(session, host);
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      host.session.close();
      host.composer.reset();
    }
  }
}

export {createModeSelectSurface, createModeUsageSurface, parseModeArgument};

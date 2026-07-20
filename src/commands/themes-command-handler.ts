import {INPUT_EVENTS} from '../input/event-types';
import type {
  CommandHandler,
  CommandHost,
  CommandSession,
  CommandThemeInfo,
  InfoCommandSurface,
  SelectCommandSurface
} from '../types/command';
import type {InputEvent} from '../types/input';

type ThemesCommandData = {
  selectedIndex: number;
  themes: CommandThemeInfo[];
};

function createThemesSelectData(themes: CommandThemeInfo[]): ThemesCommandData {
  const selectedIndex = Math.max(0, themes.findIndex((theme) => theme.selected));

  return {
    selectedIndex,
    themes
  };
}

function createThemesSelectSurface(data: ThemesCommandData): SelectCommandSurface {
  return {
    kind: 'select',
    title: `/themes 选择主题 (${data.themes.length})`,
    options: data.themes.map((theme) => ({
      label: theme.label,
      description: theme.description
    })),
    selectedIndex: data.selectedIndex,
    dismissHint: 'Enter 选择 · Up/Down 移动 · Esc 取消'
  };
}

function createThemesEmptySurface(): InfoCommandSurface {
  return {
    kind: 'info',
    title: '/themes',
    lines: [
      '当前没有可用的内置 theme。',
      '请检查安装包中的内置 theme 文件。'
    ],
    dismissHint: 'Esc 关闭'
  };
}

function createThemesErrorSurface(error: string | undefined): InfoCommandSurface {
  return {
    kind: 'info',
    title: '/themes',
    lines: [
      '无法保存当前 theme 选择。',
      error || '请检查 ~/.echo/theme.json 是否可写。'
    ],
    dismissHint: 'Esc 关闭'
  };
}

function moveThemeSelection(session: CommandSession<ThemesCommandData>, direction: number, host: CommandHost): void {
  const data = session.data;

  if (!data) {
    return;
  }

  const selectedIndex = Math.min(Math.max(0, data.selectedIndex + direction), data.themes.length - 1);
  const nextData = {
    ...data,
    selectedIndex
  };

  host.session.update({
    surface: createThemesSelectSurface(nextData),
    data: nextData
  });
}

function confirmThemeSelection(session: CommandSession<ThemesCommandData>, host: CommandHost): void {
  const data = session.data;
  const selectedTheme = data?.themes[data.selectedIndex];

  if (!selectedTheme) {
    return;
  }

  const result = host.theme.selectTheme(selectedTheme.id);

  if (!result.ok) {
    host.session.update({
      surface: createThemesErrorSurface(result.error),
      data
    });
    return;
  }

  host.session.close();
  host.composer.reset();
}

export class ThemesCommandHandler implements CommandHandler<ThemesCommandData> {
  name = 'themes';
  description = '切换主题';

  match(text: string): boolean {
    return text === '/themes';
  }

  start(_text: string, host: CommandHost): void {
    const themes = host.theme.listThemes();
    const data = themes.length > 0 ? createThemesSelectData(themes) : null;

    host.composer.reset();
    host.session.open({
      commandName: 'themes',
      handler: this,
      surface: data ? createThemesSelectSurface(data) : createThemesEmptySurface(),
      data
    });
  }

  handleEvent(session: CommandSession<ThemesCommandData>, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.MOVE_UP) {
      moveThemeSelection(session, -1, host);
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_DOWN) {
      moveThemeSelection(session, 1, host);
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      confirmThemeSelection(session, host);
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      host.session.close();
      host.composer.reset();
    }
  }
}

export {
  createThemesSelectSurface
};

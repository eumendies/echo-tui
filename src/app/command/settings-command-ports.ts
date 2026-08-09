import {listBuiltinThemes, readTuiTheme, readTuiThemeBaseId, selectBuiltinTheme} from '../../config/theme-config';

import type {CommandHostApp} from '../../types/command';
import type {AppContext} from '../state/app-context';

type SettingsCommandContext = Pick<AppContext,
  'clearContextUsage' |
  'getInteractionMode' |
  'setInteractionMode' |
  'setTheme'
>;

type SettingsCommandPortOptions = {
  appContext: SettingsCommandContext;
  render: () => void;
  renderResizeRecovery: () => void;
};

/**
 * 创建 interaction mode 与 theme 设置端口，并触发设置生效所需的重绘。
 */
function createSettingsCommandPorts(options: SettingsCommandPortOptions): Pick<CommandHostApp, 'mode' | 'theme'> {
  const {appContext, render, renderResizeRecovery} = options;

  return {
    mode: {
      getInteractionMode() {
        return appContext.getInteractionMode();
      },
      setInteractionMode(mode) {
        appContext.setInteractionMode(mode);
        appContext.clearContextUsage();
        render();
      }
    },
    theme: {
      listThemes() {
        const currentThemeId = readTuiThemeBaseId();
        return listBuiltinThemes().map((theme) => ({
          description: theme.description,
          id: theme.id,
          label: theme.label,
          selected: theme.id === currentThemeId
        }));
      },
      selectTheme(themeId: string) {
        const result = selectBuiltinTheme(themeId);

        if (!result.ok) {
          return result;
        }

        appContext.setTheme(readTuiTheme());
        renderResizeRecovery();
        return {ok: true};
      }
    }
  };
}

export {
  createSettingsCommandPorts
};

export type {
  SettingsCommandPortOptions
};

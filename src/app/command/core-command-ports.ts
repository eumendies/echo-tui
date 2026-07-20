import {writeClipboardText} from '../clipboard';

import type {CommandHostApp} from '../../types/command';
import type {ComposerContext} from '../state/composer-context';

type CoreCommandPortOptions = {
  composerContext: ComposerContext;
  exit: () => void;
  renderFooter: () => void;
  renderResizeRecovery: () => void;
};

/**
 * 创建所有 command 共用的 composer、clipboard 和 UI 基础端口。
 */
function createCoreCommandPorts(options: CoreCommandPortOptions): Pick<CommandHostApp, 'composer' | 'clipboard' | 'ui'> {
  const {composerContext, exit, renderFooter, renderResizeRecovery} = options;

  return {
    composer: {
      reset() {
        composerContext.reset();
        composerContext.leaveHistoryBrowsing();
      },
      leaveHistoryBrowsing() {
        composerContext.leaveHistoryBrowsing();
      }
    },
    clipboard: {
      writeText(text: string) {
        return writeClipboardText(text);
      }
    },
    ui: {
      renderFooter,
      renderResizeRecovery,
      exit
    }
  };
}

export {
  createCoreCommandPorts
};

export type {
  CoreCommandPortOptions
};

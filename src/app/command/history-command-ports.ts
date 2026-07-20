import {createCommandViewport} from './command-viewport';

import type {CommandHostApp} from '../../types/command';
import type {AppContext} from '../state/app-context';

type HistoryCommandContext = Pick<AppContext,
  'changeHistoryContext' |
  'createDiffSourceResult' |
  'createRenderState' |
  'executeUndo'
>;

/**
 * 创建文件变更 diff 和 undo 端口。
 */
function createHistoryCommandPorts(appContext: HistoryCommandContext): Pick<CommandHostApp, 'diff' | 'undo'> {
  return {
    diff: {
      getSource() {
        return appContext.createDiffSourceResult();
      },
      getViewport() {
        return createCommandViewport(appContext);
      }
    },
    undo: {
      getSummary() {
        return appContext.changeHistoryContext.getSummary();
      },
      execute() {
        return appContext.executeUndo();
      }
    }
  };
}

export {
  createHistoryCommandPorts
};

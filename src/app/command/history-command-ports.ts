import {createCommandViewport} from './command-viewport';
import {BACKGROUND_WRITE_UNDO_REASON} from '../state/app-context';
import {hasUnconfirmedBashCommands, UNCONFIRMED_BASH_UNDO_REASON} from '../../tools/bash-command-runner';

import type {CommandHostApp} from '../../types/command';
import type {AppContext} from '../state/app-context';

type HistoryCommandContext = Pick<AppContext,
  'backgroundTasks' |
  'changeHistoryContext' |
  'createDiffSourceResult' |
  'createRenderState' |
  'getCurrentCwd' |
  'executeUndo' |
  'transcriptContext'
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
        if (hasUnconfirmedBashCommands(appContext.getCurrentCwd())) {
          return {status: 'invalid', reason: UNCONFIRMED_BASH_UNDO_REASON};
        }
        const sessionId = appContext.transcriptContext.getCurrentSessionId();

        // 摘要入口先查活动写任务:两轮之间没有 recording checkpoint 时也要能拒绝回退。
        if (sessionId && appContext.backgroundTasks?.hasActiveWriteTask(sessionId)) {
          return {status: 'invalid', reason: BACKGROUND_WRITE_UNDO_REASON};
        }

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

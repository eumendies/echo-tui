import {prepareAgent} from '../../agent/agent-setup';
import {runCompaction} from '../../agent/context/context-compaction';

import type {CommandCompactionResult, CommandHostApp} from '../../types/command';
import type {TranscriptRecord} from '../../types/transcript';
import type {AppContext} from '../state/app-context';

type AssistantCommandContext = Pick<AppContext,
  'getAgentSession' |
  'getCurrentCwd' |
  'transcriptContext' |
  'turnContext'
>;

type AssistantCommandPortOptions = {
  appContext: AssistantCommandContext;
  appendRecord: (record: TranscriptRecord) => void;
  renderFooter: () => void;
};

/**
 * 创建手动 compaction 端口，协调 turn 生命周期、agent 请求和 transcript 更新。
 */
function createAssistantCommandPort(options: AssistantCommandPortOptions): CommandHostApp['assistant'] {
  const {appContext, appendRecord, renderFooter} = options;

  return {
    beginManualCompaction(): boolean {
      if (appContext.turnContext.responding) {
        renderFooter();
        return false;
      }

      appContext.turnContext.beginManualCompaction();
      appContext.turnContext.startSpinner('working');
      renderFooter();
      return true;
    },
    compactContext(compactionOptions: {force: true}) {
      const prepared = prepareAgent({cwd: () => appContext.getCurrentCwd()});
      const session = appContext.getAgentSession();

      return runCompaction({
        records: session.records,
        compaction: session.compaction,
        force: compactionOptions.force,
        agent: prepared.agent
      });
    },
    finishManualCompaction(result: CommandCompactionResult) {
      appContext.turnContext.stopSpinner();

      if (result.didCompact && result.compaction) {
        const noticeRecord = appContext.transcriptContext.applyCompaction(result.compaction);
        appContext.turnContext.finishAssistantTurn('');
        appendRecord(noticeRecord);
        return;
      }

      appContext.turnContext.finishAssistantTurn('');
      appendRecord(appContext.transcriptContext.appendRecord({
        role: 'compaction_notice',
        text: '当前无需压缩'
      }));
    },
    fail(error: unknown) {
      appContext.turnContext.stopSpinner();
      appendRecord(appContext.turnContext.failAssistantTurn(error));
    }
  };
}

export {
  createAssistantCommandPort
};

export type {
  AssistantCommandPortOptions
};

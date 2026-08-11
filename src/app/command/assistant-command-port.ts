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
  renderRecords: (records: TranscriptRecord[]) => void;
  render: () => void;
};

/**
 * 创建手动 compaction 端口，协调 turn 生命周期、agent 请求和 transcript 更新。
 */
function createAssistantCommandPort(options: AssistantCommandPortOptions): CommandHostApp['assistant'] {
  const {appContext, renderRecords, render} = options;

  return {
    beginManualCompaction(): boolean {
      if (appContext.turnContext.responding) {
        render();
        return false;
      }

      appContext.turnContext.beginManualCompaction();
      appContext.turnContext.startSpinner('working');
      render();
      return true;
    },
    compactContext(compactionOptions: {force: true}) {
      const session = appContext.getAgentSession();
      const prepared = prepareAgent({
        configSnapshot: session.userConfigSnapshot,
        cwd: () => appContext.getCurrentCwd(),
        modelProfileId: session.modelProfileId,
        reasoningEffortOverride: session.reasoningEffortOverride
      });

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
        renderRecords([noticeRecord]);
        return;
      }

      appContext.turnContext.finishAssistantTurn('');
      renderRecords([appContext.transcriptContext.appendRecord({
        role: 'compaction_notice',
        text: '当前无需压缩'
      })]);
    },
    fail(error: unknown) {
      appContext.turnContext.stopSpinner();
      renderRecords([appContext.turnContext.failAssistantTurn(error)]);
    }
  };
}

export {
  createAssistantCommandPort
};

export type {
  AssistantCommandPortOptions
};

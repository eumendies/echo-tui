import type {CommandHostApp, CopyableMessageRecord} from '../../types/command';
import type {TranscriptRecord} from '../../types/transcript';
import type {AppContext} from '../state/app-context';

type TranscriptCommandContext = Pick<AppContext,
  'clearContextUsage' |
  'clearTranscriptRecords' |
  'forkTranscriptSession' |
  'loadTranscriptSession' |
  'transcriptContext'
>;

type TranscriptCommandPortOptions = {
  appContext: TranscriptCommandContext;
  renderRecords: (records: TranscriptRecord[]) => void;
  renderResizeRecovery: () => void;
};

/**
 * 创建 transcript 查询、追加、清理和恢复端口。
 */
function createTranscriptCommandPort(options: TranscriptCommandPortOptions): CommandHostApp['transcript'] {
  const {appContext, renderRecords, renderResizeRecovery} = options;

  return {
    clear() {
      appContext.clearTranscriptRecords();
      appContext.clearContextUsage();
      renderResizeRecovery();
    },
    forkSession() {
      return appContext.forkTranscriptSession();
    },
    loadSession(sessionId: string): boolean {
      const didLoad = Boolean(appContext.loadTranscriptSession(sessionId));

      if (didLoad) {
        appContext.clearContextUsage();
        renderResizeRecovery();
      }

      return didLoad;
    },
    append(record: TranscriptRecord) {
      renderRecords([appContext.transcriptContext.appendRecord(record)]);
    },
    listCopyableRecords() {
      return createCopyableRecords(appContext.transcriptContext.records);
    },
    listSessionSummaries() {
      return appContext.transcriptContext.listSessionSummaries();
    },
    loadSessionPreview(candidate) {
      return appContext.transcriptContext.loadSessionPreview(candidate);
    }
  };
}

function createCopyableRecords(records: TranscriptRecord[]): CopyableMessageRecord[] {
  return records
    .map((record, index) => ({record, index}))
    .filter(({record}) => record.role === 'user' || record.role === 'assistant')
    .map(({record, index}) => ({
      createdAt: record.createdAt,
      id: `message-${index}`,
      role: record.role as CopyableMessageRecord['role'],
      text: record.text
    }));
}

export {
  createCopyableRecords,
  createTranscriptCommandPort
};

export type {
  TranscriptCommandPortOptions
};

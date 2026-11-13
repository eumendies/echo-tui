import {calculateElapsedMs, readBackgroundTaskStatus} from '../../tools/background-bash';

import type {AppContext} from '../state/app-context';
import type {CommandHostApp} from '../../types/command';
import type {BackgroundTaskReference, BackgroundTaskView} from '../../types/background-task';

type BackgroundCommandContext = Pick<AppContext, 'backgroundTasks' | 'transcriptContext'>;

/**
 * 由纯文件引用构造历史任务视图;文件缺失或格式不合法时只标注不可读取,不推断进程状态。
 */
function createReferenceView(reference: BackgroundTaskReference): BackgroundTaskView {
  const status = readBackgroundTaskStatus(reference.statusPath);

  if (!status || status.taskId !== reference.taskId || status.ownerInstanceId !== reference.ownerInstanceId || status.sessionId !== reference.sessionId) {
    return {
      reference,
      managed: false,
      state: 'failed',
      command: '',
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      reason: null,
      elapsedMs: null,
      outputTruncated: false,
      unreadable: '任务文件缺失或已损坏。'
    };
  }

  return {
    reference,
    managed: false,
    state: status.state,
    command: status.command,
    startedAt: status.startedAt,
    finishedAt: status.finishedAt,
    exitCode: status.exitCode,
    reason: status.reason,
    elapsedMs: calculateElapsedMs(status.startedAt, status.finishedAt),
    outputTruncated: status.outputTruncated
  };
}

/**
 * 从 transcript 记录里收集当前会话的后台任务引用;覆盖整个 session journal 的有效记录。
 * 只按 session 过滤:重启后实例身份已变,但历史引用仍应展示为未托管条目。
 */
function listReferenceViews(context: BackgroundCommandContext, sessionId: string): BackgroundTaskView[] {
  const records = context.transcriptContext.getCompleteRecords() || context.transcriptContext.getResidentRecords();
  const seen = new Set<string>();
  const views: BackgroundTaskView[] = [];

  for (const record of records) {
    if (record.role !== 'tool_result' || record.details.kind !== 'bash') {
      continue;
    }

    const background = record.details.background;

    if (!background || background.sessionId !== sessionId) {
      continue;
    }

    // 同一任务可能跨压缩边界重复出现,按三元身份只保留一次。
    const identity = `${background.sessionId}|${background.ownerInstanceId}|${background.taskId}`;

    if (seen.has(identity)) {
      continue;
    }

    seen.add(identity);
    views.push(createReferenceView({
      taskId: background.taskId,
      sessionId: background.sessionId,
      ownerInstanceId: background.ownerInstanceId,
      outputPath: background.outputPath,
      statusPath: background.statusPath
    }));
  }

  return views;
}

/**
 * 创建后台任务领域端口:合并当前实例句柄与 transcript 引用,按三元身份去重并保留受管条目优先。
 */
function createBackgroundCommandPort(appContext: BackgroundCommandContext): CommandHostApp['background'] {
  const manager = appContext.backgroundTasks;

  return {
    list(): BackgroundTaskView[] {
      const sessionId = appContext.transcriptContext.getCurrentSessionId();

      if (sessionId === null || !manager) {
        return [];
      }

      const managed = manager.listManaged(sessionId);
      const managedIdentities = new Set(managed.map((item) => `${item.reference.sessionId}|${item.reference.ownerInstanceId}|${item.reference.taskId}`));
      const references = listReferenceViews(appContext, sessionId)
        .filter((view) => !managedIdentities.has(`${view.reference.sessionId}|${view.reference.ownerInstanceId}|${view.reference.taskId}`));

      // 受管条目始终优先;历史引用按已知启动时间排序,无法读取时间的排在最后。
      return [
        ...managed,
        ...references.sort(
          (left, right) => (left.startedAt || '\uffff').localeCompare(right.startedAt || '\uffff') || left.reference.taskId.localeCompare(right.reference.taskId)
        )
      ];
    },
    hasSessionTasks(sessionId: string): boolean {
      return (manager?.listManaged(sessionId).length ?? 0) > 0;
    },
    stop(taskId: string): Promise<boolean> {
      return manager ? manager.stop(taskId) : Promise.resolve(false);
    },
    readLog(taskId: string, maxBytes: number): string | null {
      return manager ? manager.readTaskLog(taskId, maxBytes) : null;
    },
    readReferenceLog(reference: BackgroundTaskReference, maxBytes: number): string | null {
      return manager ? manager.readReferenceLog(reference, maxBytes) : null;
    }
  };
}

export {
  createBackgroundCommandPort,
  createReferenceView,
  listReferenceViews
};

export type {
  BackgroundCommandContext
};

import type {AppContext} from './state/app-context';
import type {TranscriptRecord} from '../types/transcript';

/** 待发通知;角色参与落盘,会话身份用于跨会话丢弃。 */
type QueuedNotice = {
  role: 'error' | 'local_notice'; // 本地事实类型,不进入 provider 请求。
  sessionId: string | null; // 入队时的会话身份;切换会话后旧条目直接丢弃。
  text: string; // 已格式化的有界展示文本。
};

type LocalNoticeEmitterOptions = {
  appContext: Pick<AppContext, 'transcriptContext' | 'turnContext'>; // 只读取记录容器与响应占用状态。
  renderRecords: (records: TranscriptRecord[]) => void; // 组合根注入的既有渲染通道,不另开写终端路径。
};

type LocalNoticeEmitter = {
  drain: () => void; // 响应占用结束时排空;仍在响应中则保持排队。
  emit: (text: string, role?: QueuedNotice['role']) => void; // 任意时刻的异步通知。
};

/**
 * 收拢异步本地通知的延迟提交:响应占用期间只入队,结束后统一追加。
 * 不在 turn 中途插入记录,因此不需要与 agent loop 的记录区间同步。
 */
function createLocalNoticeEmitter(options: LocalNoticeEmitterOptions): LocalNoticeEmitter {
  let queue: QueuedNotice[] = [];

  /** 响应占用覆盖 assistant turn、shell 执行与手动压缩;期间追加会打乱正文或工具对。 */
  function isBusy(): boolean {
    return options.appContext.turnContext.responding;
  }

  function getCurrentSessionId(): string | null {
    return options.appContext.transcriptContext.getCurrentSessionId();
  }

  function appendNow(notices: QueuedNotice[]): void {
    if (notices.length === 0) {
      return;
    }

    // 一次批量提交,避免逐条 journal 写入。
    const records = options.appContext.transcriptContext.appendRecords(notices.map((notice) => ({
      role: notice.role,
      text: notice.text
    } as TranscriptRecord)));
    options.renderRecords(records);
  }

  function drain(): void {
    if (queue.length === 0 || isBusy()) {
      return;
    }

    const sessionId = getCurrentSessionId();
    // 只提交仍属于当前会话的通知;旧会话条目随会话切换丢弃,不污染新会话。
    const ready = queue.filter((notice) => notice.sessionId === sessionId);
    queue = [];
    appendNow(ready);
  }

  function emit(text: string, role: 'error' | 'local_notice' = 'local_notice'): void {
    // 统一先入队再尝试提交:这样积压通知一定排在新通知之前,不会出现 B、A。
    queue.push({role, text, sessionId: getCurrentSessionId()});
    drain();
  }

  return {drain, emit};
}

export {
  createLocalNoticeEmitter
};

export type {
  LocalNoticeEmitter,
  LocalNoticeEmitterOptions
};

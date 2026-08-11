import {normalizeSessionBrowserData} from './session-browser';

import type {CommandHost, CommandSession, ResumeCommandSurface} from '../../types/command';
import type {TranscriptSessionPreview} from '../../types/transcript';
import type {SessionBrowserData, SessionBrowserSession} from './session-browser';

type SessionBrowserPreviewScheduleOptions<TSession extends SessionBrowserSession> = {
  commandName: string; // 用于确认迟到结果仍属于发起请求的 slash command。
  createSurface: (data: SessionBrowserData<TSession>) => ResumeCommandSurface; // 把更新后的预览状态投影回双栏 surface。
  data: SessionBrowserData<TSession>; // 调度时捕获的选择状态和候选列表。
  delayMs: number; // 列表快速导航时使用的防抖等待时间。
  errorMessage: string; // 预览读取失败时展示的稳定业务文案。
  host: CommandHost; // 提供预览查询、活动 command session 和重绘能力。
  loadPreview: (candidate: TSession) => Promise<TranscriptSessionPreview | null>; // 按需读取一个候选 journal 的有界预览。
};

/**
 * 协调会话浏览器的防抖预览，并隔离选择变化或 surface 关闭后的迟到结果。
 */
class SessionBrowserPreviewController<TSession extends SessionBrowserSession> {
  private generation = 0;
  private timer: NodeJS.Timeout | null = null;

  /** 调度当前稳定选中项；只有 generation、command 和 sessionId 都匹配时才更新界面。 */
  schedule(options: SessionBrowserPreviewScheduleOptions<TSession>): void {
    if (this.timer) clearTimeout(this.timer);
    const selected = options.data.sessions[options.data.selectedIndex];
    const generation = ++this.generation;
    if (!selected) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.loadAndApply(selected, generation, options);
    }, options.delayMs);
  }

  /** 关闭等待中的 timer，并使已经启动的异步读取结果失效。 */
  invalidate(): void {
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** 执行一次预览读取并把最终 ready/error 状态提交给仍然活动的 command session。 */
  private async loadAndApply(
    selected: TSession,
    generation: number,
    options: SessionBrowserPreviewScheduleOptions<TSession>
  ): Promise<void> {
    let preview: TranscriptSessionPreview | null = null;
    try {
      preview = await options.loadPreview(selected);
    } catch {
      // provider 端口异常与不可读 journal 都统一投影为当前候选的预览错误。
    }

    if (generation !== this.generation) return;
    const active = options.host.session.getActive() as CommandSession<SessionBrowserData<TSession>> | null;
    if (!active || active.commandName !== options.commandName) return;
    const current = normalizeSessionBrowserData(active.data);
    const currentSelected = current.sessions[current.selectedIndex];
    if (!currentSelected || currentSelected.sessionId !== selected.sessionId) return;

    const next = normalizeSessionBrowserData({
      ...current,
      previewState: preview
        ? {sessionId: selected.sessionId, status: 'ready', records: preview.previewRecords.map((record) => ({...record}))}
        : {sessionId: selected.sessionId, status: 'error', records: [], error: options.errorMessage}
    });
    options.host.session.update({data: next, surface: options.createSurface(next)});
    options.host.ui.render();
  }
}

export {SessionBrowserPreviewController};

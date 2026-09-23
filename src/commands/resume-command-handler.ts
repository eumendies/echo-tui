import {INPUT_EVENTS} from '../input/event-types';
import {
  createLoadingSessionPreviewState,
  createSessionBrowserSurface,
  formatSessionUpdatedAt,
  navigateSessionBrowser,
  normalizeSessionBrowserData
} from './session/session-browser';
import {SessionBrowserPreviewController} from './session/session-browser-preview-controller';

import type {CommandHandler, CommandHost, CommandSession, ConfirmCommandSurface, InfoCommandSurface, ResumeCommandSurface} from '../types/command';
import type {InputEvent} from '../types/input';
import type {FooterMouseTarget} from '../types/render';
import type {TranscriptSessionDeleteResult, TranscriptSessionSummary} from '../types/transcript';
import type {SessionBrowserData} from './session/session-browser';

type ResumeData = SessionBrowserData<TranscriptSessionSummary> & {
  deleteError?: string; // 确认提交失败后保留给用户的稳定中文原因。
  deleteTarget?: TranscriptSessionSummary; // 进入确认时冻结的删除目标，禁止确认期间跟随列表变化漂移。
};

/** 在共享浏览器归一化结果上保留仅属于 /resume 删除确认的命令状态。 */
function normalizeResumeData(data: Partial<ResumeData> | null | undefined): ResumeData {
  const source = data || {};
  const normalized = normalizeSessionBrowserData(source);
  const deleteTarget = source.deleteTarget;

  return {
    ...normalized,
    ...(deleteTarget ? {deleteTarget: {...deleteTarget, fingerprint: {...deleteTarget.fingerprint}}} : {}),
    ...(typeof source.deleteError === 'string' && source.deleteError.trim() !== '' ? {deleteError: source.deleteError} : {})
  };
}

function createSessionItem(session: TranscriptSessionSummary): {label: string} {
  const messageCount = Number.isInteger(session.messageCount) ? session.messageCount : 0;
  return {label: `${formatSessionUpdatedAt(session.updatedAt)} · ${messageCount} 条消息`};
}

function createResumeSurfaceFromData(data: ResumeData): ResumeCommandSurface {
  return createSessionBrowserSurface(data, {
    title: `/resume 恢复会话 (${data.sessions.length})`,
    createSessionItem,
    emptyPreviewHint: '没有可预览消息',
    dismissHint: '↑↓ 选择/滚动 · →/Tab 预览 · ← 列表 · Enter 恢复 · d 删除 · Esc 取消'
  });
}

/** 将当前选中目标投影为独立确认界面，避免不可逆删除直接作用于浏览器列表。 */
function createDeleteConfirmSurface(data: ResumeData): ConfirmCommandSurface {
  const target = data.deleteTarget;
  if (!target) {
    throw new Error('Resume 删除确认缺少目标会话');
  }

  return {
    kind: 'confirm',
    title: '/resume 删除会话',
    bodyLines: [
      `将永久删除：${target.title}`,
      `更新时间：${formatSessionUpdatedAt(target.updatedAt)}`,
      '删除后不可恢复。',
      ...(data.deleteError ? [data.deleteError] : [])
    ],
    confirmLabel: data.deleteError ? '重试删除' : '删除',
    cancelLabel: '返回'
  };
}

function createEmptyResumeSurface(): InfoCommandSurface {
  return {
    kind: 'info',
    title: '/resume',
    lines: [
      '当前目录没有可恢复会话。',
      '发送普通消息后，transcript 会保存到 ~/.echo/echo_tui/。'
    ],
    dismissHint: 'Esc 关闭'
  };
}

function confirmResumeSelection(session: CommandSession<ResumeData>, host: CommandHost): void {
  const data = normalizeSessionBrowserData(session.data);
  confirmResumeData(data, host);
}

function confirmResumeData(data: ResumeData, host: CommandHost): void {
  const selectedSession = data.sessions[data.selectedIndex];

  if (!selectedSession) {
    return;
  }

  host.session.close();
  host.transcript.loadSession(selectedSession.sessionId);
}

/** 复制存储摘要，避免命令 session 持有 store 或 host 暴露的可变对象。 */
function listResumeSessions(host: CommandHost): TranscriptSessionSummary[] {
  return host.transcript.listSessionSummaries().map((session) => ({
    ...session,
    fingerprint: {...session.fingerprint}
  }));
}

/** 在刷新后的候选中保留相邻选择，并为新的当前项创建按需预览状态。 */
function createResumeData(sessions: TranscriptSessionSummary[], selectedIndex = 0, notice?: string): ResumeData {
  const normalized = normalizeSessionBrowserData<TranscriptSessionSummary>({
    focus: 'list',
    selectedIndex,
    sessions
  });
  const selected = normalized.sessions[normalized.selectedIndex];

  return {
    ...normalized,
    ...(notice ? {notice} : {}),
    ...(selected ? {previewState: createLoadingSessionPreviewState(selected.sessionId)} : {})
  };
}

/** 将删除端口的受控结果转换为用户可见文案，不泄露文件系统细节。 */
function createDeleteFailureMessage(result: Exclude<TranscriptSessionDeleteResult, {ok: true}>): string {
  if (result.reason === 'current') {
    return '当前正在使用的会话不能删除。';
  }

  if (result.reason === 'missing') {
    return '目标会话已不存在，请返回列表刷新。';
  }

  return result.error || '无法删除会话，请重试。';
}

export class ResumeCommandHandler implements CommandHandler<ResumeData> {
  name = 'resume';
  description = '恢复历史会话';
  private previewController = new SessionBrowserPreviewController<TranscriptSessionSummary>();

  match(text: string): boolean {
    return text.trimEnd() === '/resume';
  }

  /**
   * 打开可恢复会话浏览器；空列表使用说明 surface。
   */
  start(_text: string, host: CommandHost): void {
    this.previewController.invalidate();
    const sessions = listResumeSessions(host);

    if (sessions.length === 0) {
      host.session.open({
        commandName: 'resume',
        handler: this,
        surface: createEmptyResumeSurface(),
        data: normalizeSessionBrowserData({sessions})
      });
      return;
    }

    const data = createResumeData(sessions);
    host.session.open({commandName: 'resume', handler: this, surface: createResumeSurfaceFromData(data), data});
    this.schedulePreview(data, host, 0);
  }

  /**
   * 复用共享浏览控制器处理导航、恢复和删除确认；该方法运行在 raw-mode 命令 surface，文本 d 不会写入 composer。
   */
  handleEvent(session: CommandSession<ResumeData>, event: InputEvent, host: CommandHost): void {
    const current = normalizeResumeData(session.data);

    if (current.deleteTarget) {
      this.handleDeleteConfirmation(current, event, host);
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === 'd') {
      this.beginDelete(current, host);
      return;
    }

    const navigation = navigateSessionBrowser(current, event);

    if (navigation.handled) {
      if (navigation.changed) {
        const selectionChanged = navigation.data.selectedIndex !== current.selectedIndex;
        const next = {...navigation.data};
        delete next.notice;
        host.session.update({data: next, surface: createResumeSurfaceFromData(next)});
        if (selectionChanged) {
          this.schedulePreview(next, host, 120);
        }
      }
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      this.previewController.invalidate();
      confirmResumeSelection(session, host);
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.previewController.invalidate();
      host.session.close();
    }
  }

  handlePointer(session: CommandSession<ResumeData>, target: FooterMouseTarget, activate: boolean, host: CommandHost): void {
    if (target.kind !== 'command_resume_session' || session.surface.kind !== 'resume') {
      return;
    }

    const current = normalizeResumeData(session.data);
    const selected = Number.isInteger(target.index) ? current.sessions[target.index] : undefined;
    if (!selected || current.deleteTarget || current.focus !== 'list') {
      return;
    }

    const {notice: _notice, ...withoutNotice} = current;
    const selectionChanged = current.selectedIndex !== target.index;
    const next = normalizeResumeData({
      ...withoutNotice,
      previewScroll: 0,
      selectedIndex: target.index,
      ...(selectionChanged ? {previewState: createLoadingSessionPreviewState(selected.sessionId)} : {})
    });
    if (selectionChanged || current.notice || current.previewScroll !== 0) {
      host.session.update({data: next, surface: createResumeSurfaceFromData(next)});
      if (selectionChanged) {
        this.schedulePreview(next, host, 120);
      }
    }

    if (activate) {
      this.previewController.invalidate();
      confirmResumeData(next, host);
    }
  }

  /** 延迟加载稳定选中项，具体防抖和迟到结果隔离由共享 controller 负责。 */
  private schedulePreview(data: ResumeData, host: CommandHost, delayMs: number): void {
    this.previewController.schedule({
      commandName: 'resume',
      createSurface: createResumeSurfaceFromData,
      data,
      delayMs,
      errorMessage: '无法读取会话预览',
      host,
      loadPreview: (candidate) => host.transcript.loadSessionPreview(candidate)
    });
  }

  /** 开始删除前冻结目标并使预览请求失效；当前 session 仅展示保护提示。 */
  private beginDelete(data: ResumeData, host: CommandHost): void {
    const selected = data.sessions[data.selectedIndex];
    if (!selected) {
      return;
    }

    if (selected.sessionId === host.transcript.getCurrentSessionId()) {
      host.session.update({
        data: {...data, notice: '当前正在使用的会话不能删除。'},
        surface: createResumeSurfaceFromData({...data, notice: '当前正在使用的会话不能删除。'})
      });
      return;
    }

    this.previewController.invalidate();
    const next: ResumeData = {
      ...data,
      deleteTarget: {...selected, fingerprint: {...selected.fingerprint}},
      deleteError: undefined
    };
    host.session.update({data: next, surface: createDeleteConfirmSurface(next)});
  }

  /** 处理确认态的 Enter/Esc；成功后始终通过存储重建候选，失败则保留目标和原因供用户决定。 */
  private handleDeleteConfirmation(data: ResumeData, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.previewController.invalidate();
      const sessions = listResumeSessions(host);
      const originalIndex = sessions.findIndex((session) => session.sessionId === data.deleteTarget?.sessionId);
      const restored = createResumeData(sessions, originalIndex >= 0 ? originalIndex : data.selectedIndex);
      const next = originalIndex >= 0
        ? {...restored, focus: data.focus, previewScroll: data.previewScroll}
        : restored;
      host.session.update({
        data: next,
        surface: next.sessions.length > 0 ? createResumeSurfaceFromData(next) : createEmptyResumeSurface()
      });
      if (next.sessions.length > 0) {
        this.schedulePreview(next, host, 0);
      }
      return;
    }

    if (event.type !== INPUT_EVENTS.SUBMIT || !data.deleteTarget) {
      return;
    }

    const result = host.transcript.deleteSession(data.deleteTarget.sessionId);
    if (!result.ok) {
      const next: ResumeData = {...data, deleteError: createDeleteFailureMessage(result)};
      host.session.update({data: next, surface: createDeleteConfirmSurface(next)});
      return;
    }

    this.previewController.invalidate();
    const next = createResumeData(listResumeSessions(host), data.selectedIndex);
    host.session.update({
      data: next,
      surface: next.sessions.length > 0 ? createResumeSurfaceFromData(next) : createEmptyResumeSurface()
    });
    if (next.sessions.length > 0) {
      this.schedulePreview(next, host, 0);
    }
  }
}

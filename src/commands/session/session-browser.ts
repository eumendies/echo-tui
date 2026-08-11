import {INPUT_EVENTS} from '../../input/event-types';

import type {InputEvent} from '../../types/input';
import type {
  ResumeCommandSurface,
  ResumeCommandSurfacePreviewRecord,
  ResumeCommandSurfaceSession
} from '../../types/command';
import type {TranscriptSessionSummary} from '../../types/transcript';

// /resume 与 /reference 共用该纯状态控制器，业务 handler 只保留文案和确认动作。
const SESSION_BROWSER_PAGE_SIZE = 5;
const SESSION_BROWSER_PREVIEW_PAGE_SIZE = 8;

type SessionBrowserSession = Pick<TranscriptSessionSummary, 'messageCount' | 'sessionId' | 'updatedAt'>;

type SessionBrowserPreviewState = {
  sessionId: string; // 预览状态所属候选，禁止跨选择复用迟到结果。
  status: 'loading' | 'ready' | 'error'; // 右栏当前加载状态。
  records: ResumeCommandSurfacePreviewRecord[]; // ready 状态下可滚动的有界预览。
  error?: string; // error 状态下可直接展示的稳定文案。
};

type SessionBrowserData<TSession extends SessionBrowserSession = TranscriptSessionSummary> = {
  focus: 'list' | 'preview'; // 决定上下方向键操作候选列表还是右侧预览。
  pageSize: number; // 左侧列表一次允许显示的候选数量。
  previewScroll: number; // 右侧预览相对首条记录的滚动偏移。
  selectedIndex: number; // 当前候选在完整 sessions 数组中的绝对索引。
  sessions: TSession[]; // 当前 cwd 下可供业务 handler 选择的会话摘要。
  previewState?: SessionBrowserPreviewState; // 当前选中项的异步预览状态。
  windowStart: number; // 左侧可见窗口在完整 sessions 数组中的起点。
};

type SessionBrowserSurfaceOptions<TSession extends SessionBrowserSession> = {
  createSessionItem: (session: TSession) => ResumeCommandSurfaceSession; // 把业务会话摘要转换为左侧列表标签。
  dismissHint: string; // 展示在双栏 surface 底部的业务按键提示。
  emptyPreviewHint: string; // 当前会话没有可见记录时的预览占位文案。
  title: string; // 双栏 surface 顶部展示的业务标题。
};

type SessionBrowserNavigationResult<TSession extends SessionBrowserSession = TranscriptSessionSummary> = {
  changed: boolean; // 指示本次导航是否实际改变了可见状态。
  data: SessionBrowserData<TSession>; // 经过边界归一化后的下一份浏览状态。
  handled: boolean; // 指示输入事件是否属于共享浏览器负责的导航事件。
};

/** 为新选中的候选创建空 loading 状态；空列表不保留无归属预览。 */
function createLoadingSessionPreviewState(sessionId: string | undefined): SessionBrowserPreviewState | undefined {
  return sessionId ? {sessionId, status: 'loading', records: []} : undefined;
}

/** 格式化列表时间；无效持久化值原样降级，避免候选项消失。 */
function formatSessionUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);

  if (Number.isNaN(date.getTime())) {
    return String(updatedAt || 'unknown time');
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/**
 * 归一化会话浏览状态，统一列表窗口、选中项和预览滚动边界。
 */
function normalizeSessionBrowserData<TSession extends SessionBrowserSession>(data: Partial<SessionBrowserData<TSession>> | null | undefined): SessionBrowserData<TSession> {
  const source = data || {};
  const sessions = Array.isArray(source.sessions) ? source.sessions : [];
  const pageSize = Number.isInteger(source.pageSize) && Number(source.pageSize) > 0
    ? Number(source.pageSize)
    : SESSION_BROWSER_PAGE_SIZE;
  const maxIndex = Math.max(0, sessions.length - 1);
  const selectedIndex = sessions.length > 0
    ? Math.min(Math.max(0, Number.isInteger(source.selectedIndex) ? Number(source.selectedIndex) : 0), maxIndex)
    : 0;
  const focus = source.focus === 'preview' ? 'preview' : 'list';
  const selectedSession = sessions[selectedIndex];
  const previewRecords = source.previewState && source.previewState.sessionId === selectedSession?.sessionId
    ? source.previewState.records
    : [];
  const maxPreviewScroll = Math.max(0, previewRecords.length - SESSION_BROWSER_PREVIEW_PAGE_SIZE);
  const previewScroll = Math.min(
    Math.max(0, Number.isInteger(source.previewScroll) ? Number(source.previewScroll) : 0),
    maxPreviewScroll
  );
  const windowStart = resolveWindowStart(
    selectedIndex,
    Number.isInteger(source.windowStart) ? Number(source.windowStart) : 0,
    sessions.length,
    pageSize
  );

  return {
    focus,
    pageSize,
    previewScroll,
    selectedIndex,
    sessions,
    windowStart,
    ...(source.previewState ? {previewState: source.previewState} : {})
  };
}

/**
 * 将共享浏览状态投影成双栏会话 surface；业务 handler 只提供标题和行标签。
 */
function createSessionBrowserSurface<TSession extends SessionBrowserSession>(data: SessionBrowserData<TSession>, options: SessionBrowserSurfaceOptions<TSession>): ResumeCommandSurface {
  const normalized = normalizeSessionBrowserData(data);
  const visibleSessions = normalized.sessions.slice(normalized.windowStart, normalized.windowStart + normalized.pageSize);

  const selectedSession = normalized.sessions[normalized.selectedIndex];
  const asyncPreview = normalized.previewState?.sessionId === selectedSession?.sessionId
    ? normalized.previewState
    : undefined;

  return {
    kind: 'resume',
    focus: normalized.focus,
    title: options.title,
    sessions: visibleSessions.map(options.createSessionItem),
    hiddenSessionCountAbove: normalized.windowStart,
    hiddenSessionCountBelow: Math.max(0, normalized.sessions.length - normalized.windowStart - visibleSessions.length),
    selectedIndex: Math.max(0, normalized.selectedIndex - normalized.windowStart),
    previewScroll: normalized.previewScroll,
    previewStatus: asyncPreview?.status || 'ready',
    previewRecords: asyncPreview?.records || [],
    ...(asyncPreview?.error ? {previewError: asyncPreview.error} : {}),
    emptyPreviewHint: options.emptyPreviewHint,
    dismissHint: options.dismissHint
  };
}

/**
 * 处理双栏会话浏览的方向键和焦点事件，不消费确认、取消等业务事件。
 */
function navigateSessionBrowser<TSession extends SessionBrowserSession>(data: SessionBrowserData<TSession>, event: InputEvent): SessionBrowserNavigationResult<TSession> {
  const current = normalizeSessionBrowserData(data);
  let next: SessionBrowserData<TSession>;

  if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
    const direction = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
    next = current.focus === 'preview'
      ? normalizeSessionBrowserData({...current, previewScroll: current.previewScroll + direction})
      : normalizeSessionBrowserData({...current, selectedIndex: current.selectedIndex + direction, previewScroll: 0});
  } else if (event.type === INPUT_EVENTS.MOVE_RIGHT || event.type === INPUT_EVENTS.TAB) {
    next = normalizeSessionBrowserData({...current, focus: 'preview'});
  } else if (event.type === INPUT_EVENTS.MOVE_LEFT) {
    next = normalizeSessionBrowserData({...current, focus: 'list'});
  } else {
    return {changed: false, data: current, handled: false};
  }

  if (next.selectedIndex !== current.selectedIndex) {
    const selected = next.sessions[next.selectedIndex];
    next = normalizeSessionBrowserData({
      ...next,
      previewScroll: 0,
      previewState: createLoadingSessionPreviewState(selected?.sessionId)
    });
  }

  return {
    changed: next.focus !== current.focus
      || next.previewScroll !== current.previewScroll
      || next.selectedIndex !== current.selectedIndex
      || next.windowStart !== current.windowStart,
    data: next,
    handled: true
  };
}

/** 修正可见列表窗口，保证绝对选中项始终位于当前页内。 */
function resolveWindowStart(selectedIndex: number, windowStart: number, totalCount: number, pageSize: number): number {
  const maxWindowStart = Math.max(0, totalCount - pageSize);
  let nextWindowStart = Math.min(Math.max(0, windowStart), maxWindowStart);

  if (selectedIndex < nextWindowStart) {
    nextWindowStart = selectedIndex;
  } else if (selectedIndex >= nextWindowStart + pageSize) {
    nextWindowStart = selectedIndex - pageSize + 1;
  }

  return Math.min(Math.max(0, nextWindowStart), maxWindowStart);
}

export {
  SESSION_BROWSER_PAGE_SIZE,
  createLoadingSessionPreviewState,
  createSessionBrowserSurface,
  formatSessionUpdatedAt,
  navigateSessionBrowser,
  normalizeSessionBrowserData
};

export type {SessionBrowserData, SessionBrowserPreviewState, SessionBrowserSession};

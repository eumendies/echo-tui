import {INPUT_EVENTS} from '../../input/event-types';

import type {InputEvent} from '../../types/input';
import type {
  ResumeCommandSurface,
  ResumeCommandSurfacePreviewRecord,
  ResumeCommandSurfaceSession
} from '../../types/command';
import type {TranscriptSessionSummary} from '../../types/transcript';

// /resume 与 /reference 共用该纯状态控制器，业务 handler 只保留文案和确认动作。

type SessionBrowserSession = Pick<TranscriptSessionSummary, 'messageCount' | 'sessionId' | 'updatedAt'>;

type SessionBrowserPreviewState = {
  sessionId: string; // 预览状态所属候选，禁止跨选择复用迟到结果。
  status: 'loading' | 'ready' | 'error'; // 右栏当前加载状态。
  records: ResumeCommandSurfacePreviewRecord[]; // ready 状态下可滚动的全量预览记录，上界由渲染层钳制。
  error?: string; // error 状态下可直接展示的稳定文案。
};

type SessionBrowserData<TSession extends SessionBrowserSession = TranscriptSessionSummary> = {
  focus: 'list' | 'preview'; // 决定上下方向键操作候选列表还是右侧预览。
  previewScroll: number; // 右侧预览相对首条渲染行的滚动偏移，仅保证非负，上界由渲染层钳制。
  selectedIndex: number; // 当前候选在完整 sessions 数组中的绝对索引。
  sessions: TSession[]; // 当前 cwd 下可供业务 handler 选择的会话摘要。
  previewState?: SessionBrowserPreviewState; // 当前选中项的异步预览状态。
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
 * 归一化会话浏览状态，统一选中项和预览滚动下界；可见窗口与预览上界由渲染层投影。
 */
function normalizeSessionBrowserData<TSession extends SessionBrowserSession>(data: Partial<SessionBrowserData<TSession>> | null | undefined): SessionBrowserData<TSession> {
  const source = data || {};
  const sessions = Array.isArray(source.sessions) ? source.sessions : [];
  const maxIndex = Math.max(0, sessions.length - 1);
  const selectedIndex = sessions.length > 0
    ? Math.min(Math.max(0, Number.isInteger(source.selectedIndex) ? Number(source.selectedIndex) : 0), maxIndex)
    : 0;
  const focus = source.focus === 'preview' ? 'preview' : 'list';
  const previewScroll = Math.max(0, Number.isInteger(source.previewScroll) ? Number(source.previewScroll) : 0);

  return {
    focus,
    previewScroll,
    selectedIndex,
    sessions,
    ...(source.previewState ? {previewState: source.previewState} : {})
  };
}

/**
 * 将共享浏览状态投影成双栏会话 surface；业务 handler 只提供标题和行标签。
 * 候选列表输出完整列表与绝对选中索引，可见窗口由渲染层按主体高度投影。
 */
function createSessionBrowserSurface<TSession extends SessionBrowserSession>(data: SessionBrowserData<TSession>, options: SessionBrowserSurfaceOptions<TSession>): ResumeCommandSurface {
  const normalized = normalizeSessionBrowserData(data);

  const selectedSession = normalized.sessions[normalized.selectedIndex];
  const asyncPreview = normalized.previewState?.sessionId === selectedSession?.sessionId
    ? normalized.previewState
    : undefined;

  return {
    kind: 'resume',
    focus: normalized.focus,
    title: options.title,
    sessions: normalized.sessions.map(options.createSessionItem),
    selectedIndex: normalized.selectedIndex,
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
      || next.selectedIndex !== current.selectedIndex,
    data: next,
    handled: true
  };
}

export {
  createLoadingSessionPreviewState,
  createSessionBrowserSurface,
  formatSessionUpdatedAt,
  navigateSessionBrowser,
  normalizeSessionBrowserData
};

export type {SessionBrowserData, SessionBrowserPreviewState, SessionBrowserSession};

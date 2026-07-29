import {INPUT_EVENTS} from '../input/event-types';

import type {InputEvent} from '../types/input';
import type {
  ResumeCommandSurface,
  ResumeCommandSurfacePreviewRecord,
  ResumeCommandSurfaceSession
} from '../types/command';
import type {TranscriptSessionMetadata} from '../types/transcript';

// /resume 与 /reference 共用该纯状态控制器，业务 handler 只保留文案和确认动作。
const SESSION_BROWSER_PAGE_SIZE = 5;
const SESSION_BROWSER_PREVIEW_PAGE_SIZE = 8;

type SessionBrowserData = {
  focus: 'list' | 'preview'; // 决定上下方向键操作候选列表还是右侧预览。
  pageSize: number; // 左侧列表一次允许显示的候选数量。
  previewScroll: number; // 右侧预览相对首条记录的滚动偏移。
  selectedIndex: number; // 当前候选在完整 sessions 数组中的绝对索引。
  sessions: TranscriptSessionMetadata[]; // 当前 cwd 下可供业务 handler 选择的会话 metadata。
  windowStart: number; // 左侧可见窗口在完整 sessions 数组中的起点。
};

type SessionBrowserSurfaceOptions = {
  createSessionItem: (session: TranscriptSessionMetadata) => ResumeCommandSurfaceSession; // 把业务会话 metadata 转换为左侧列表标签。
  dismissHint: string; // 展示在双栏 surface 底部的业务按键提示。
  emptyPreviewHint: string; // 当前会话没有可见记录时的预览占位文案。
  title: string; // 双栏 surface 顶部展示的业务标题。
};

type SessionBrowserNavigationResult = {
  changed: boolean; // 指示本次导航是否实际改变了可见状态。
  data: SessionBrowserData; // 经过边界归一化后的下一份浏览状态。
  handled: boolean; // 指示输入事件是否属于共享浏览器负责的导航事件。
};

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

/** 把持久化 preview records 收窄为 renderer 接受的中立文本记录。 */
function createSessionPreviewRecords(session: TranscriptSessionMetadata | undefined): ResumeCommandSurfacePreviewRecord[] {
  if (!session) {
    return [];
  }

  return session.previewRecords
    .map((record) => ({
      role: String(record.role || 'unknown'),
      text: record.text,
      ...(record.createdAt ? {createdAt: String(record.createdAt)} : {})
    }))
    .filter((record) => record.text.length > 0);
}

/**
 * 归一化会话浏览状态，统一列表窗口、选中项和预览滚动边界。
 */
function normalizeSessionBrowserData(data: Partial<SessionBrowserData> | null | undefined): SessionBrowserData {
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
  const maxPreviewScroll = Math.max(0, createSessionPreviewRecords(sessions[selectedIndex]).length - SESSION_BROWSER_PREVIEW_PAGE_SIZE);
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

  return {focus, pageSize, previewScroll, selectedIndex, sessions, windowStart};
}

/**
 * 将共享浏览状态投影成双栏会话 surface；业务 handler 只提供标题和行标签。
 */
function createSessionBrowserSurface(data: SessionBrowserData, options: SessionBrowserSurfaceOptions): ResumeCommandSurface {
  const normalized = normalizeSessionBrowserData(data);
  const visibleSessions = normalized.sessions.slice(normalized.windowStart, normalized.windowStart + normalized.pageSize);

  return {
    kind: 'resume',
    focus: normalized.focus,
    title: options.title,
    sessions: visibleSessions.map(options.createSessionItem),
    hiddenSessionCountAbove: normalized.windowStart,
    hiddenSessionCountBelow: Math.max(0, normalized.sessions.length - normalized.windowStart - visibleSessions.length),
    selectedIndex: Math.max(0, normalized.selectedIndex - normalized.windowStart),
    previewScroll: normalized.previewScroll,
    previewRecords: createSessionPreviewRecords(normalized.sessions[normalized.selectedIndex]),
    emptyPreviewHint: options.emptyPreviewHint,
    dismissHint: options.dismissHint
  };
}

/**
 * 处理双栏会话浏览的方向键和焦点事件，不消费确认、取消等业务事件。
 */
function navigateSessionBrowser(data: SessionBrowserData, event: InputEvent): SessionBrowserNavigationResult {
  const current = normalizeSessionBrowserData(data);
  let next: SessionBrowserData;

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
  createSessionBrowserSurface,
  formatSessionUpdatedAt,
  navigateSessionBrowser,
  normalizeSessionBrowserData
};

export type {SessionBrowserData};

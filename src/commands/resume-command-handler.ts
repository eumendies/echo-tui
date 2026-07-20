import { INPUT_EVENTS } from '../input/event-types';
import type {
  CommandHandler,
  CommandHost,
  CommandSession,
  InfoCommandSurface,
  ResumeCommandSurface,
  ResumeCommandSurfacePreviewRecord,
  ResumeCommandSurfaceSession
} from '../types/command';
import type { InputEvent } from '../types/input';
import type { TranscriptSessionMetadata } from '../types/transcript';

export const RESUME_PAGE_SIZE = 5;
const RESUME_PREVIEW_PAGE_SIZE = 8;

type ResumeSessionMetadata = TranscriptSessionMetadata;

type ResumeData = {
  focus: 'list' | 'preview';
  sessions: ResumeSessionMetadata[];
  selectedIndex: number;
  previewScroll: number;
  windowStart: number;
  pageSize: number;
};

/**
 * 格式化 session 更新时间，供恢复列表使用。
 *
 */
function formatUpdatedAt(updatedAt: string): string {
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
 * 将持久化 session metadata 转为 select surface 可显示的 option。
 *
 */
function createSessionItem(session: ResumeSessionMetadata): ResumeCommandSurfaceSession {
  const messageCount = Number.isInteger(session.messageCount) ? session.messageCount : 0;

  return {
    label: `${formatUpdatedAt(session.updatedAt)} · ${messageCount} 条消息`
  };
}

/**
 * 从 session metadata 中提取右侧预览记录。
 */
function createPreviewRecords(session: ResumeSessionMetadata | undefined): ResumeCommandSurfacePreviewRecord[] {
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
 * 根据绝对选中项修正窗口起点，保证选中项始终位于最多 5 条可见窗口内。
 *
 */
function clampWindowStart(selectedIndex: number, windowStart: number, totalCount: number, pageSize: number): number {
  const maxWindowStart = Math.max(0, totalCount - pageSize);
  let nextWindowStart = Math.min(Math.max(0, windowStart), maxWindowStart);

  if (selectedIndex < nextWindowStart) {
    nextWindowStart = selectedIndex;
  } else if (selectedIndex >= nextWindowStart + pageSize) {
    nextWindowStart = selectedIndex - pageSize + 1;
  }

  return Math.min(Math.max(0, nextWindowStart), maxWindowStart);
}

/**
 * 归一化 /resume command session data。
 *
 */
export function normalizeResumeData(data: Partial<ResumeData> | null | undefined): ResumeData {
  const source = data || {};
  const sessions = Array.isArray(source.sessions) ? source.sessions : [];
  const pageSize = Number.isInteger(source.pageSize) && Number(source.pageSize) > 0
    ? Number(source.pageSize)
    : RESUME_PAGE_SIZE;
  const maxIndex = Math.max(0, sessions.length - 1);
  const selectedIndex = sessions.length > 0
    ? Math.min(Math.max(0, Number.isInteger(source.selectedIndex) ? Number(source.selectedIndex) : 0), maxIndex)
    : 0;
  const focus = source.focus === 'preview' ? 'preview' : 'list';
  const selectedSession = sessions[selectedIndex];
  const maxPreviewScroll = Math.max(0, createPreviewRecords(selectedSession).length - RESUME_PREVIEW_PAGE_SIZE);
  const previewScroll = Math.min(
    Math.max(0, Number.isInteger(source.previewScroll) ? Number(source.previewScroll) : 0),
    maxPreviewScroll
  );
  const windowStart = clampWindowStart(
    selectedIndex,
    Number.isInteger(source.windowStart) ? Number(source.windowStart) : 0,
    sessions.length,
    pageSize
  );

  return {
    focus,
    sessions,
    selectedIndex,
    previewScroll,
    windowStart,
    pageSize
  };
}

/**
 * 将已归一化的 /resume data 投影成 renderer surface，避免事件热路径重复归一化。
 */
function createResumeSurfaceFromData(normalized: ResumeData): ResumeCommandSurface {
  const visibleSessions = normalized.sessions.slice(normalized.windowStart, normalized.windowStart + normalized.pageSize);
  const relativeSelectedIndex = Math.max(0, normalized.selectedIndex - normalized.windowStart);
  const selectedSession = normalized.sessions[normalized.selectedIndex];

  return {
    kind: 'resume',
    focus: normalized.focus,
    title: `/resume 恢复会话 (${normalized.sessions.length})`,
    sessions: visibleSessions.map(createSessionItem),
    selectedIndex: relativeSelectedIndex,
    previewScroll: normalized.previewScroll,
    previewRecords: createPreviewRecords(selectedSession),
    emptyPreviewHint: '没有可预览消息',
    dismissHint: '↑↓ 选择/滚动 · →/Tab 预览 · ← 列表 · Enter 恢复 · Esc 取消'
  };
}

/**
 * 创建无可恢复会话时的 info surface。
 *
 */
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

/**
 * 根据方向键移动 /resume 选中项；列表边界不循环。
 *
 */
function moveResumeSelection(session: CommandSession<ResumeData>, direction: number, host: CommandHost): void {
  const data = normalizeResumeData(session.data || {});

  if (data.sessions.length === 0) {
    return;
  }

  const maxIndex = data.sessions.length - 1;
  const selectedIndex = Math.min(Math.max(0, data.selectedIndex + direction), maxIndex);

  if (selectedIndex === data.selectedIndex) {
    return;
  }

  const nextData = normalizeResumeData({
    ...data,
    selectedIndex,
    previewScroll: 0,
    windowStart: clampWindowStart(selectedIndex, data.windowStart, data.sessions.length, data.pageSize)
  });

  host.session.update({
    surface: createResumeSurfaceFromData(nextData),
    data: nextData
  });
}

/**
 * 切换 /resume 双栏焦点，焦点只影响方向键语义，不改变当前选中 session。
 */
function focusResumePane(session: CommandSession<ResumeData>, focus: ResumeData['focus'], host: CommandHost): void {
  const data = normalizeResumeData(session.data || {});

  if (data.focus === focus) {
    return;
  }

  const nextData = {...data, focus};
  host.session.update({
    surface: createResumeSurfaceFromData(nextData),
    data: nextData
  });
}

/**
 * 在 preview 焦点下滚动右侧内容；越过可见窗口边界时不触发无意义重绘。
 */
function scrollResumePreview(session: CommandSession<ResumeData>, direction: number, host: CommandHost): void {
  const data = normalizeResumeData(session.data || {});
  const nextData = normalizeResumeData({
    ...data,
    previewScroll: Math.max(0, data.previewScroll + direction)
  });

  if (nextData.previewScroll === data.previewScroll) {
    return;
  }

  host.session.update({
    surface: createResumeSurfaceFromData(nextData),
    data: nextData
  });
}

/**
 * 确认恢复当前选中的 session。
 *
 */
function confirmResumeSelection(session: CommandSession<ResumeData>, host: CommandHost): void {
  const data = normalizeResumeData(session.data || {});
  const selectedSession = data.sessions[data.selectedIndex];

  if (!selectedSession) {
    return;
  }

  host.session.close();
  host.composer.reset();
  host.transcript.loadSession(selectedSession.sessionId);
}

export class ResumeCommandHandler implements CommandHandler<ResumeData> {
  name = 'resume';
  description = '恢复历史会话';

  /**
   * 只匹配纯 /resume，带参数或后缀的输入继续走普通消息路径。
   *
   */
  match(text: string): boolean {
    return text === '/resume';
  }

  /**
   * 启动 /resume，打开恢复列表或空状态 surface。
   *
   */
  start(_text: string, host: CommandHost): void {
    const sessions = host.transcript.listResumeSessions().map((session) => ({ ...session }));

    if (sessions.length === 0) {
      host.composer.reset();
      host.session.open({
        commandName: 'resume',
        handler: this,
        surface: createEmptyResumeSurface(),
        data: { focus: 'list', sessions: [], selectedIndex: 0, previewScroll: 0, windowStart: 0, pageSize: RESUME_PAGE_SIZE }
      });
      return;
    }

    const data = normalizeResumeData({
      sessions,
      focus: 'list',
      selectedIndex: 0,
      previewScroll: 0,
      windowStart: 0,
      pageSize: RESUME_PAGE_SIZE
    });

    host.composer.reset();
    host.session.open({
      commandName: 'resume',
      handler: this,
      surface: createResumeSurfaceFromData(data),
      data
    });
  }

  /**
   * /resume 活跃时按当前焦点分发选择、预览滚动、恢复和取消事件。
   *
   */
  handleEvent(session: CommandSession<ResumeData>, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.MOVE_UP) {
      const data = normalizeResumeData(session.data || {});
      if (data.focus === 'preview') {
        scrollResumePreview(session, -1, host);
      } else {
        moveResumeSelection(session, -1, host);
      }
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_DOWN) {
      const data = normalizeResumeData(session.data || {});
      if (data.focus === 'preview') {
        scrollResumePreview(session, 1, host);
      } else {
        moveResumeSelection(session, 1, host);
      }
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_RIGHT || event.type === INPUT_EVENTS.TAB) {
      focusResumePane(session, 'preview', host);
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_LEFT) {
      focusResumePane(session, 'list', host);
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      confirmResumeSelection(session, host);
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      host.session.close();
      host.composer.reset();
    }
  }
}

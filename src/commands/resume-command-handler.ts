import {INPUT_EVENTS} from '../input/event-types';
import {
  SESSION_BROWSER_PAGE_SIZE,
  createSessionBrowserSurface,
  formatSessionUpdatedAt,
  navigateSessionBrowser,
  normalizeSessionBrowserData
} from './session-browser';

import type {CommandHandler, CommandHost, CommandSession, InfoCommandSurface, ResumeCommandSurface} from '../types/command';
import type {InputEvent} from '../types/input';
import type {TranscriptSessionMetadata} from '../types/transcript';
import type {SessionBrowserData} from './session-browser';

export const RESUME_PAGE_SIZE = SESSION_BROWSER_PAGE_SIZE;

type ResumeData = SessionBrowserData;

function createSessionItem(session: TranscriptSessionMetadata): {label: string} {
  const messageCount = Number.isInteger(session.messageCount) ? session.messageCount : 0;
  return {label: `${formatSessionUpdatedAt(session.updatedAt)} · ${messageCount} 条消息`};
}

function createResumeSurfaceFromData(data: ResumeData): ResumeCommandSurface {
  return createSessionBrowserSurface(data, {
    title: `/resume 恢复会话 (${data.sessions.length})`,
    createSessionItem,
    emptyPreviewHint: '没有可预览消息',
    dismissHint: '↑↓ 选择/滚动 · →/Tab 预览 · ← 列表 · Enter 恢复 · Esc 取消'
  });
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
  const selectedSession = data.sessions[data.selectedIndex];

  if (!selectedSession) {
    return;
  }

  host.session.close();
  host.transcript.loadSession(selectedSession.sessionId);
}

export class ResumeCommandHandler implements CommandHandler<ResumeData> {
  name = 'resume';
  description = '恢复历史会话';

  match(text: string): boolean {
    return text.trimEnd() === '/resume';
  }

  /**
   * 打开可恢复会话浏览器；空列表使用说明 surface。
   */
  start(_text: string, host: CommandHost): void {
    const sessions = host.transcript.listResumeSessions().map((session) => ({...session}));

    if (sessions.length === 0) {
      host.session.open({
        commandName: 'resume',
        handler: this,
        surface: createEmptyResumeSurface(),
        data: normalizeSessionBrowserData({sessions})
      });
      return;
    }

    const data = normalizeSessionBrowserData({sessions});
    host.session.open({commandName: 'resume', handler: this, surface: createResumeSurfaceFromData(data), data});
  }

  /**
   * 复用共享浏览控制器处理列表和预览导航，并在确认时恢复目标 session。
   */
  handleEvent(session: CommandSession<ResumeData>, event: InputEvent, host: CommandHost): void {
    const navigation = navigateSessionBrowser(normalizeSessionBrowserData(session.data), event);

    if (navigation.handled) {
      if (navigation.changed) {
        host.session.update({data: navigation.data, surface: createResumeSurfaceFromData(navigation.data)});
      }
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      confirmResumeSelection(session, host);
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      host.session.close();
    }
  }
}

import {INPUT_EVENTS} from '../input/event-types';
import {
  SESSION_BROWSER_PAGE_SIZE,
  createLoadingSessionPreviewState,
  createSessionBrowserSurface,
  formatSessionUpdatedAt,
  navigateSessionBrowser,
  normalizeSessionBrowserData
} from './session/session-browser';
import {SessionBrowserPreviewController} from './session/session-browser-preview-controller';

import type {CommandHandler, CommandHost, CommandSession, InfoCommandSurface, ResumeCommandSurface} from '../types/command';
import type {InputEvent} from '../types/input';
import type {TranscriptSessionSummary} from '../types/transcript';
import type {SessionBrowserData} from './session/session-browser';

export const RESUME_PAGE_SIZE = SESSION_BROWSER_PAGE_SIZE;

type ResumeData = SessionBrowserData<TranscriptSessionSummary>;

function createSessionItem(session: TranscriptSessionSummary): {label: string} {
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
  private previewController = new SessionBrowserPreviewController<TranscriptSessionSummary>();

  match(text: string): boolean {
    return text.trimEnd() === '/resume';
  }

  /**
   * 打开可恢复会话浏览器；空列表使用说明 surface。
   */
  start(_text: string, host: CommandHost): void {
    this.previewController.invalidate();
    const sessions = host.transcript.listSessionSummaries().map((session) => ({
      ...session,
      fingerprint: {...session.fingerprint}
    }));

    if (sessions.length === 0) {
      host.session.open({
        commandName: 'resume',
        handler: this,
        surface: createEmptyResumeSurface(),
        data: normalizeSessionBrowserData({sessions})
      });
      return;
    }

    const data = normalizeSessionBrowserData<TranscriptSessionSummary>({
      sessions,
      previewState: createLoadingSessionPreviewState(sessions[0]?.sessionId)
    });
    host.session.open({commandName: 'resume', handler: this, surface: createResumeSurfaceFromData(data), data});
    this.schedulePreview(data, host, 0);
  }

  /**
   * 复用共享浏览控制器处理列表和预览导航，并在确认时恢复目标 session。
   */
  handleEvent(session: CommandSession<ResumeData>, event: InputEvent, host: CommandHost): void {
    const current = normalizeSessionBrowserData(session.data);
    const navigation = navigateSessionBrowser(current, event);

    if (navigation.handled) {
      if (navigation.changed) {
        const selectionChanged = navigation.data.selectedIndex !== current.selectedIndex;
        host.session.update({data: navigation.data, surface: createResumeSurfaceFromData(navigation.data)});
        if (selectionChanged) {
          this.schedulePreview(navigation.data, host, 120);
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
}

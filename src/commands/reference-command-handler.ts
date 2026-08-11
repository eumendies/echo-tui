import {INPUT_EVENTS} from '../input/event-types';
import {
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

// /reference 只负责会话选择交互；journal 重放和总结生命周期由 command port 处理。
type ReferenceData = SessionBrowserData<TranscriptSessionSummary>;

/** 创建没有候选会话时的只读提示 surface。 */
function createEmptySurface(): InfoCommandSurface {
  return {
    kind: 'info',
    title: '/reference',
    lines: ['当前目录没有可引用的其他历史会话。'],
    dismissHint: 'Esc 关闭'
  };
}

/** 把共享会话浏览状态投影为引用场景的标题、标签和操作提示。 */
function createReferenceSurface(data: ReferenceData): ResumeCommandSurface {
  return createSessionBrowserSurface(data, {
    title: `/reference 引用对话 (${data.sessions.length})`,
    createSessionItem(session) {
      return {label: `${formatSessionUpdatedAt(session.updatedAt)} · ${session.title}`};
    },
    emptyPreviewHint: '没有可预览消息',
    dismissHint: '↑↓ 选择/滚动 · →/Tab 预览 · ← 列表 · Enter 引用 · Esc 取消'
  });
}

/** 确认当前会话并进入 pending 状态；失败时重新打开独立错误 surface。 */
async function confirmReference(session: CommandSession<ReferenceData>, host: CommandHost): Promise<void> {
  const data = normalizeSessionBrowserData(session.data);
  const selected = data.sessions[data.selectedIndex];

  if (!selected) {
    return;
  }

  host.session.close();
  const result = await host.reference.prepare(selected);

  if (result.ok) {
    return;
  }

  host.session.open({
    commandName: 'reference',
    handler: new ReferenceCommandHandler(),
    surface: {
      kind: 'info',
      title: '/reference 引用失败',
      lines: [result.error || '引用准备失败'],
      dismissHint: 'Esc 关闭'
    },
    data: null
  });
}

export class ReferenceCommandHandler implements CommandHandler<ReferenceData> {
  name = 'reference';
  description = '引用历史对话';
  private previewController = new SessionBrowserPreviewController<TranscriptSessionSummary>();

  /** 只匹配无参数的 /reference，尾随空白由 command runtime 统一容忍。 */
  match(text: string): boolean {
    return text.trimEnd() === '/reference';
  }

  /**
   * 打开整会话选择器；首帧只读取当前 cwd 的轻量摘要，不改变当前 transcript。
   */
  start(_text: string, host: CommandHost): void {
    this.previewController.invalidate();
    const sessions = host.reference.listSessionSummaries().map((session) => ({
      ...session,
      fingerprint: {...session.fingerprint}
    }));

    if (sessions.length === 0) {
      host.session.open({commandName: 'reference', handler: this, surface: createEmptySurface(), data: null});
      return;
    }

    const data = normalizeSessionBrowserData<TranscriptSessionSummary>({
      sessions,
      previewState: createLoadingSessionPreviewState(sessions[0]?.sessionId)
    });
    host.session.open({commandName: 'reference', handler: this, surface: createReferenceSurface(data), data});
    this.schedulePreview(data, host, 0);
  }

  /**
   * 复用共享浏览控制器处理列表和预览导航；确认只加载目标会话，长会话总结延后到发送。
   */
  handleEvent(session: CommandSession<ReferenceData>, event: InputEvent, host: CommandHost): void | Promise<void> {
    if (!session.data) {
      if (event.type === INPUT_EVENTS.ESCAPE) {
        host.session.close();
      }
      return;
    }

    const current = normalizeSessionBrowserData(session.data);
    const navigation = navigateSessionBrowser(current, event);
    if (navigation.handled) {
      if (navigation.changed) {
        const selectionChanged = navigation.data.selectedIndex !== current.selectedIndex;
        host.session.update({data: navigation.data, surface: createReferenceSurface(navigation.data)});
        if (selectionChanged) {
          this.schedulePreview(navigation.data, host, 120);
        }
      }
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      this.previewController.invalidate();
      return confirmReference(session, host);
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.previewController.invalidate();
      host.session.close();
    }
  }

  /** 延迟加载稳定选中项，具体防抖和迟到结果隔离由共享 controller 负责。 */
  private schedulePreview(data: ReferenceData, host: CommandHost, delayMs: number): void {
    this.previewController.schedule({
      commandName: 'reference',
      createSurface: createReferenceSurface,
      data,
      delayMs,
      errorMessage: '无法读取会话预览',
      host,
      loadPreview: (candidate) => host.reference.loadSessionPreview(candidate)
    });
  }
}

export {createReferenceSurface};

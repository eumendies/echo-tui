import {INPUT_EVENTS} from '../input/event-types';
import {calculateCopyPreviewMaxScroll} from '../render/footer/copy-surface';

import type {
  CommandHandler,
  CommandHost,
  CommandSession,
  CopyableMessageRecord,
  CopyCommandSurface,
  InfoCommandSurface
} from '../types/command';
import type {InputEvent, MouseWheelDirection} from '../types/input';
import type {FooterMouseTarget, FooterWheelPane} from '../types/render';

type CopyCommandData = {
  focus: 'list' | 'preview';
  messages: CopyableMessageRecord[];
  notice?: string;
  previewScroll: number;
  selectedIds: string[];
  selectedIndex: number;
};

function createEmptyCopySurface(): InfoCommandSurface {
  return {
    kind: 'info',
    title: '/copy 复制消息',
    lines: ['当前会话没有可复制的 user 或 assistant 消息。'],
    dismissHint: 'Esc 关闭'
  };
}

function createInitialCopyData(messages: CopyableMessageRecord[]): CopyCommandData {
  const assistantIndex = findLastIndex(messages, (message) => message.role === 'assistant');
  const selectedIndex = assistantIndex >= 0 ? assistantIndex : Math.max(0, messages.length - 1);
  const selected = messages[selectedIndex];

  return {
    focus: 'list',
    messages,
    previewScroll: 0,
    selectedIds: selected ? [selected.id] : [],
    selectedIndex
  };
}

function createCopySurface(data: CopyCommandData): CopyCommandSurface {
  return {
    kind: 'copy',
    title: '/copy 复制消息',
    dismissHint: '↑↓ 移动/滚动 · →/Tab 预览 · ← 列表 · Space 选择 · Enter 复制 · Esc 取消',
    focus: data.focus,
    messages: data.messages.map((message) => ({
      ...message,
      selected: data.selectedIds.includes(message.id)
    })),
    notice: data.notice,
    previewScroll: data.previewScroll,
    selectedIds: [...data.selectedIds],
    selectedIndex: data.selectedIndex
  };
}

function updateCopySession(data: CopyCommandData, host: CommandHost): void {
  host.session.update({data, surface: createCopySurface(data)});
}

function moveSelection(session: CommandSession<CopyCommandData>, direction: number, host: CommandHost): void {
  const data = session.data;

  if (!data) {
    return;
  }

  const selectedIndex = Math.min(Math.max(0, data.selectedIndex + direction), data.messages.length - 1);
  updateCopySession({...data, notice: undefined, previewScroll: 0, selectedIndex}, host);
}

function toggleCurrent(session: CommandSession<CopyCommandData>, host: CommandHost): void {
  const data = session.data;
  const current = data?.messages[data.selectedIndex];

  if (!data || !current) {
    return;
  }

  const selectedIds = data.selectedIds.includes(current.id)
    ? data.selectedIds.filter((id) => id !== current.id)
    : [...data.selectedIds, current.id];

  updateCopySession({...data, notice: undefined, selectedIds}, host);
}

function focusPane(session: CommandSession<CopyCommandData>, focus: CopyCommandData['focus'], host: CommandHost): void {
  const data = session.data;

  if (!data || data.focus === focus) {
    return;
  }

  updateCopySession({...data, focus, notice: undefined}, host);
}

function scrollPreview(session: CommandSession<CopyCommandData>, direction: number, host: CommandHost): void {
  const data = session.data;

  if (!data) {
    return;
  }

  const previewScroll = Math.max(0, data.previewScroll + direction);

  if (previewScroll === data.previewScroll) {
    return;
  }

  updateCopySession({...data, notice: undefined, previewScroll}, host);
}

function selectCopyMessage(session: CommandSession<CopyCommandData>, index: number, activate: boolean, host: CommandHost): void {
  const data = session.data;
  const message = Number.isInteger(index) ? data?.messages[index] : undefined;

  if (!data || !message) {
    return;
  }

  const selectedIds = activate
    ? data.selectedIds.includes(message.id)
      ? data.selectedIds.filter((id) => id !== message.id)
      : [...data.selectedIds, message.id]
    : data.selectedIds;
  const nextData = {
    ...data,
    focus: 'list' as const,
    notice: undefined,
    previewScroll: 0,
    selectedIndex: index,
    selectedIds
  };

  if (nextData.focus !== data.focus
    || nextData.previewScroll !== data.previewScroll
    || nextData.selectedIndex !== data.selectedIndex
    || nextData.notice !== data.notice
    || nextData.selectedIds !== data.selectedIds) {
    updateCopySession(nextData, host);
  }
}

function formatCopyText(messages: CopyableMessageRecord[], selectedIds: string[]): string {
  const selected = messages.filter((message) => selectedIds.includes(message.id));

  if (selected.length === 1) {
    return selected[0].text;
  }

  return selected.map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}:\n${message.text}`).join('\n\n');
}

async function confirmCopy(session: CommandSession<CopyCommandData>, host: CommandHost): Promise<void> {
  const data = session.data;

  if (!data) {
    return;
  }

  if (data.selectedIds.length === 0) {
    const nextData = {...data, notice: '请先选择至少一条消息。'};
    host.session.update({data: nextData, surface: createCopySurface(nextData)});
    return;
  }

  const selectedCount = data.messages.filter((message) => data.selectedIds.includes(message.id)).length;
  const result = await host.clipboard.writeText(formatCopyText(data.messages, data.selectedIds));

  if (host.session.getActive() !== session) {
    return;
  }

  if (!result.ok) {
    const nextData = {...data, notice: `复制失败：${result.error}`};
    host.session.update({data: nextData, surface: createCopySurface(nextData)});
    return;
  }

  host.session.close();
  host.transcript.append({
    role: 'local_notice',
    text: `已复制 ${selectedCount} 条消息到剪贴板。`
  });
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      return index;
    }
  }

  return -1;
}

export class CopyCommandHandler implements CommandHandler<CopyCommandData> {
  name = 'copy';
  description = '复制会话消息';
  allowDuringAssistantTurn = true;

  /**
   * 只匹配 /copy 和尾随空白，避免带参数时误消费普通消息。
   */
  match(text: string): boolean {
    return text.trimEnd() === '/copy';
  }

  /**
   * 启动消息复制面板，使用当前 transcript 的 user/assistant 快照。
   */
  start(_text: string, host: CommandHost): void {
    const messages = host.transcript.listCopyableRecords();

    if (messages.length === 0) {
      host.session.open({
        commandName: 'copy',
        handler: this,
        surface: createEmptyCopySurface(),
        data: null
      });
      return;
    }

    const data = createInitialCopyData(messages);
    host.session.open({
      commandName: 'copy',
      handler: this,
      surface: createCopySurface(data),
      data
    });
  }

  /**
   * copy surface 支持上下移动、Space 多选、Enter 复制和 Esc 取消。
   */
  handleEvent(session: CommandSession<CopyCommandData>, event: InputEvent, host: CommandHost): void | Promise<void> {
    if (!session.data) {
      if (event.type === INPUT_EVENTS.ESCAPE) {
        host.session.close();
      }
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP) {
      if (session.data.focus === 'preview') {
        scrollPreview(session, -1, host);
        return;
      }

      moveSelection(session, -1, host);
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_DOWN) {
      if (session.data.focus === 'preview') {
        scrollPreview(session, 1, host);
        return;
      }

      moveSelection(session, 1, host);
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_RIGHT || event.type === INPUT_EVENTS.TAB) {
      focusPane(session, 'preview', host);
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_LEFT) {
      focusPane(session, 'list', host);
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === ' ') {
      toggleCurrent(session, host);
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      return confirmCopy(session, host);
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      host.session.close();
    }
  }

  handlePointer(session: CommandSession<CopyCommandData>, target: FooterMouseTarget, activate: boolean, host: CommandHost): void {
    if (target.kind === 'command_copy_message' && session.surface.kind === 'copy') {
      selectCopyMessage(session, target.index, activate, host);
    }
  }

  /** 仅滚动当前消息的右侧预览，不改变消息选择或剪贴板状态。 */
  handleWheel(session: CommandSession<CopyCommandData>, _pane: FooterWheelPane, direction: MouseWheelDirection, host: CommandHost): void {
    const data = session.data;
    if (session.surface.kind !== 'copy' || !data || data.messages.length === 0) {
      return;
    }
    const step = direction === 'up' ? -1 : 1;
    const {width, maxLines} = host.status.getViewport();
    // 键盘历史路径可能留下超出视口的偏移；按可见边界静默，避免滚轮拉回并抢焦点。
    const maxScroll = calculateCopyPreviewMaxScroll(session.surface, width, maxLines);
    const visibleScroll = Math.min(data.previewScroll, maxScroll);
    const previewScroll = Math.min(Math.max(0, visibleScroll + step), maxScroll);
    if (previewScroll !== visibleScroll) {
      updateCopySession({...data, focus: 'preview', notice: undefined, previewScroll}, host);
    }
  }
}

export {createCopySurface, formatCopyText};

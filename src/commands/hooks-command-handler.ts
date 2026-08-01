import {DEFAULT_HOOK_TIMEOUT_MS, validateLifecycleHookCommand, validateLifecycleHookTimeoutMs} from '../hooks/config';
import {INPUT_EVENTS} from '../input/event-types';
import {applyComposerEditEvent, getText} from '../input/composer';

import type {
  CommandHandler,
  CommandHost,
  CommandSession,
  HooksCommandEditTarget,
  HooksCommandSurface,
  HooksCommandSurfaceTest
} from '../types/command';
import type {LifecycleHookConfigDiagnostic, LifecycleHookConfigDraft, LifecycleHookDraftEntry, LifecycleHookEventName} from '../types/hooks';
import type {InputEvent} from '../types/input';

type HooksManageData = {
  commandScroll: number;
  draft: LifecycleHookConfigDraft;
  editBuffer?: string;
  editCursor?: number;
  editTarget?: HooksCommandEditTarget;
  detailIndex: number;
  entryIndex: number;
  error?: string;
  eventIndex: number;
  mode: HooksCommandSurface['mode'];
  test?: HooksCommandSurfaceTest;
};

const HOOKS_DETAIL_ROW_COUNT = 6;
const HOOKS_COMMAND_SCROLL_STEP = 4;

function createHooksManageData(draft: LifecycleHookConfigDraft): HooksManageData {
  return normalizeHooksManageData({
    commandScroll: 0,
    draft,
    detailIndex: 0,
    entryIndex: 0,
    eventIndex: 0,
    mode: 'events'
  });
}

function createHooksSurface(data: HooksManageData): HooksCommandSurface {
  const eventDraft = data.draft.events[data.eventIndex];

  return {
    kind: 'hooks',
    title: 'HOOKS',
    mode: data.mode,
    diagnostics: data.draft.diagnostics.map(formatDiagnostic),
    events: data.draft.events.map((item) => ({
      event: item.event,
      count: item.entries.length
    })),
    selectedEvent: eventDraft.event,
    eventIndex: data.eventIndex,
    entries: eventDraft.entries.map((entry) => ({...entry})),
    entryIndex: data.entryIndex,
    commandScroll: data.commandScroll,
    editBuffer: data.editBuffer,
    editCursor: data.editCursor,
    editTarget: data.editTarget,
    detailIndex: data.detailIndex,
    error: data.error,
    test: data.test ? cloneTestState(data.test) : undefined,
    dismissHint: createHooksDismissHint(data)
  };
}

export class HooksCommandHandler implements CommandHandler<HooksManageData> {
  name = 'hooks';
  description = '查看、管理和测试 lifecycle hooks';

  match(text: string): boolean {
    return text.trimEnd() === '/hooks';
  }

  start(_text: string, host: CommandHost): void {
    const data = createHooksManageData(host.hooks.readDraft());
    host.session.open({
      commandName: 'hooks',
      handler: this,
      surface: createHooksSurface(data),
      data
    });
  }

  handleEvent(session: CommandSession<HooksManageData>, event: InputEvent, host: CommandHost): void | Promise<void> {
    const data = session.data;

    if (!data) {
      return undefined;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      if (data.editTarget) {
        this.updateSession(host, {...data, commandScroll: 0, editBuffer: undefined, editCursor: undefined, editTarget: undefined, error: undefined});
        return undefined;
      }

      if (data.mode === 'entryDetail') {
        this.updateSession(host, {...data, commandScroll: 0, detailIndex: 0, error: undefined, mode: 'entries', test: undefined});
        return undefined;
      }

      host.session.close();
      return undefined;
    }

    if (data.editTarget) {
      this.handleEditEvent(data, event, host);
      return undefined;
    }

    if (data.mode === 'events') {
      this.handleEventsEvent(data, event, host);
      return undefined;
    }

    if (data.mode === 'entryDetail') {
      return this.handleEntryDetailEvent(data, event, host);
    }

    return this.handleEntriesEvent(data, event, host);
  }

  private handleEventsEvent(data: HooksManageData, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const direction = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      this.updateSession(host, {...data, commandScroll: 0, eventIndex: data.eventIndex + direction, entryIndex: 0, error: undefined, test: undefined});
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      this.updateSession(host, {...data, commandScroll: 0, entryIndex: 0, error: undefined, mode: 'entries', test: undefined});
      return;
    }

    return;
  }

  private handleEntriesEvent(data: HooksManageData, event: InputEvent, host: CommandHost): void | Promise<void> {
    const entries = getActiveEntries(data);
    const activeRow = getActiveEntriesRow(data);

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const direction = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      this.updateSession(host, {...data, commandScroll: 0, entryIndex: data.entryIndex + direction, error: undefined});
      return undefined;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      if (activeRow.kind === 'add') {
        this.addEntry(data, host);
        return undefined;
      }

      if (activeRow.kind === 'save') {
        this.saveDraft(data, host);
        return undefined;
      }

      if (entries.length > 0 && activeRow.kind === 'entry') {
        this.updateSession(host, {...data, commandScroll: 0, detailIndex: 0, entryIndex: activeRow.entryIndex, error: undefined, mode: 'entryDetail', test: undefined});
      }
      return undefined;
    }

    if (event.type !== INPUT_EVENTS.TEXT) {
      return undefined;
    }

    if (entries.length === 0 || activeRow.kind !== 'entry') {
      return undefined;
    }

    if (event.value === ' ') {
      this.toggleEntry(data, host);
      return undefined;
    }

    if (event.value === 'd') {
      this.deleteEntry(data, host, 'entries');
      return undefined;
    }

    if (event.value === 't') {
      return this.testEntry(data, host);
    }

    return undefined;
  }

  private handleEntryDetailEvent(data: HooksManageData, event: InputEvent, host: CommandHost): void | Promise<void> {
    if (!getActiveEntry(data)) {
      this.updateSession(host, {...data, detailIndex: 0, mode: 'entries'});
      return undefined;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const direction = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      this.updateSession(host, {...data, detailIndex: data.detailIndex + direction, error: undefined});
      return undefined;
    }

    if (data.detailIndex === 0 && isCommandScrollEvent(event)) {
      this.handleCommandScrollEvent(data, event, host);
      return undefined;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      return this.activateDetailRow(data, host);
    }

    if (event.type !== INPUT_EVENTS.TEXT) {
      return undefined;
    }

    if (event.value === 't') {
      return this.testEntry(data, host);
    }

    if (event.value === 'd') {
      this.deleteEntry(data, host, 'entries');
      return undefined;
    }

    if (event.value === ' ') {
      this.toggleEntry(data, host);
    }

    return undefined;
  }

  private activateDetailRow(data: HooksManageData, host: CommandHost): void | Promise<void> {
    if (data.detailIndex === 0) {
      this.beginEditField(data, host, 'command');
      return undefined;
    }

    if (data.detailIndex === 1) {
      this.beginEditField(data, host, 'timeoutMs');
      return undefined;
    }

    if (data.detailIndex === 2) {
      this.toggleEntry(data, host);
      return undefined;
    }

    if (data.detailIndex === 3) {
      return this.testEntry(data, host);
    }

    if (data.detailIndex === 4) {
      this.deleteEntry(data, host, 'entries');
      return undefined;
    }

    if (data.detailIndex === 5) {
      this.saveDraft(data, host);
      return undefined;
    }

    return undefined;
  }

  private handleCommandScrollEvent(data: HooksManageData, event: InputEvent, host: CommandHost): void {
    const command = getActiveEntry(data)?.command || '';
    const commandLength = Array.from(command).length;

    if (event.type === INPUT_EVENTS.MOVE_HOME) {
      this.updateSession(host, {...data, commandScroll: 0, error: undefined});
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_END) {
      this.updateSession(host, {...data, commandScroll: Math.max(0, commandLength - 1), error: undefined});
      return;
    }

    const direction = event.type === INPUT_EVENTS.MOVE_LEFT ? -1 : 1;
    this.updateSession(host, {...data, commandScroll: data.commandScroll + direction * HOOKS_COMMAND_SCROLL_STEP, error: undefined});
  }

  private handleEditEvent(data: HooksManageData, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.SUBMIT) {
      this.commitFieldEdit(data, host);
      return;
    }

    const nextEdit = applyInlineEdit(data.editBuffer || '', data.editCursor, event);

    if (nextEdit === null) {
      return;
    }

    this.updateSession(host, {...data, editBuffer: nextEdit.text, editCursor: nextEdit.cursor, error: undefined});
  }

  private addEntry(data: HooksManageData, host: CommandHost): void {
    const draft = cloneHooksDraft(data.draft);
    const eventIndex = clampIndex(data.eventIndex, draft.events.length);
    const entries = draft.events[eventIndex].entries;

    entries.push({command: '', enabled: true, timeoutMs: DEFAULT_HOOK_TIMEOUT_MS});
    this.updateSession(host, {
      ...data,
      commandScroll: 0,
      draft,
      editBuffer: '',
      editCursor: 0,
      editTarget: 'command',
      detailIndex: 0,
      entryIndex: entries.length - 1,
      error: undefined,
      mode: 'entryDetail',
      test: undefined
    });
  }

  private beginEditField(data: HooksManageData, host: CommandHost, target: HooksCommandEditTarget): void {
    const entry = getActiveEntry(data);

    if (!entry) {
      return;
    }

    const editBuffer = target === 'timeoutMs' ? String(entry.timeoutMs) : entry.command;
    this.updateSession(host, {...data, commandScroll: target === 'command' ? 0 : data.commandScroll, editBuffer, editCursor: Array.from(editBuffer).length, editTarget: target, detailIndex: target === 'timeoutMs' ? 1 : 0, error: undefined, mode: 'entryDetail'});
  }

  private commitFieldEdit(data: HooksManageData, host: CommandHost): void {
    if (data.editTarget === 'timeoutMs') {
      this.commitTimeoutEdit(data, host);
      return;
    }

    this.commitCommandEdit(data, host);
  }

  private commitCommandEdit(data: HooksManageData, host: CommandHost): void {
    const draft = cloneHooksDraft(data.draft);
    const entry = getDraftEntry(draft, data.eventIndex, data.entryIndex);
    const command = data.editBuffer || '';

    if (!entry) {
      this.updateSession(host, {...data, editBuffer: undefined, editCursor: undefined, editTarget: undefined, mode: 'entries'});
      return;
    }

    entry.command = command.trim();
    const validation = validateLifecycleHookCommand(entry.command);
    this.updateSession(host, {
      ...data,
      commandScroll: 0,
      draft,
      editBuffer: validation.ok ? undefined : command,
      editCursor: validation.ok ? undefined : data.editCursor,
      editTarget: validation.ok ? undefined : 'command',
      error: validation.ok ? undefined : `${validation.message}，保存前需要修正。`,
      mode: 'entryDetail',
      test: undefined
    });
  }

  private commitTimeoutEdit(data: HooksManageData, host: CommandHost): void {
    const rawTimeout = Number(data.editBuffer || '');
    const validation = validateLifecycleHookTimeoutMs(rawTimeout);

    if (!validation.ok) {
      this.updateSession(host, {...data, error: `${validation.message}。`});
      return;
    }

    const draft = cloneHooksDraft(data.draft);
    const entry = getDraftEntry(draft, data.eventIndex, data.entryIndex);

    if (entry) {
      entry.timeoutMs = rawTimeout;
    }

    this.updateSession(host, {
      ...data,
      commandScroll: 0,
      draft,
      editBuffer: undefined,
      editCursor: undefined,
      editTarget: undefined,
      error: undefined,
      mode: 'entryDetail',
      test: undefined
    });
  }

  private toggleEntry(data: HooksManageData, host: CommandHost): void {
    const draft = cloneHooksDraft(data.draft);
    const entry = getDraftEntry(draft, data.eventIndex, data.entryIndex);

    if (entry) {
      entry.enabled = !entry.enabled;
    }

    this.updateSession(host, {...data, draft, error: undefined, test: undefined});
  }

  private deleteEntry(data: HooksManageData, host: CommandHost, nextMode: HooksCommandSurface['mode']): void {
    const draft = cloneHooksDraft(data.draft);
    const eventIndex = clampIndex(data.eventIndex, draft.events.length);
    const entries = draft.events[eventIndex].entries;

    if (entries.length === 0) {
      return;
    }

    entries.splice(clampIndex(data.entryIndex, entries.length), 1);
    this.updateSession(host, {
      ...data,
      commandScroll: 0,
      draft,
      detailIndex: 0,
      editBuffer: undefined,
      editCursor: undefined,
      editTarget: undefined,
      entryIndex: Math.min(data.entryIndex, Math.max(0, entries.length - 1)),
      error: undefined,
      mode: nextMode,
      test: undefined
    });
  }

  private saveDraft(data: HooksManageData, host: CommandHost): void {
    const result = host.hooks.saveDraft(cloneHooksDraft(data.draft));

    if (result.ok) {
      host.session.close();
      return;
    }

    this.updateSession(host, {...data, error: `保存 hooks 配置失败：${result.error}`});
  }

  private testEntry(data: HooksManageData, host: CommandHost): Promise<void> | undefined {
    const entry = getActiveEntry(data);
    const event = getActiveEventName(data);

    if (!entry || !event) {
      return undefined;
    }

    const validation = validateLifecycleHookCommand(entry.command);

    if (!validation.ok) {
      this.updateSession(host, {...data, error: `${validation.message}，无法测试。`});
      return undefined;
    }

    const runningTest: HooksCommandSurfaceTest = {
      command: entry.command,
      entryIndex: data.entryIndex,
      event,
      status: 'running'
    };
    this.updateSession(host, {...data, error: undefined, test: runningTest});

    return host.hooks.testEntry(event, {...entry}).then((result) => {
      const active = host.session.getActive() as CommandSession<HooksManageData> | null;

      if (!active || active.commandName !== 'hooks' || !active.data) {
        return;
      }

      const nextData = {
        ...active.data,
        test: {
          ...runningTest,
          result,
          status: 'completed' as const
        }
      };
      this.updateSession(host, nextData);
    });
  }

  private updateSession(host: CommandHost, data: HooksManageData): void {
    const nextData = normalizeHooksManageData(data);
    host.session.update({surface: createHooksSurface(nextData), data: nextData});
  }
}

function createHooksDismissHint(data: HooksManageData): string {
  if (data.mode === 'events') {
    return '↑/↓ 选择事件 · Enter 查看 Hook · Esc 取消';
  }

  if (data.editTarget === 'command') {
    return '编辑命令 · ←/→ 移动光标 · Enter 确认 · Esc 返回';
  }

  if (data.editTarget === 'timeoutMs') {
    return '编辑超时时间 · Enter 确认 · Esc 返回';
  }

  if (data.mode === 'entryDetail') {
    if (!data.editTarget && data.detailIndex === 0) {
      return '↑/↓ 移动 · ←/→ 查看命令 · Enter 编辑 · Esc 返回';
    }

    return '↑/↓ 移动 · Enter 编辑/执行/保存 · Esc 返回';
  }

  return '↑/↓ 选择 · Enter 查看/执行 · d 删除 · t 测试 · Esc 取消';
}

function applyInlineEdit(text: string, cursor: number | undefined, event: InputEvent): {cursor: number; text: string} | null {
  const chars = Array.from(text);
  const composer = {
    chars,
    cursor: Math.min(Math.max(0, Number.isInteger(cursor) ? Number(cursor) : chars.length), chars.length)
  };

  if (!applyComposerEditEvent(composer, event)) {
    return null;
  }

  return {cursor: composer.cursor, text: getText(composer)};
}

function normalizeHooksManageData(source: HooksManageData): HooksManageData {
  const draft = cloneHooksDraft(source.draft);
  const eventIndex = clampIndex(source.eventIndex, draft.events.length);
  const entries = draft.events[eventIndex]?.entries || [];
  const mode = source.mode === 'entryDetail' && entries.length === 0 ? 'entries' : source.mode;
  const entryIndex = mode === 'entries'
    ? clampIndex(source.entryIndex, entries.length + 2)
    : clampIndex(source.entryIndex, entries.length);
  const editTarget = mode === 'entryDetail' ? source.editTarget : undefined;
  const commandScroll = mode === 'entryDetail' && !editTarget ? Math.max(0, Math.floor(source.commandScroll || 0)) : 0;
  const editBuffer = editTarget ? source.editBuffer || '' : undefined;
  const editLength = Array.from(editBuffer || '').length;
  const editCursor = editTarget
    ? Math.min(Math.max(0, Number.isInteger(source.editCursor) ? Number(source.editCursor) : editLength), editLength)
    : undefined;

  return {
    ...source,
    commandScroll,
    draft,
    detailIndex: clampIndex(source.detailIndex, HOOKS_DETAIL_ROW_COUNT),
    eventIndex,
    entryIndex,
    editBuffer,
    editCursor,
    editTarget,
    mode,
    test: source.test ? cloneTestState(source.test) : undefined
  };
}

function cloneHooksDraft(draft: LifecycleHookConfigDraft): LifecycleHookConfigDraft {
  return {
    configPath: draft.configPath,
    diagnostics: draft.diagnostics.map((diagnostic) => ({...diagnostic})),
    events: draft.events.map((eventDraft) => ({
      event: eventDraft.event,
      entries: eventDraft.entries.map((entry) => ({...entry}))
    }))
  };
}

function cloneTestState(test: HooksCommandSurfaceTest): HooksCommandSurfaceTest {
  return {
    ...test,
    result: test.result ? {...test.result} : undefined
  };
}

function formatDiagnostic(diagnostic: LifecycleHookConfigDiagnostic): string {
  const location = [diagnostic.event, typeof diagnostic.index === 'number' ? `#${diagnostic.index + 1}` : undefined]
    .filter(Boolean)
    .join(' ');
  return location ? `${location}: ${diagnostic.message}` : diagnostic.message;
}

function getActiveEventName(data: HooksManageData): LifecycleHookEventName | undefined {
  return data.draft.events[clampIndex(data.eventIndex, data.draft.events.length)]?.event;
}

function getActiveEntries(data: HooksManageData): LifecycleHookDraftEntry[] {
  return data.draft.events[clampIndex(data.eventIndex, data.draft.events.length)]?.entries || [];
}

function getActiveEntry(data: HooksManageData): LifecycleHookDraftEntry | undefined {
  const entries = getActiveEntries(data);
  return entries[clampIndex(data.entryIndex, entries.length)];
}

function getActiveEntriesRow(data: HooksManageData): {kind: 'entry'; entryIndex: number} | {kind: 'add'} | {kind: 'save'} {
  const entries = getActiveEntries(data);
  const rowIndex = clampIndex(data.entryIndex, entries.length + 2);

  if (rowIndex < entries.length) {
    return {kind: 'entry', entryIndex: rowIndex};
  }

  return rowIndex === entries.length ? {kind: 'add'} : {kind: 'save'};
}

function isCommandScrollEvent(event: InputEvent): boolean {
  return event.type === INPUT_EVENTS.MOVE_LEFT || event.type === INPUT_EVENTS.MOVE_RIGHT || event.type === INPUT_EVENTS.MOVE_HOME || event.type === INPUT_EVENTS.MOVE_END;
}

function getDraftEntry(draft: LifecycleHookConfigDraft, eventIndex: number, entryIndex: number): LifecycleHookDraftEntry | undefined {
  const entries = draft.events[clampIndex(eventIndex, draft.events.length)]?.entries || [];
  return entries[clampIndex(entryIndex, entries.length)];
}

function clampIndex(index: number | undefined, count: number): number {
  if (count <= 0) {
    return 0;
  }

  return Math.min(Math.max(Number.isInteger(index) ? Number(index) : 0, 0), count - 1);
}

export {createHooksManageData, createHooksSurface};

export type {HooksManageData};

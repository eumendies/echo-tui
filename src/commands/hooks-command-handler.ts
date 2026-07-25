import {DEFAULT_HOOK_TIMEOUT_MS, validateLifecycleHookCommand, validateLifecycleHookTimeoutMs} from '../hooks/config';
import {INPUT_EVENTS} from '../input/event-types';

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
  draft: LifecycleHookConfigDraft;
  editBuffer?: string;
  editTarget?: HooksCommandEditTarget;
  detailIndex: number;
  entryIndex: number;
  error?: string;
  eventIndex: number;
  mode: HooksCommandSurface['mode'];
  test?: HooksCommandSurfaceTest;
};

const HOOKS_DETAIL_ROW_COUNT = 5;

function createHooksManageData(draft: LifecycleHookConfigDraft): HooksManageData {
  return normalizeHooksManageData({
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
    editBuffer: data.editBuffer,
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
    host.composer.reset();
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
        this.updateSession(host, {...data, editBuffer: undefined, editTarget: undefined, error: undefined});
        return undefined;
      }

      if (data.mode === 'entryDetail') {
        this.updateSession(host, {...data, detailIndex: 0, error: undefined, mode: 'entries', test: undefined});
        return undefined;
      }

      host.session.close();
      host.composer.reset();
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
      this.updateSession(host, {...data, eventIndex: data.eventIndex + direction, entryIndex: 0, error: undefined, test: undefined});
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      this.updateSession(host, {...data, entryIndex: 0, error: undefined, mode: 'entries', test: undefined});
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === 'a') {
      this.addEntry(data, host);
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === 's') {
      this.saveDraft(data, host);
    }
  }

  private handleEntriesEvent(data: HooksManageData, event: InputEvent, host: CommandHost): void | Promise<void> {
    const entries = getActiveEntries(data);

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const direction = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      this.updateSession(host, {...data, entryIndex: data.entryIndex + direction, error: undefined});
      return undefined;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      if (entries.length > 0) {
        this.updateSession(host, {...data, detailIndex: 0, error: undefined, mode: 'entryDetail', test: undefined});
      }
      return undefined;
    }

    if (event.type !== INPUT_EVENTS.TEXT) {
      return undefined;
    }

    if (event.value === 'a') {
      this.addEntry(data, host);
      return undefined;
    }

    if (event.value === 's') {
      this.saveDraft(data, host);
      return undefined;
    }

    if (entries.length === 0) {
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

    if (event.type === INPUT_EVENTS.SUBMIT) {
      return this.activateDetailRow(data, host);
    }

    if (event.type !== INPUT_EVENTS.TEXT) {
      return undefined;
    }

    if (event.value === 's') {
      this.saveDraft(data, host);
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

    return undefined;
  }

  private handleEditEvent(data: HooksManageData, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.SUBMIT) {
      this.commitFieldEdit(data, host);
      return;
    }

    const nextEdit = applyInlineEdit(data.editBuffer || '', event);

    if (nextEdit === null) {
      return;
    }

    this.updateSession(host, {...data, editBuffer: nextEdit, error: undefined});
  }

  private addEntry(data: HooksManageData, host: CommandHost): void {
    const draft = cloneHooksDraft(data.draft);
    const eventIndex = clampIndex(data.eventIndex, draft.events.length);
    const entries = draft.events[eventIndex].entries;

    entries.push({command: '', enabled: true, timeoutMs: DEFAULT_HOOK_TIMEOUT_MS});
    this.updateSession(host, {
      ...data,
      draft,
      editBuffer: '',
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
    this.updateSession(host, {...data, editBuffer, editTarget: target, detailIndex: target === 'timeoutMs' ? 1 : 0, error: undefined, mode: 'entryDetail'});
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
      this.updateSession(host, {...data, editBuffer: undefined, editTarget: undefined, mode: 'entries'});
      return;
    }

    entry.command = command.trim();
    const validation = validateLifecycleHookCommand(entry.command);
    this.updateSession(host, {
      ...data,
      draft,
      editBuffer: validation.ok ? undefined : command,
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
      draft,
      editBuffer: undefined,
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
      draft,
      detailIndex: 0,
      editBuffer: undefined,
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
      host.composer.reset();
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
    return '↑/↓ 选择 event · Enter 查看 entries · a 添加 · s 保存 · Esc 取消';
  }

  if (data.editTarget === 'command') {
    return '编辑 command · Enter 确认 · Esc 返回';
  }

  if (data.editTarget === 'timeoutMs') {
    return '编辑 timeoutMs · Enter 确认 · Esc 返回';
  }

  if (data.mode === 'entryDetail') {
    return '↑/↓ 移动 · Enter 编辑/执行 · s 保存 · Esc 返回';
  }

  return '↑/↓ 选择 · Enter 详情 · a 添加 · d 删除 · t 测试 · s 保存 · Esc 取消';
}

function applyInlineEdit(text: string, event: InputEvent): string | null {
  const chars = Array.from(text);

  switch (event.type) {
    case INPUT_EVENTS.TEXT: {
      const incoming = Array.from(event.value || '');
      chars.push(...incoming);
      return chars.join('');
    }
    case INPUT_EVENTS.BACKSPACE:
      if (chars.length === 0) {
        return text;
      }
      chars.pop();
      return chars.join('');
    case INPUT_EVENTS.DELETE_FORWARD:
      return text;
    case INPUT_EVENTS.DELETE_TO_LINE_START:
      return '';
    case INPUT_EVENTS.DELETE_TO_LINE_END:
      return text;
    default:
      return null;
  }
}

function normalizeHooksManageData(source: HooksManageData): HooksManageData {
  const draft = cloneHooksDraft(source.draft);
  const eventIndex = clampIndex(source.eventIndex, draft.events.length);
  const entries = draft.events[eventIndex]?.entries || [];
  const entryIndex = clampIndex(source.entryIndex, entries.length);
  const mode = source.mode === 'entryDetail' && entries.length === 0 ? 'entries' : source.mode;
  const editTarget = mode === 'entryDetail' ? source.editTarget : undefined;

  return {
    ...source,
    draft,
    detailIndex: clampIndex(source.detailIndex, HOOKS_DETAIL_ROW_COUNT),
    eventIndex,
    entryIndex,
    editBuffer: editTarget ? source.editBuffer || '' : undefined,
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

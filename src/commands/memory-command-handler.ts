import * as composer from '../input/composer';
import {INPUT_EVENTS} from '../input/event-types';

import type {ComposerState} from '../types/composer';
import type {CommandHandler, CommandHost, CommandSession, MemoryCommandSurface, MemoryCommandSurfaceMode} from '../types/command';
import type {InputEvent} from '../types/input';
import type {UserMemory} from '../types/memory';

type MemoryManageData = {
  memories: UserMemory[];
  selectedIndex: number;
  mode: MemoryCommandSurfaceMode;
  draft?: ComposerState;
  editingId?: string;
  error?: string;
};

function createMemorySurface(data: MemoryManageData): MemoryCommandSurface {
  return {
    kind: 'memory',
    title: 'MEMORY',
    mode: data.mode,
    memories: data.memories.map((memory) => ({...memory})),
    selectedIndex: data.selectedIndex,
    ...(data.draft ? {editText: composer.getText(data.draft), editCursor: data.draft.cursor} : {}),
    ...(data.error ? {error: data.error} : {}),
    dismissHint: createDismissHint(data)
  };
}

function createDismissHint(data: MemoryManageData): string {
  if (data.mode === 'edit') {
    return '编辑 memory · Enter 保存 · Ctrl+J 换行 · Esc 取消';
  }

  if (data.mode === 'deleteConfirm') {
    return 'Enter 确认删除 · Esc 返回';
  }

  return '↑/↓ 选择 · Space 启停 · Enter/e 编辑 · a 新增 · d 删除 · Esc 关闭';
}

function normalizeData(data: MemoryManageData): MemoryManageData {
  const selectedIndex = data.memories.length === 0 ? 0 : Math.min(Math.max(0, data.selectedIndex), data.memories.length - 1);

  return {
    ...data,
    selectedIndex,
    memories: data.memories.map((memory) => ({...memory})),
    ...(data.draft ? {draft: {chars: [...data.draft.chars], cursor: data.draft.cursor}} : {})
  };
}

export class MemoryCommandHandler implements CommandHandler<MemoryManageData> {
  name = 'memory';
  description = '查看和管理持久 memory';

  match(text: string): boolean {
    return String(text).trim() === '/memory';
  }

  start(_text: string, host: CommandHost): void {
    const result = host.memory.list();
    const data = normalizeData({
      memories: result.ok ? result.memories : [],
      selectedIndex: 0,
      mode: 'list',
      ...(result.ok ? {} : {error: result.error})
    });
    host.composer.reset();
    host.session.open({commandName: 'memory', handler: this, surface: createMemorySurface(data), data});
  }

  handleEvent(session: CommandSession<MemoryManageData>, event: InputEvent, host: CommandHost): void {
    const data = session.data;

    if (!data) {
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.handleEscape(data, host);
      return;
    }

    if (data.mode === 'edit') {
      this.handleEdit(data, event, host);
      return;
    }

    if (data.mode === 'deleteConfirm') {
      if (event.type === INPUT_EVENTS.SUBMIT) {
        this.confirmDelete(data, host);
      }
      return;
    }

    this.handleList(data, event, host);
  }

  private handleEscape(data: MemoryManageData, host: CommandHost): void {
    if (data.mode === 'edit' || data.mode === 'deleteConfirm') {
      this.update(host, {...data, mode: 'list', draft: undefined, editingId: undefined, error: undefined});
      return;
    }

    host.session.close();
    host.composer.reset();
  }

  private handleList(data: MemoryManageData, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      this.update(host, {...data, selectedIndex: data.selectedIndex + (event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1), error: undefined});
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === 'a') {
      this.update(host, {...data, mode: 'edit', draft: composer.createComposer(), editingId: undefined, error: undefined});
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === ' ') {
      this.toggleSelectedMemory(data, host);
      return;
    }

    const selected = data.memories[data.selectedIndex];

    if (!selected) {
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT || (event.type === INPUT_EVENTS.TEXT && event.value === 'e')) {
      this.update(host, {...data, mode: 'edit', draft: composer.createComposer(selected.content), editingId: selected.id, error: undefined});
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === 'd') {
      this.update(host, {...data, mode: 'deleteConfirm', error: undefined});
    }
  }

  private handleEdit(data: MemoryManageData, event: InputEvent, host: CommandHost): void {
    const draft = data.draft || composer.createComposer();

    if (event.type === INPUT_EVENTS.SUBMIT) {
      const content = composer.getText(draft);
      const result = data.editingId ? host.memory.update(data.editingId, content) : host.memory.create(content);

      if (!result.ok) {
        this.update(host, {...data, draft, error: result.error});
        return;
      }

      const selectedIndex = data.editingId ? result.memories.findIndex((memory) => memory.id === data.editingId) : result.memories.length - 1;
      this.update(host, {memories: result.memories, selectedIndex, mode: 'list'});
      return;
    }

    if (event.type === INPUT_EVENTS.INSERT_NEWLINE) {
      composer.insertNewline(draft);
      this.update(host, {...data, draft, error: undefined});
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      if (event.type === INPUT_EVENTS.MOVE_UP) {
        composer.moveUp(draft);
      } else {
        composer.moveDown(draft);
      }
      this.update(host, {...data, draft, error: undefined});
      return;
    }

    if (composer.applyComposerEditEvent(draft, event)) {
      this.update(host, {...data, draft, error: undefined});
    }
  }

  private confirmDelete(data: MemoryManageData, host: CommandHost): void {
    const selected = data.memories[data.selectedIndex];

    if (!selected) {
      this.update(host, {...data, mode: 'list'});
      return;
    }

    const result = host.memory.delete(selected.id);

    if (!result.ok) {
      this.update(host, {...data, error: result.error});
      return;
    }

    this.update(host, {memories: result.memories, selectedIndex: Math.min(data.selectedIndex, Math.max(0, result.memories.length - 1)), mode: 'list'});
  }

  private toggleSelectedMemory(data: MemoryManageData, host: CommandHost): void {
    const selected = data.memories[data.selectedIndex];

    if (!selected) {
      return;
    }

    const result = host.memory.setEnabled(selected.id, !selected.enabled);

    if (!result.ok) {
      this.update(host, {...data, error: result.error});
      return;
    }

    this.update(host, {...data, memories: result.memories, error: undefined});
  }

  private update(host: CommandHost, data: MemoryManageData): void {
    const next = normalizeData(data);
    host.session.update({surface: createMemorySurface(next), data: next});
  }
}

export {createMemorySurface};

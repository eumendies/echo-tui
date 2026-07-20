import {INPUT_EVENTS} from '../input/event-types';
import {calculateDiffDetailMaxScroll} from '../render/footer/diff-surface';

import type {CommandHandler, CommandHost, CommandSession, DiffCommandSurface, InfoCommandSurface} from '../types/command';
import type {DiffFile, DiffSourceInfo, DiffSourceResult} from '../types/diff';
import type {InputEvent} from '../types/input';

type DiffCommandData = {
  detailScroll: number;
  files: DiffFile[];
  focus: 'list' | 'detail';
  notices: string[];
  selectedIndex: number;
  source: DiffSourceInfo;
};

/**
 * 创建 `/diff` 空状态信息面板。
 */
function createDiffInfoSurface(result: DiffSourceResult): InfoCommandSurface {
  return {
    kind: 'info',
    title: '/diff',
    lines: [
      ...result.notices,
      '当前没有可展示差异。'
    ],
    dismissHint: 'Enter/Esc 关闭'
  };
}

/**
 * 将 diff command data 投影成 renderer 使用的 surface。
 */
function createDiffSurface(data: DiffCommandData): DiffCommandSurface {
  return {
    kind: 'diff',
    title: '/diff',
    source: data.source,
    files: data.files,
    notices: data.notices,
    focus: data.focus,
    selectedIndex: data.selectedIndex,
    detailScroll: data.detailScroll
  };
}

function createDiffData(result: Extract<DiffSourceResult, {status: 'ready'}>): DiffCommandData {
  return {
    source: result.source,
    files: result.files,
    notices: result.notices,
    focus: 'list',
    selectedIndex: 0,
    detailScroll: 0
  };
}

function normalizeDiffData(data: Partial<DiffCommandData> | null | undefined): DiffCommandData {
  const files = Array.isArray(data?.files) ? data.files : [];
  const selectedIndex = files.length > 0
    ? Math.min(Math.max(Number.isInteger(data?.selectedIndex) ? Number(data?.selectedIndex) : 0, 0), files.length - 1)
    : 0;

  return {
    source: data?.source || {kind: 'history', label: 'apply_patch history'},
    files,
    notices: Array.isArray(data?.notices) ? data.notices : [],
    focus: data?.focus === 'detail' ? 'detail' : 'list',
    selectedIndex,
    detailScroll: Math.max(0, Number.isInteger(data?.detailScroll) ? Number(data?.detailScroll) : 0)
  };
}

function updateDiffSession(session: CommandSession<DiffCommandData>, host: CommandHost, patch: Partial<DiffCommandData>): void {
  const nextData = normalizeDiffData({
    ...(session.data || {}),
    ...patch
  });

  host.session.update({
    data: nextData,
    surface: createDiffSurface(nextData)
  });
}

function resolveNextDetailScroll(data: DiffCommandData, host: CommandHost, direction: number): number {
  const viewport = host.diff.getViewport();
  const maxScroll = calculateDiffDetailMaxScroll(createDiffSurface(data), viewport.width, viewport.maxLines);
  return Math.min(Math.max(0, data.detailScroll + direction), maxScroll);
}

class DiffCommandHandler implements CommandHandler<DiffCommandData> {
  name = 'diff';
  description = '查看当前文件差异';

  match(text: string): boolean {
    return text.trim() === '/diff';
  }

  start(_text: string, host: CommandHost): void {
    host.composer.reset();
    const result = host.diff.getSource();

    if (result.status === 'empty') {
      host.session.open({
        commandName: 'diff',
        handler: this,
        surface: createDiffInfoSurface(result),
        data: null
      });
      return;
    }

    const data = createDiffData(result);
    host.session.open({
      commandName: 'diff',
      handler: this,
      surface: createDiffSurface(data),
      data
    });
  }

  handleEvent(session: CommandSession<DiffCommandData>, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.ESCAPE || event.type === INPUT_EVENTS.SUBMIT) {
      host.session.close();
      host.composer.reset();
      return;
    }

    if (!session.data) {
      return;
    }

    const data = normalizeDiffData(session.data);

    if (event.type === INPUT_EVENTS.MOVE_RIGHT) {
      updateDiffSession(session, host, {focus: 'detail'});
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_LEFT) {
      updateDiffSession(session, host, {focus: 'list'});
      return;
    }

    if (event.type !== INPUT_EVENTS.MOVE_UP && event.type !== INPUT_EVENTS.MOVE_DOWN) {
      return;
    }

    const direction = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;

    if (data.focus === 'list') {
      const selectedIndex = Math.min(Math.max(0, data.selectedIndex + direction), Math.max(0, data.files.length - 1));
      updateDiffSession(session, host, {selectedIndex, detailScroll: 0});
      return;
    }

    const detailScroll = resolveNextDetailScroll(data, host, direction);
    updateDiffSession(session, host, {detailScroll});
  }
}

export {
  DiffCommandHandler,
  createDiffInfoSurface,
  createDiffSurface
};

export type {
  DiffCommandData
};

import {INPUT_EVENTS} from '../input/event-types';
import {calculateDiffDetailMaxScroll} from '../render/footer/diff-surface';

import type {CommandHandler, CommandHost, CommandSession, DiffCommandSurface, InfoCommandSurface} from '../types/command';
import type {DiffFile, DiffSourceInfo, DiffSourceResult} from '../types/diff';
import type {InputEvent, MouseWheelDirection} from '../types/input';
import type {FooterMouseTarget, FooterWheelPane} from '../types/render';

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
    source: data?.source || {kind: 'history', label: 'controlled file edit history'},
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

function selectDiffFile(session: CommandSession<DiffCommandData>, index: number, host: CommandHost): void {
  const data = normalizeDiffData(session.data);

  if (!Number.isInteger(index) || !data.files[index]) {
    return;
  }

  if (data.focus !== 'list' || data.selectedIndex !== index || data.detailScroll !== 0) {
    updateDiffSession(session, host, {focus: 'list', selectedIndex: index, detailScroll: 0});
  }
}

function resolveNextDetailScroll(data: DiffCommandData, host: CommandHost, direction: number): {current: number; next: number} {
  const viewport = host.diff.getViewport();
  const maxScroll = calculateDiffDetailMaxScroll(createDiffSurface(data), viewport.width, viewport.maxLines);
  const current = Math.min(data.detailScroll, maxScroll);
  return {current, next: Math.min(Math.max(0, current + direction), maxScroll)};
}

class DiffCommandHandler implements CommandHandler<DiffCommandData> {
  name = 'diff';
  description = '查看当前文件差异';

  match(text: string): boolean {
    return text.trimEnd() === '/diff';
  }

  start(_text: string, host: CommandHost): void {
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

    const {next: detailScroll} = resolveNextDetailScroll(data, host, direction);
    updateDiffSession(session, host, {detailScroll});
  }

  handlePointer(session: CommandSession<DiffCommandData>, target: FooterMouseTarget, _activate: boolean, host: CommandHost): void {
    if (target.kind === 'command_diff_file' && session.surface.kind === 'diff') {
      selectDiffFile(session, target.index, host);
    }
  }

  /** 仅右栏滚动当前文件详情；缩屏后的过期偏移和可见边界不抢焦点。 */
  handleWheel(session: CommandSession<DiffCommandData>, _pane: FooterWheelPane, direction: MouseWheelDirection, host: CommandHost): void {
    if (session.surface.kind !== 'diff' || !session.data || session.data.files.length === 0) {
      return;
    }
    const data = normalizeDiffData(session.data);
    const step = direction === 'up' ? -1 : 1;
    const {current, next: detailScroll} = resolveNextDetailScroll(data, host, step);
    if (detailScroll !== current) {
      updateDiffSession(session, host, {focus: 'detail', detailScroll});
    }
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

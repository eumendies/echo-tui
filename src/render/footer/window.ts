import type {FooterLayout} from '../../types/render';

export type SelectedWindowRow<T> =
  | {kind: 'item'; index: number; item: T}
  | {count: number; direction: 'up' | 'down'; kind: 'more'};

/**
 * 将行数预算规范化；部分列表允许 0 行，整体 footer layout 至少保留 1 行。
 */
export function normalizeLineLimit(value: number | undefined, minimum = 1): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.floor(Number(value))) : Number.POSITIVE_INFINITY;
}

/**
 * 将索引收敛到列表范围内；空列表稳定返回 0，方便调用方继续生成空窗口。
 */
export function clampIndex(index: number | undefined, count: number): number {
  if (count <= 0) {
    return 0;
  }

  return Math.min(Math.max(Number.isInteger(index) ? Number(index) : 0, 0), count - 1);
}

/**
 * 将 cursor row 收敛到当前可见行范围，避免裁剪后光标落到不可见位置。
 */
export function clampCursorRow(cursorRow: number, lineCount: number): number {
  return Math.min(Math.max(0, cursorRow), Math.max(0, lineCount - 1));
}

/**
 * 创建包含 selectedIndex 的可见窗口；用于 slash、select、checkbox 等单行候选列表。
 */
export function createSelectedWindow<T>(items: T[], selectedIndex: number | undefined, maxItems: number): {items: T[]; start: number} {
  const normalizedMaxItems = normalizeLineLimit(maxItems, 0);

  if (normalizedMaxItems <= 0) {
    return {items: [], start: 0};
  }

  if (items.length <= normalizedMaxItems) {
    return {items, start: 0};
  }

  const selected = clampIndex(selectedIndex, items.length);
  const half = Math.floor(normalizedMaxItems / 2);
  const start = Math.min(Math.max(0, selected - half), Math.max(0, items.length - normalizedMaxItems));

  return {
    items: items.slice(start, start + normalizedMaxItems),
    start
  };
}

/**
 * 创建带 more 提示的可见窗口；提示行计入预算，避免 hint 自身撑高 footer。
 */
export function createSelectedWindowRows<T>(items: T[], selectedIndex: number | undefined, maxRows: number): SelectedWindowRow<T>[] {
  const normalizedMaxRows = normalizeLineLimit(maxRows, 0);

  if (normalizedMaxRows <= 0) {
    return [];
  }

  if (items.length <= normalizedMaxRows) {
    return items.map((item, index) => ({kind: 'item', item, index}));
  }

  if (normalizedMaxRows < 3) {
    const window = createSelectedWindow(items, selectedIndex, normalizedMaxRows);
    return window.items.map((item, offset) => ({kind: 'item', item, index: window.start + offset}));
  }

  const selected = clampIndex(selectedIndex, items.length);
  let showTopHint = false;
  let showBottomHint = false;
  let start = 0;
  let itemSlots = normalizedMaxRows;

  for (let index = 0; index < 3; index += 1) {
    itemSlots = Math.max(1, normalizedMaxRows - (showTopHint ? 1 : 0) - (showBottomHint ? 1 : 0));
    const half = Math.floor(itemSlots / 2);
    start = Math.min(Math.max(0, selected - half), Math.max(0, items.length - itemSlots));
    const end = start + itemSlots;
    const nextTopHint = start > 0;
    const nextBottomHint = end < items.length;

    if (nextTopHint === showTopHint && nextBottomHint === showBottomHint) {
      break;
    }

    showTopHint = nextTopHint;
    showBottomHint = nextBottomHint;
  }

  const end = Math.min(items.length, start + itemSlots);
  const rows: SelectedWindowRow<T>[] = [];

  if (showTopHint) {
    rows.push({kind: 'more', direction: 'up', count: start});
  }

  rows.push(...items.slice(start, end).map((item, offset) => ({kind: 'item' as const, item, index: start + offset})));

  if (showBottomHint) {
    rows.push({kind: 'more', direction: 'down', count: items.length - end});
  }

  return rows;
}

/**
 * 从尾部裁剪 layout，并同步收敛 cursor row；用于最终兜底和非交互 card surface。
 */
export function constrainLayoutTail(layout: FooterLayout, maxLines: number | undefined): FooterLayout {
  if (!Number.isFinite(maxLines) || layout.lines.length <= Number(maxLines)) {
    return layout;
  }

  const normalizedMaxLines = normalizeLineLimit(maxLines, 1);
  const start = Math.max(0, layout.lines.length - normalizedMaxLines);

  return {
    ...layout,
    lines: layout.lines.slice(start),
    cursorRow: clampCursorRow(layout.cursorRow - start, normalizedMaxLines)
  };
}

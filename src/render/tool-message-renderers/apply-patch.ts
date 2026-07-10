import * as ansi from '../../terminal/ansi';
import {type TuiTheme} from '../../config/theme-config';
import {createApplyPatchCallLabel} from '../../tools/apply-patch-tool-handler';
import {blockText} from '../colors';
import {displayWidth, safeRenderWidth} from '../layout';
import {renderPrefixedLines, resolveToolCallPrefixStyle, wrapContentLine} from './shared';

import type {ApplyPatchDisplayFile, ApplyPatchDisplayLine, ToolResultDisplayMetadata} from '../../types/tool';
import type {TranscriptRecord} from '../../types/transcript';

const APPLY_PATCH_TOOL_NAME = 'apply_patch';
const APPLY_PATCH_RESULT_MAX_DISPLAY_LINES = 120;
const APPLY_PATCH_TRUNCATION_TEXT = '[patch display truncated]';

type ApplyPatchRenderRow = {
  kind: 'header' | 'neutral' | 'context' | 'removed' | 'added' | 'omitted';
  text: string;
  locator?: string;
  omittedCount?: number;
};

type ApplyPatchRenderHunk = {
  changedRows: ApplyPatchRenderRow[];
};

type ApplyPatchRenderFile = {
  header: ApplyPatchRenderRow;
  rows: ApplyPatchRenderRow[];
};

/**
 * apply_patch 调用行只做轻量路径摘要，不展示完整 JSON patch。
 */
function renderApplyPatchToolCallLines(
  record: TranscriptRecord,
  width: number,
  callStatus: boolean | undefined,
  theme: TuiTheme
): string[] {
  return renderPrefixedLines({
    text: createApplyPatchCallLabel(record.argumentsText),
    width,
    firstPrefix: '◆ ',
    continuationPrefix: '  ',
      colorizeFirstSymbol: resolveToolCallPrefixStyle(callStatus, theme)
  });
}

/**
 * apply_patch result 按文件和修改区块投影当前 metadata schema。
 */
function renderApplyPatchToolResultLines(
  result: TranscriptRecord,
  display: ToolResultDisplayMetadata,
  width: number,
  theme: TuiTheme
): string[] {
  const failureRows = result.ok === false ? createApplyPatchFailureRows(result.text) : [];
  const files = display.files.map(createApplyPatchRenderFile);
  const rows = applyPatchDisplayBudget(failureRows, files, APPLY_PATCH_RESULT_MAX_DISPLAY_LINES);
  const gutterWidth = resolveApplyPatchGutterWidth(display.files);

    return renderApplyPatchRows(rows, width, gutterWidth, theme);
}

/**
 * 校验 apply-patch metadata 的完整事实行结构。
 */
function isApplyPatchDisplayMetadata(value: unknown): value is ToolResultDisplayMetadata {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const display = value as Partial<ToolResultDisplayMetadata>;

  return (
    display.kind === APPLY_PATCH_TOOL_NAME &&
    Array.isArray(display.files) &&
    display.files.every(isApplyPatchDisplayFile)
  );
}

function isApplyPatchDisplayFile(value: unknown): value is ApplyPatchDisplayFile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const file = value as Partial<ApplyPatchDisplayFile>;

  return (
    typeof file.path === 'string' &&
    (file.kind === 'added' || file.kind === 'updated') &&
    Array.isArray(file.lines) &&
    file.lines.every(isApplyPatchDisplayLine)
  );
}

function isApplyPatchDisplayLine(value: unknown): value is ApplyPatchDisplayLine {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const line = value as Partial<ApplyPatchDisplayLine>;

  return (
    (line.kind === 'context' || line.kind === 'removed' || line.kind === 'added') &&
    typeof line.text === 'string' &&
    (line.postLine === null || (Number.isInteger(line.postLine) && Number(line.postLine) > 0))
  );
}

function createApplyPatchFailureRows(text: unknown): ApplyPatchRenderRow[] {
  const lines = typeof text === 'string' && text.trim() !== ''
    ? text.split('\n').filter((line) => line.trim() !== '')
    : ['Patch failed.'];

  return [
    ...lines.map((line) => ({kind: 'neutral' as const, text: line})),
    {kind: 'neutral', text: ''}
  ];
}

function createApplyPatchRenderFile(file: ApplyPatchDisplayFile): ApplyPatchRenderFile {
  const added = file.lines.filter((line) => line.kind === 'added').length;
  const removed = file.lines.filter((line) => line.kind === 'removed').length;
  const sourceRows = file.lines.map((line) => ({
    kind: line.kind,
    text: line.text,
    locator: line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : line.postLine === null ? '' : String(line.postLine)
  }));

  return {
    header: {kind: 'header', text: `${file.path}  +${added} -${removed}`},
    rows: mergeAdjacentApplyPatchOmittedRows(foldApplyPatchContextRows(sourceRows))
  };
}

function createApplyPatchChangeGroups(rows: ApplyPatchRenderRow[]): ApplyPatchRenderHunk[] {
  const groups: ApplyPatchRenderHunk[] = [];
  let changedRows: ApplyPatchRenderRow[] = [];

  for (const row of rows) {
    if (row.kind === 'added' || row.kind === 'removed') {
      changedRows.push(row);
      continue;
    }

    if (changedRows.length > 0) {
      groups.push({changedRows});
      changedRows = [];
    }
  }

  if (changedRows.length > 0) {
    groups.push({changedRows});
  }

  return groups;
}

/**
 * 每段连续 context 最多保留修改边界附近三行，中间使用带数量的 marker。
 */
function foldApplyPatchContextRows(rows: ApplyPatchRenderRow[]): ApplyPatchRenderRow[] {
  const folded: ApplyPatchRenderRow[] = [];
  let index = 0;

  while (index < rows.length) {
    if (rows[index].kind !== 'context') {
      folded.push(rows[index]);
      index += 1;
      continue;
    }

    let end = index + 1;

    while (end < rows.length && rows[end].kind === 'context') {
      end += 1;
    }

    const run = rows.slice(index, end);
    const hasBeforeChange = index > 0;
    const hasAfterChange = end < rows.length;
    const leadingKeep = hasBeforeChange ? Math.min(3, run.length) : 0;
    const trailingKeep = hasAfterChange ? Math.min(3, run.length - leadingKeep) : 0;
    const hidden = run.length - leadingKeep - trailingKeep;

    if (!hasBeforeChange) {
      if (hidden > 0) {
        folded.push(createApplyPatchOmittedRow(hidden));
      }
      folded.push(...run.slice(run.length - trailingKeep));
    } else {
      folded.push(...run.slice(0, leadingKeep));

      if (hidden > 0) {
        folded.push(createApplyPatchOmittedRow(hidden));
      }

      folded.push(...run.slice(run.length - trailingKeep));
    }

    index = end;
  }

  return folded;
}

function createApplyPatchOmittedRow(count: number): ApplyPatchRenderRow {
  return {
    kind: 'omitted',
    locator: '…',
    omittedCount: count,
    text: `… ${count} unchanged ${count === 1 ? 'line' : 'lines'} …`
  };
}

function mergeAdjacentApplyPatchOmittedRows(rows: ApplyPatchRenderRow[]): ApplyPatchRenderRow[] {
  const merged: ApplyPatchRenderRow[] = [];

  for (const row of rows) {
    const previous = merged[merged.length - 1];

    if (row.omittedCount && previous?.omittedCount) {
      merged[merged.length - 1] = createApplyPatchOmittedRow(previous.omittedCount + row.omittedCount);
      continue;
    }

    merged.push(row);
  }

  return merged;
}

/**
 * 正常情况保留完整折叠投影；超预算时按修改区块公平分配，最低结构超过预算时允许溢出。
 */
function applyPatchDisplayBudget(
  failureRows: ApplyPatchRenderRow[],
  files: ApplyPatchRenderFile[],
  maxLines: number
): ApplyPatchRenderRow[] {
  const fullRows = [
    ...failureRows,
    ...files.flatMap((file) => [file.header, ...file.rows])
  ];

  if (fullRows.length <= maxLines) {
    return fullRows;
  }

  const groupedFiles = files.map((file) => ({
    file,
    changeGroups: createApplyPatchChangeGroups(file.rows)
  }));
  const hunkCount = groupedFiles.reduce((count, entry) => count + entry.changeGroups.length, 0);
  const available = Math.max(hunkCount, maxLines - failureRows.length - files.length);
  const quota = Math.max(1, Math.floor(available / Math.max(1, hunkCount)));
  const rows = [...failureRows];

  for (const {file, changeGroups} of groupedFiles) {
    rows.push(file.header);

    for (const group of changeGroups) {
      rows.push(...truncateApplyPatchChangedRows(group.changedRows, quota));
    }
  }

  return rows;
}

function truncateApplyPatchChangedRows(rows: ApplyPatchRenderRow[], quota: number): ApplyPatchRenderRow[] {
  if (rows.length <= quota) {
    return rows;
  }

  if (quota <= 1) {
    return rows.slice(0, 1);
  }

  const visible = quota - 1;
  const headCount = Math.ceil(visible / 2);
  const tailCount = Math.floor(visible / 2);
  const hidden = rows.length - headCount - tailCount;

  return [
    ...rows.slice(0, headCount),
    {kind: 'omitted', locator: '…', text: `${APPLY_PATCH_TRUNCATION_TEXT} ${hidden} changed ${hidden === 1 ? 'line' : 'lines'}`},
    ...(tailCount > 0 ? rows.slice(rows.length - tailCount) : [])
  ];
}

function resolveApplyPatchGutterWidth(files: ApplyPatchDisplayFile[]): number {
  const maxLine = files.reduce((fileMax, file) => Math.max(
    fileMax,
    ...file.lines.map((line) => line.postLine ?? 0)
  ), 0);

  return Math.max(1, String(maxLine).length);
}

/**
 * gutter 属于 diff 内容区；增删行从 gutter 起补齐背景到终端安全右边界。
 */
function renderApplyPatchRows(rows: ApplyPatchRenderRow[], width: number, gutterWidth: number, theme: TuiTheme): string[] {
  const safeWidth = safeRenderWidth(width);
  const rendered: string[] = [];
  let first = true;

  for (const row of rows) {
    const prefix = first ? '  ⎿ ' : '    ';
    const availableWidth = Math.max(1, safeWidth - displayWidth(prefix));

    if (row.kind === 'header' || row.kind === 'neutral') {
      const wrapped = wrapContentLine(row.text, safeWidth, displayWidth(prefix));

      for (const content of wrapped) {
        const linePrefix = first ? '  ⎿ ' : '    ';
          rendered.push(`${linePrefix}${blockText(theme, 'toolOutput', content)}`);
        first = false;
      }

      continue;
    }

    const locator = (row.locator ?? '').padStart(gutterWidth);
    const gutter = `${locator} │ `;
    const textWidth = Math.max(1, availableWidth - displayWidth(gutter));
    const wrapped = wrapContentLine(row.text, textWidth, 0);

    for (let index = 0; index < wrapped.length; index += 1) {
      const linePrefix = first ? '  ⎿ ' : '    ';
      const physicalGutter = index === 0 ? gutter : `${' '.repeat(gutterWidth)} │ `;
      const content = `${physicalGutter}${wrapped[index]}`;
      const padded = `${content}${' '.repeat(Math.max(0, availableWidth - displayWidth(content)))}`;
      const styled = row.kind === 'added'
        ? ansi.bgGreen(padded)
        : row.kind === 'removed'
          ? ansi.bgRed(padded)
            : blockText(theme, row.kind === 'omitted' ? 'muted' : 'toolOutput', content);
      rendered.push(`${linePrefix}${styled}`);
      first = false;
    }
  }

  return rendered.length > 0 ? rendered : ['  ⎿ '];
}

export {
  APPLY_PATCH_TOOL_NAME,
  isApplyPatchDisplayMetadata,
  renderApplyPatchToolCallLines,
  renderApplyPatchToolResultLines
};

import * as ansi from '../../terminal/ansi';
import { displayWidth, safeRenderWidth, stripAnsi } from '../layout';
import { activeBackground, renderFocusBar, resolveFooterTheme, tokenText, type FooterTheme } from '../colors';
import { clampPlainText, padVisibleText } from './text';
import { createSelectedWindowRows } from './window';
import type { ResumeCommandSurface, ResumeCommandSurfacePreviewRecord, ResumeCommandSurfaceSession } from '../../types/command';
import type { FooterLayout } from '../../types/render';

type PreviewRowsOptions = {
  height: number;
  scroll?: number;
  width: number;
};

type SessionListRow =
  | {
      kind: 'session'; // 标识该行承载一个可选择的会话。
      session: ResumeCommandSurfaceSession; // 左栏需要展示的会话标签。
      selected: boolean; // 指示该会话是否为当前选中项。
    }
  | {
      kind: 'more'; // 标识该行承载窗口之外的数量提示。
      count: number; // 当前方向尚未显示的会话数量。
      direction: 'up' | 'down'; // 隐藏会话相对当前窗口的方向。
    };

const RESUME_BODY_HEIGHT = 8; // 未提供 maxLines 行数预算时保持的默认主体高度。
const RESUME_FIXED_ROW_COUNT = 6; // 顶边、标题、表头、分割线、键位提示、底边的固定外壳行数。
const WIDE_BOX_HORIZONTAL_MARGIN = 4;

/**
 * 渲染 /resume 历史恢复面板；左侧是渲染层投影的候选窗口，右侧是当前选中项的多行预览。
 */
export function renderResumeSurface(commandSurface: ResumeCommandSurface, width: number, maxLines: number | undefined = Number.POSITIVE_INFINITY, theme: FooterTheme = resolveFooterTheme(undefined)): FooterLayout {
  const safeWidth = safeRenderWidth(width);
  const boxWidth = calculateBoxWidth(safeWidth);
  const splitWidth = Math.max(2, boxWidth - 7);
  const leftWidth = calculateLeftWidth(splitWidth);
  const rightWidth = Math.max(1, splitWidth - leftWidth);
  const sessions = commandSurface.sessions;
  const selectedIndex = clampIndex(commandSurface.selectedIndex, sessions.length);
  const bodyHeight = calculateBodyHeight(maxLines);
  const sessionRows = createSessionListRows(commandSurface, selectedIndex, bodyHeight);
  const previewStatus = commandSurface.previewStatus || 'ready';
  const previewHint = previewStatus === 'loading'
    ? '正在加载会话预览…'
    : previewStatus === 'error'
      ? commandSurface.previewError || '无法读取会话预览'
      : commandSurface.emptyPreviewHint;
  const previewRows = createPreviewRows(
    previewStatus === 'ready' ? commandSurface.previewRecords : [],
    previewHint,
    {width: rightWidth, height: bodyHeight, scroll: commandSurface.previewScroll},
    theme
  );
  const focus = commandSurface.focus === 'preview' ? 'preview' : 'list';
  const lines = [
    renderBoxTop(boxWidth, theme),
    renderFullLine(renderTitle(commandSurface.title, boxWidth - 4, theme), boxWidth, theme),
    renderSplitLine(
      renderPanelHeader('会话', focus === 'list', theme),
      renderPanelHeader('预览', focus === 'preview', theme),
      leftWidth,
      rightWidth,
      theme
    ),
    renderSplitLine(
      renderPanelDivider(leftWidth, theme),
      renderPanelDivider(rightWidth, theme),
      leftWidth,
      rightWidth,
      theme
    )
  ];

  for (let index = 0; index < bodyHeight; index += 1) {
    lines.push(renderSplitLine(
      renderSessionListRow(sessionRows[index], leftWidth, theme),
      previewRows[index] || '',
      leftWidth,
      rightWidth,
      theme
    ));
  }

  lines.push(renderFullLine(ansi.dim(clampPlainText(commandSurface.dismissHint, boxWidth - 4)), boxWidth, theme));
  lines.push(renderBoxBottom(boxWidth, theme));

  return {
    lines,
    cursorRow: lines.length - 1,
    cursorColumn: 0,
    showCursor: false
  };
}

/**
 * 用渲染层窗口投影左栏候选；以选中项为中心，more 提示计入主体高度预算。
 */
function createSessionListRows(commandSurface: ResumeCommandSurface, selectedIndex: number, height: number): SessionListRow[] {
  return createSelectedWindowRows(commandSurface.sessions, selectedIndex, height).map((row) => row.kind === 'more'
    ? {kind: 'more' as const, count: row.count, direction: row.direction}
    : {kind: 'session' as const, session: row.item, selected: row.index === selectedIndex});
}

/**
 * 根据终端安全宽度计算面板宽度，避免写满最后一列。
 */
function calculateBoxWidth(safeWidth: number): number {
  if (safeWidth >= 64) {
    return Math.max(4, safeWidth - WIDE_BOX_HORIZONTAL_MARGIN);
  }

  return Math.max(4, safeWidth);
}

/**
 * 计算左栏宽度；窄终端时给 preview 保留最小可读空间。
 */
function calculateLeftWidth(splitWidth: number): number {
  if (splitWidth < 30) {
    return Math.max(1, Math.floor(splitWidth / 2));
  }

  return Math.min(38, Math.max(22, Math.floor(splitWidth * 0.38)), Math.max(1, splitWidth - 12));
}

/**
 * 计算双栏主体高度：footer 的 maxLines 行数预算扣除固定外壳 6 行；无预算时保持默认 8 行。
 */
function calculateBodyHeight(maxLines: number | undefined): number {
  if (maxLines === undefined || !Number.isFinite(maxLines)) {
    return RESUME_BODY_HEIGHT;
  }

  return Math.max(1, Math.floor(Number(maxLines)) - RESUME_FIXED_ROW_COUNT);
}

/**
 * 修正选中索引，renderer 只投影当前快照，不改变 command data。
 */
function clampIndex(index: number | undefined, itemCount: number): number {
  if (itemCount <= 0) {
    return 0;
  }

  return Math.min(Math.max(Number.isInteger(index) ? Number(index) : 0, 0), itemCount - 1);
}

/**
 * 渲染恢复面板标题。
 */
function renderTitle(title: string, width: number, theme: FooterTheme): string {
  return ansi.bold(tokenText(theme, 'accentStrong', clampPlainText(title, width)));
}

/**
 * 渲染栏标题；当前焦点栏使用统一粗竖条提示方向键作用对象。
 */
function renderPanelHeader(label: string, active: boolean, theme: FooterTheme): string {
  const text = active ? `${renderFocusBar(theme)} ${label}` : `  ${label}`;
  const styled = tokenText(theme, active ? 'accentStrong' : 'accent', active ? ansi.bold(text) : text);

  return styled;
}

/**
 * 渲染栏标题下方的分割线，让 header 和内容区域边界更清晰。
 */
function renderPanelDivider(width: number, theme: FooterTheme): string {
  return tokenText(theme, 'frame', '─'.repeat(Math.max(0, width)));
}

/**
 * 渲染左侧会话或窗口提示行，选中会话使用整行背景突出显示。
 */
function renderSessionListRow(row: SessionListRow | undefined, width: number, theme: FooterTheme): string {
  if (!row) {
    return '';
  }

  if (row.kind === 'more') {
    return ansi.dim(clampPlainText(`${row.direction === 'up' ? '↑' : '↓'} ${row.count} 更多`, width));
  }

  const text = clampPlainText(row.session.label, Math.max(1, width - 2));

  if (row.selected) {
    const contentWidth = Math.max(1, width - 1);
    const body = padVisibleText(` ${tokenText(theme, 'accentStrong', ansi.bold(text))}`, contentWidth);
    return `${renderFocusBar(theme)}${activeBackground(theme, body)}`;
  }

  return ansi.dim(`  ${text}`);
}

/**
 * 把 preview records 投影为单行摘要，再按 scroll 裁剪到右栏窗口内。
 */
function createPreviewRows(records: ResumeCommandSurfacePreviewRecord[], emptyPreviewHint: string, options: PreviewRowsOptions, theme: FooterTheme): string[] {
  const {height, scroll, width} = options;
  const rows = records
    .map((record) => renderPreviewRecord(record, width, theme))
    .filter((line) => displayWidth(line) > 0);

  if (rows.length === 0) {
    return [ansi.dim(clampPlainText(emptyPreviewHint, width))];
  }

  const maxScroll = Math.max(0, rows.length - height);
  const start = Math.min(Math.max(0, Number.isInteger(scroll) ? Number(scroll) : 0), maxScroll);
  const visibleRows = rows.slice(start, start + height);

  if (start > 0) {
    visibleRows[0] = ansi.dim(clampPlainText(`↑ ${start} 更多`, width));
  }

  if (start + height < rows.length) {
    visibleRows[visibleRows.length - 1] = ansi.dim(clampPlainText(`↓ ${rows.length - start - height} 更多`, width));
  }

  return visibleRows;
}

/**
 * 渲染单条消息预览：role 高亮，正文去掉 ANSI 序列后按右栏宽度截断为单行。
 */
function renderPreviewRecord(record: ResumeCommandSurfacePreviewRecord, width: number, theme: FooterTheme): string {
  const role = formatRole(record.role);
  const roleLabel = clampPlainText(role, Math.max(1, width - 2));
  const prefix = `${roleLabel} `;
  const text = clampPlainText(stripAnsi(record.text || ''), Math.max(1, width - displayWidth(prefix)));

  if (!text) {
    return '';
  }

  return `${styleRole(role, prefix, theme)}${text}`;
}

/**
 * 将 transcript role 压成预览里可读的短标签。
 */
function formatRole(role: string): string {
  const normalized = String(role || 'message').toLowerCase();

  if (normalized === 'tool_call') {
    return 'TOOL';
  }

  if (normalized === 'tool_result') {
    return 'RESULT';
  }

  if (normalized === 'local_notice') {
    return 'NOTICE';
  }

  return normalized.slice(0, 9).toUpperCase();
}

/**
 * 根据 role 选择预览前缀色，保持 cyan 主视觉。
 */
function styleRole(role: string, text: string, theme: FooterTheme): string {
  if (role === 'USER') {
    return tokenText(theme, 'accent', ansi.bold(text));
  }

  if (role === 'ASSISTANT') {
    return tokenText(theme, 'success', ansi.bold(text));
  }

  if (role === 'ERROR') {
    return tokenText(theme, 'danger', ansi.bold(text));
  }

  return tokenText(theme, 'accentStrong', ansi.bold(text));
}

/**
 * 渲染面板顶部边框。
 */
function renderBoxTop(width: number, theme: FooterTheme): string {
  return tokenText(theme, 'frame', `╭${'─'.repeat(Math.max(0, width - 2))}╮`);
}

/**
 * 渲染面板底部边框。
 */
function renderBoxBottom(width: number, theme: FooterTheme): string {
  return tokenText(theme, 'frame', `╰${'─'.repeat(Math.max(0, width - 2))}╯`);
}

/**
 * 渲染占满整行的内容行。
 */
function renderFullLine(content: string, width: number, theme: FooterTheme): string {
  const bar = tokenText(theme, 'frame', '│');
  return `${bar} ${padVisibleText(content, Math.max(1, width - 4))} ${bar}`;
}

/**
 * 渲染左右两栏内容行。
 */
function renderSplitLine(left: string, right: string, leftWidth: number, rightWidth: number, theme: FooterTheme): string {
  const bar = tokenText(theme, 'frame', '│');
  return `${bar} ${padVisibleText(left, leftWidth)} ${bar} ${padVisibleText(right, rightWidth)} ${bar}`;
}

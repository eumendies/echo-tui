import * as ansi from '../../terminal/ansi';
import {displayWidth, safeRenderWidth} from '../layout';
import {activeBackground, renderFocusBar, resolveFooterTheme, tokenText, type FooterTheme} from '../colors';
import {sectionTitle} from './config-panel-rows';
import {clampPlainText, padVisibleText} from './text';
import {clampIndex, createSelectedWindowRows, normalizeLineLimit} from './window';

import type {AgentsCommandRow, AgentsCommandSection, AgentsCommandSummary, AgentsCommandSurface} from '../../types/command';
import type {FooterLayout} from '../../types/render';

const AGENTS_SURFACE_HORIZONTAL_MARGIN = 4;
const AGENTS_DEFAULT_BODY_ROWS = 9;
// 96 列终端扣除安全渲染宽度与卡片边距后正文为 87 列，低于该宽度改用上下堆叠布局。
const AGENTS_WIDE_CONTENT_MIN_WIDTH = 87;
const CONTENT_COLUMN_OFFSET = 2;
const LEFT_COLUMN_MAX_RATIO = 0.45;
const SPLIT_COLUMN_GAP = 2;

const SECTION_LABELS: Record<AgentsCommandSection, string> = {
  identity: '身份',
  policy: '运行策略',
  capability: '能力与权限',
  actions: '操作'
};

type AgentsBodyLayout = {
  cursorColumn: number; // 真实终端光标相对整行左侧的可见列。
  cursorRow: number; // 光标在 body rows 内的相对行。
  rows: string[]; // 已包含卡片左右边框的主体行。
  showCursor: boolean; // 文本编辑态才显示真实终端光标。
};

type EditorProjection = {
  cursorColumn: number; // 投影文本内的可见光标列。
  text: string; // 围绕光标裁剪后的单行文本。
};

type StatusProjection = {
  label: string; // 不依赖颜色即可识别的短状态文本。
  marker: string; // 状态的冗余视觉符号。
  token: 'success' | 'warning' | 'danger' | 'muted'; // 状态对应的主题语气。
};

type SummaryEntry =
  | {kind: 'header'; metadata: string; title: string} // 摘要首行：标题与状态、来源元数据。
  | {kind: 'text'; text: string; token: 'dim' | 'warning'}; // 摘要正文行；样式在纯文本裁剪之后应用。

/**
 * 渲染 `/agents` 管理卡片；所有业务状态来自 command session，renderer 只负责窗口、样式和真实光标投影。
 */
export function renderAgentsSurface(
  surface: AgentsCommandSurface,
  width: number,
  maxLines?: number,
  theme: FooterTheme = resolveFooterTheme(undefined)
): FooterLayout {
  const boxWidth = calculateBoxWidth(width);
  const contentWidth = Math.max(1, boxWidth - 4);
  const lineLimit = normalizeLineLimit(maxLines, 1);
  // 预算过小时优先保留正文：不渲染边框、标签页与提示，避免 chrome 挤掉全部内容。
  const showChrome = !Number.isFinite(lineLimit) || lineLimit >= 5;
  const showTabs = showChrome && surface.mode === 'list';
  const messageCount = showChrome ? Number(Boolean(surface.error)) + Number(Boolean(surface.feedback)) : 0;
  // 确认页必须同时显示取消与待确认动作；预算不足时让出 dismiss hint 行，而不是隐藏任一选项。
  const dropHint = showChrome && surface.mode === 'confirm' && Number.isFinite(lineLimit) && lineLimit < messageCount + 5;
  const fixedRows = showChrome ? 3 + Number(showTabs) + messageCount - Number(dropHint) : 0;
  // 不渲染 chrome 的极低预算下只保证选中行可见；有边框时确认页至少保留两个选项。
  const minimumBodyRows = surface.mode === 'confirm' && showChrome ? 2 : 1;
  const bodyBudget = Number.isFinite(lineLimit)
    ? Math.max(minimumBodyRows, lineLimit - fixedRows)
    : AGENTS_DEFAULT_BODY_ROWS;
  const body = renderBody(surface, contentWidth, bodyBudget, theme);
  const lines = [
    ...(showChrome ? [renderTop(boxWidth, normalizeSingleLineText(surface.title), theme, surface.mode === 'list' ? formatStats(surface) : '')] : []),
    ...(showTabs ? [renderTabs(surface, contentWidth, theme)] : []),
    ...body.rows,
    ...(showChrome && surface.error ? [renderMessage(normalizeSingleLineText(surface.error), 'danger', contentWidth, theme)] : []),
    ...(showChrome && surface.feedback ? [renderMessage(normalizeSingleLineText(surface.feedback), 'success', contentWidth, theme)] : []),
    ...(showChrome && !dropHint ? [renderLine(ansi.dim(clampPlainText(normalizeSingleLineText(surface.dismissHint), contentWidth)), contentWidth, theme)] : []),
    ...(showChrome ? [renderBottom(boxWidth, theme)] : [])
  ];

  if (!body.showCursor) {
    return {lines, cursorRow: lines.length - 1, cursorColumn: 0, showCursor: false};
  }

  return {
    lines,
    cursorColumn: body.cursorColumn,
    cursorRow: Number(showChrome) + Number(showTabs) + body.cursorRow,
    showCursor: true
  };
}

/** 宽终端沿用 File Picker 的四列外边距，避免管理表单被不必要地压缩。 */
function calculateBoxWidth(width: number): number {
  const safeWidth = Math.max(1, safeRenderWidth(width));
  if (safeWidth >= 64) {
    return Math.max(4, safeWidth - AGENTS_SURFACE_HORIZONTAL_MARGIN);
  }
  return Math.max(4, safeWidth);
}

function renderBody(surface: AgentsCommandSurface, contentWidth: number, bodyBudget: number, theme: FooterTheme): AgentsBodyLayout {
  const editText = surface.editText === undefined ? undefined : normalizeEditorText(surface.editText);
  if (surface.mode === 'instructions' && surface.editText !== undefined) {
    return renderInstructionsEditor(surface, editText || '', contentWidth, bodyBudget, theme);
  }

  if (surface.rows.length === 0) {
    return withoutCursor([renderLine(ansi.dim('当前范围没有 Agent。'), contentWidth, theme)]);
  }

  if (surface.mode === 'list') {
    return renderListBody(surface, contentWidth, bodyBudget, theme);
  }

  return renderRowsBody(surface, editText, contentWidth, bodyBudget, theme);
}

/** 列表模式根据正文宽度选择左右主从或上下堆叠布局，两者消费同一份 rows 与 summary。 */
function renderListBody(surface: AgentsCommandSurface, contentWidth: number, bodyBudget: number, theme: FooterTheme): AgentsBodyLayout {
  return contentWidth >= AGENTS_WIDE_CONTENT_MIN_WIDTH
    ? renderWideListBody(surface, contentWidth, bodyBudget, theme)
    : renderStackedListBody(surface, contentWidth, bodyBudget, theme);
}

/** 宽屏把列表窗口与摘要按同一高度合并，避免摘要额外消耗 footer 行数。 */
function renderWideListBody(surface: AgentsCommandSurface, contentWidth: number, bodyBudget: number, theme: FooterTheme): AgentsBodyLayout {
  const selectedIndex = clampIndex(surface.selectedIndex, surface.rows.length);
  const divider = ansi.dim(' │ ');
  const dividerWidth = displayWidth(divider);
  const leftWidth = Math.min(42, Math.max(28, Math.floor((contentWidth - dividerWidth) * 0.38)));
  const rightWidth = Math.max(1, contentWidth - leftWidth - dividerWidth);
  const listRows = renderListWindowCells(surface.rows, selectedIndex, bodyBudget, leftWidth, theme);
  const summaryRows = surface.summary ? renderSummaryCells(surface.summary, rightWidth, bodyBudget, theme) : [];
  const rowCount = Math.min(Math.max(listRows.length, summaryRows.length), bodyBudget);
  const rows: string[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    rows.push(renderLine(
      `${padVisibleText(listRows[index] || '', leftWidth)}${divider}${padVisibleText(summaryRows[index] || '', rightWidth)}`,
      contentWidth,
      theme
    ));
  }
  return withoutCursor(rows);
}

/** 窄屏先保留选中列表行，再把核心摘要放在固定分隔线下。 */
function renderStackedListBody(surface: AgentsCommandSurface, contentWidth: number, bodyBudget: number, theme: FooterTheme): AgentsBodyLayout {
  const selectedIndex = clampIndex(surface.selectedIndex, surface.rows.length);
  const summary = surface.summary;
  if (bodyBudget <= 1 || !summary) {
    return withoutCursor(renderListWindowCells(surface.rows, selectedIndex, bodyBudget, contentWidth, theme)
      .map((row) => renderLine(row, contentWidth, theme)));
  }

  // 三段预算合计恒等于 bodyBudget：摘要最多 4 行，列表保留选中行，其余留给分隔标题。
  const dividerRows = bodyBudget >= 3 ? 1 : 0;
  const summaryBudget = Math.min(4, Math.max(1, Math.floor((bodyBudget - dividerRows) / 2)));
  const listBudget = bodyBudget - dividerRows - summaryBudget;
  const divider = dividerRows > 0 ? [renderSectionTitle('当前项', contentWidth, theme)] : [];
  const summaryRows = renderSummaryCells(summary, contentWidth, summaryBudget, theme)
    .map((row) => renderLine(row, contentWidth, theme));
  const listRows = renderListWindowCells(surface.rows, selectedIndex, listBudget, contentWidth, theme)
    .map((row) => renderLine(row, contentWidth, theme));
  return withoutCursor([...listRows, ...divider, ...summaryRows]);
}

/** 详情和表单先按焦点选择窗口，再插入不参与 selectedIndex 的分区标题；超出预算时收缩条目窗口重试。 */
function renderRowsBody(surface: AgentsCommandSurface, editText: string | undefined, contentWidth: number, bodyBudget: number, theme: FooterTheme): AgentsBodyLayout {
  const selectedIndex = clampIndex(surface.selectedIndex, surface.rows.length);
  for (let itemBudget = bodyBudget; itemBudget >= 1; itemBudget -= 1) {
    const projected = projectRowsWindow(surface, selectedIndex, itemBudget, editText, contentWidth, theme, true);
    if (projected.rows.length <= bodyBudget) return projected;
  }
  return projectRowsWindow(surface, selectedIndex, bodyBudget, editText, contentWidth, theme, false);
}

function projectRowsWindow(
  surface: AgentsCommandSurface,
  selectedIndex: number,
  itemBudget: number,
  editText: string | undefined,
  contentWidth: number,
  theme: FooterTheme,
  showSections: boolean
): AgentsBodyLayout {

  const rows: string[] = [];
  let cursorRow = 0;
  let cursorColumn = 0;
  let showCursor = false;
  let previousSection: AgentsCommandSection | undefined;
  const visibleRows = createSelectedWindowRows(surface.rows, selectedIndex, itemBudget);

  for (const windowRow of visibleRows) {
    if (windowRow.kind === 'more') {
      rows.push(renderLine(ansi.dim(`  ${windowRow.direction === 'up' ? '↑' : '↓'} ${windowRow.count} 更多`), contentWidth, theme));
      continue;
    }

    const active = windowRow.index === selectedIndex;
    const row = normalizeRow(windowRow.item);
    if (showSections && row.section && row.section !== previousSection) {
      rows.push(renderSectionTitle(SECTION_LABELS[row.section], contentWidth, theme));
    }
    previousSection = row.section;
    if (active && editText !== undefined && surface.editField && row.id === surface.editField) {
      const editing = renderEditingField(row, editText, surface.editCursor || 0, contentWidth, theme);
      cursorRow = rows.length;
      cursorColumn = editing.cursorColumn;
      showCursor = true;
      rows.push(editing.row);
      continue;
    }
    rows.push(renderRow(row, active, contentWidth, theme));
  }

  return {rows, cursorColumn, cursorRow, showCursor};
}

function renderTabs(surface: AgentsCommandSurface, contentWidth: number, theme: FooterTheme): string {
  const labels = surface.tabs.map((tab) => {
    const label = normalizeSingleLineText(tab.label);
    const text = tab.id === surface.activeTab ? `[${label}]` : label;
    return tab.id === surface.activeTab
      ? tokenText(theme, 'accentStrong', ansi.bold(text))
      : tokenText(theme, 'muted', text);
  });
  return renderLine(clampStyledParts(labels, '  ', contentWidth), contentWidth, theme);
}

/** 把当前范围统计压缩到顶栏右侧；空范围仍明确显示 0 Agent。 */
function formatStats(surface: AgentsCommandSurface): string {
  const stats = surface.stats;
  if (!stats) return '';
  return `${stats.agentCount} Agent${stats.issueCount > 0 ? ` · ${stats.issueCount} 异常` : ''}`;
}

/** 创建包含焦点的紧凑列表窗口；返回未加外框的固定宽度单元格。 */
function renderListWindowCells(rows: AgentsCommandRow[], selectedIndex: number, budget: number, width: number, theme: FooterTheme): string[] {
  return createSelectedWindowRows(rows, selectedIndex, budget).map((entry) => {
    if (entry.kind === 'more') {
      // 提示文案先在纯文本上裁剪再着色，保证极窄单元格内也不会超出声明宽度。
      const hint = clampCellText(`  ${entry.direction === 'up' ? '↑' : '↓'} ${entry.count} 更多`, width);
      return padVisibleText(ansi.dim(hint), width);
    }
    return renderListCell(normalizeRow(entry.item), entry.index === selectedIndex, width, theme);
  });
}

/** 列表行仅承载身份、状态、来源和 capability，完整运行策略由选中项摘要展示。 */
function renderListCell(row: AgentsCommandRow, active: boolean, width: number, theme: FooterTheme): string {
  if (row.kind === 'agent') {
    const status = resolveStatus(row.status);
    const source = formatSource(row.sourceKind);
    const capability = formatCapability(row.capability);
    const detail = `${status.marker} ${status.label} · ${source}${capability ? ` · ${capability}` : ''}`;
    return renderSelectableCell(row.label, detail, active, width, theme, status.token);
  }
  if (row.kind === 'action') {
    return renderSelectableCell(row.label, row.description || '按 Enter 执行', active, width, theme, row.tone === 'danger' ? 'danger' : 'accent');
  }
  const status = resolveStatus(row.status || 'diagnostic');
  return renderSelectableCell(row.label, `${status.marker} ${status.label}`, active, width, theme, status.token);
}

/** 摘要按重要性生成有限行；内容先在纯文本上裁剪，再应用 dim、警告等样式。 */
function renderSummaryCells(summary: AgentsCommandSummary, width: number, budget: number, theme: FooterTheme): string[] {
  const status = summary.status ? resolveStatus(summary.status) : undefined;
  const source = summary.sourceKind ? formatSource(summary.sourceKind) : '';
  const metadata = [status ? `${status.marker} ${status.label}` : '', source].filter(Boolean).join(' · ');
  const entries: SummaryEntry[] = [{kind: 'header', metadata, title: summary.title}];
  for (let index = 0; index < summary.fields.length; index += 3) {
    const fields = summary.fields.slice(index, index + 3);
    entries.push({kind: 'text', text: normalizeSingleLineText(fields.map((field) => `${field.label} ${field.value}`).join(' · ')), token: 'dim'});
  }
  // 描述与字段行同为信息层：补“描述”标签并统一 dim，避免出现无标签的唯一亮色行。
  if (summary.description) entries.push({kind: 'text', text: normalizeSingleLineText(`描述 ${summary.description}`), token: 'dim'});
  for (const diagnostic of summary.diagnostics) {
    entries.push({kind: 'text', text: normalizeSingleLineText(`! ${diagnostic}`), token: 'warning'});
  }
  const visible = entries.slice(0, budget);
  if (entries.length > budget && budget > 1) {
    visible[budget - 1] = {kind: 'text', text: `↓ ${entries.length - budget + 1} 更多；Enter 查看详情`, token: 'dim'};
  }
  return visible.map((entry) => padVisibleText(renderSummaryEntry(entry, width, theme), width));
}

/** 摘要行裁剪在着色之前完成，避免在 ANSI 序列中间截断，也避免超宽时静默丢失样式。 */
function renderSummaryEntry(entry: SummaryEntry, width: number, theme: FooterTheme): string {
  if (entry.kind === 'header') return renderSummaryHeader(entry.title, entry.metadata, width, theme);
  const text = clampCellText(entry.text, width);
  return entry.token === 'warning' ? tokenText(theme, 'warning', text) : ansi.dim(text);
}

function renderSummaryHeader(title: string, metadata: string, width: number, theme: FooterTheme): string {
  const safeTitle = normalizeSingleLineText(title);
  const safeMetadata = normalizeSingleLineText(metadata);
  // 元数据列最多占 48%，且必须给标题留 1 列与 2 列列间隔，避免极窄右栏整行超宽。
  const metadataWidth = Math.min(displayWidth(safeMetadata), Math.max(0, Math.floor(width * 0.48)), Math.max(0, width - 3));
  const titleWidth = Math.max(1, width - metadataWidth - (metadataWidth > 0 ? 2 : 0));
  const left = tokenText(theme, 'accentStrong', ansi.bold(clampCellText(safeTitle, titleWidth)));
  const right = metadataWidth > 0 ? ansi.dim(clampCellText(safeMetadata, metadataWidth)) : '';
  return `${padVisibleText(left, titleWidth)}${metadataWidth > 0 ? '  ' : ''}${right}`;
}

function resolveStatus(status: string | undefined): StatusProjection {
  if (status === 'active') return {label: '生效', marker: '●', token: 'success'};
  if (status === 'shadowed') return {label: '被覆盖', marker: '◐', token: 'warning'};
  if (status === 'invalid') return {label: '无效', marker: '!', token: 'danger'};
  if (status === 'reserved') return {label: '保留', marker: '!', token: 'warning'};
  if (status === 'diagnostic') return {label: '诊断', marker: '!', token: 'warning'};
  if (status === 'stale') return {label: '不可用', marker: '!', token: 'warning'};
  const label = normalizeSingleLineText(status || '未知');
  return {label, marker: '?', token: 'warning'};
}

function formatSource(sourceKind: AgentsCommandRow['sourceKind']): string {
  return sourceKind === 'builtin' ? '内置' : sourceKind === 'project' ? '项目' : sourceKind === 'user' ? '用户' : '未知来源';
}

function formatCapability(capability: AgentsCommandRow['capability']): string {
  return capability === 'readonly' ? '只读' : capability === 'general' ? '通用' : '';
}

/** 分区标题复用配置面板原语，保持管理面板之间一致的视觉层级。 */
function renderSectionTitle(label: string, contentWidth: number, theme: FooterTheme): string {
  return renderLine(sectionTitle(label, contentWidth, theme), contentWidth, theme);
}

function renderRow(row: AgentsCommandRow, active: boolean, contentWidth: number, theme: FooterTheme): string {
  if (row.kind === 'agent') {
    return renderLine(renderListCell(row, active, contentWidth, theme), contentWidth, theme);
  }
  if (row.kind === 'action') {
    const token = row.tone === 'danger' ? 'danger' : row.tone === 'warning' ? 'warning' : 'accent';
    return renderLine(renderSelectableCell(row.label, row.description, active, contentWidth, theme, token), contentWidth, theme);
  }
  if (row.kind === 'confirm') {
    return renderLine(renderSelectableCell(row.label, row.description, active, contentWidth, theme, row.tone === 'danger' ? 'danger' : 'accent'), contentWidth, theme);
  }
  if (row.kind === 'tool') {
    return renderToolRow(row, active, contentWidth, theme);
  }
  return renderFieldRow(row, active, contentWidth, theme);
}

/** 工具多选沿用 Skills surface 的实心/空心圆点，不使用复选框字形。 */
function renderToolRow(row: AgentsCommandRow, active: boolean, contentWidth: number, theme: FooterTheme): string {
  const rowWidth = Math.max(1, contentWidth - (active ? 1 : 0));
  const prefix = active ? ' ' : '  ';
  const detail = row.description || '';
  const naturalLabelWidth = displayWidth(`● ${row.label}`);
  const detailWidth = calculateRightColumnWidth(displayWidth(detail), naturalLabelWidth, rowWidth, displayWidth(prefix));
  const labelWidth = Math.max(0, rowWidth - detailWidth);
  const gapWidth = calculateColumnGap(labelWidth, displayWidth(prefix), detailWidth);
  const contentBudget = Math.max(0, labelWidth - displayWidth(prefix) - gapWidth);
  const marker = contentBudget > 0
    ? tokenText(theme, row.selected ? 'success' : 'off', row.selected ? ansi.bold('●') : '○')
    : '';
  const separator = contentBudget > 1 ? ' ' : '';
  const visibleLabel = clampCellText(row.label, Math.max(0, contentBudget - displayWidth(marker) - displayWidth(separator)));
  const labelToken = row.status === 'invalid' || row.status === 'stale' ? 'warning' : active ? 'accentStrong' : 'accent';
  const label = tokenText(theme, labelToken, active ? ansi.bold(visibleLabel) : visibleLabel);
  const detailText = detailWidth > 0 ? ansi.dim(clampCellText(detail, detailWidth)) : '';
  const body = `${padVisibleText(`${prefix}${marker}${separator}${label}`, labelWidth)}${padLeftVisibleText(detailText, detailWidth)}`;
  return renderLine(renderFocusableCell(body, active, contentWidth, theme), contentWidth, theme);
}

/** 字段值使用动态右列；短值贴右展示，长值只在右列预算内按 grapheme 截断。 */
function renderFieldRow(row: AgentsCommandRow, active: boolean, contentWidth: number, theme: FooterTheme): string {
  const rowWidth = Math.max(1, contentWidth - (active ? 1 : 0));
  const prefix = active ? ' ' : '  ';
  const value = row.description || '';
  const valueWidth = calculateRightColumnWidth(displayWidth(value), displayWidth(row.label), rowWidth, displayWidth(prefix));
  const labelWidth = Math.max(0, rowWidth - valueWidth);
  const gapWidth = calculateColumnGap(labelWidth, displayWidth(prefix), valueWidth);
  const labelText = clampCellText(row.label, Math.max(0, labelWidth - displayWidth(prefix) - gapWidth));
  const labelToken = active ? 'accentStrong' : row.tone === 'danger' ? 'danger' : row.tone === 'warning' ? 'warning' : row.readonly ? 'muted' : 'accent';
  const label = tokenText(theme, labelToken, active ? ansi.bold(labelText) : labelText);
  const valueText = valueWidth > 0 ? ansi.dim(clampCellText(value, valueWidth)) : '';
  const body = `${padVisibleText(`${prefix}${label}`, labelWidth)}${padLeftVisibleText(valueText, valueWidth)}`;
  return renderLine(renderFocusableCell(body, active, contentWidth, theme), contentWidth, theme);
}

/** 编辑态保持右列对齐，并额外为行尾光标保留一列，防止光标落到卡片边框上。 */
function renderEditingField(row: AgentsCommandRow, text: string, cursor: number, contentWidth: number, theme: FooterTheme): {cursorColumn: number; row: string} {
  const rowWidth = Math.max(1, contentWidth - 1);
  const desiredValueWidth = Math.max(1, displayWidth(text.replace(/\n/gu, ' ')) + 1);
  const calculatedValueWidth = calculateRightColumnWidth(desiredValueWidth, displayWidth(row.label), rowWidth, 1);
  const valueWidth = Math.max(1, calculatedValueWidth);
  const labelWidth = Math.max(0, rowWidth - valueWidth);
  const prefix = labelWidth > 0 ? ' ' : '';
  const gapWidth = calculateColumnGap(labelWidth, displayWidth(prefix), valueWidth);
  const projected = projectSingleLineEditor(text, cursor, valueWidth);
  const label = tokenText(theme, 'accentStrong', ansi.bold(clampCellText(row.label, Math.max(0, labelWidth - displayWidth(prefix) - gapWidth))));
  const body = `${padVisibleText(`${prefix}${label}`, labelWidth)}${padVisibleText(projected.text, valueWidth)}`;
  return {
    cursorColumn: CONTENT_COLUMN_OFFSET + 1 + labelWidth + projected.cursorColumn,
    row: renderLine(`${renderFocusBar(theme)}${activeBackground(theme, body)}`, contentWidth, theme)
  };
}

function renderInstructionsEditor(surface: AgentsCommandSurface, text: string, contentWidth: number, bodyBudget: number, theme: FooterTheme): AgentsBodyLayout {
  const clusters = splitEditorText(text);
  const cursor = Math.min(Math.max(0, surface.editCursor || 0), clusters.length);
  const logical = createLogicalLines(clusters, cursor);
  const fullVisibleCount = bodyBudget;
  const provisionalStart = Math.min(Math.max(0, logical.cursorRow - fullVisibleCount + 1), Math.max(0, logical.lines.length - fullVisibleCount));
  const showUpHint = provisionalStart > 0 && fullVisibleCount > 1;
  const visibleCount = Math.max(1, fullVisibleCount - Number(showUpHint));
  const start = Math.min(Math.max(0, logical.cursorRow - visibleCount + 1), Math.max(0, logical.lines.length - visibleCount));
  const visible = logical.lines.slice(start, start + visibleCount);
  const rows = visible.map((line, index) => {
    const absoluteRow = start + index;
    const projected = absoluteRow === logical.cursorRow
      ? projectSingleLineEditor(line, logical.cursorColumn, contentWidth)
      : {text: clampPlainText(line, contentWidth), cursorColumn: 0};
    return renderLine(projected.text, contentWidth, theme);
  });
  const activeLine = logical.lines[logical.cursorRow] || '';
  const activeProjection = projectSingleLineEditor(activeLine, logical.cursorColumn, contentWidth);
  if (showUpHint) rows.unshift(renderLine(ansi.dim(`  ↑ ${start} 行`), contentWidth, theme));
  return {
    cursorColumn: CONTENT_COLUMN_OFFSET + activeProjection.cursorColumn,
    cursorRow: Number(showUpHint) + logical.cursorRow - start,
    rows,
    showCursor: true
  };
}

/** 将外部文本中的终端控制字符替换为空格，业务行保持单行且不允许注入 ANSI/OSC。 */
function normalizeSingleLineText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ');
}

/** 编辑器只保留换行语义，其余终端控制字符按单个空格投影以维持光标索引。 */
function normalizeEditorText(value: string): string {
  return value.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/gu, ' ');
}

function normalizeRow(row: AgentsCommandRow): AgentsCommandRow {
  return {
    ...row,
    ...(row.description === undefined ? {} : {description: normalizeSingleLineText(row.description)}),
    label: normalizeSingleLineText(row.label)
  };
}

/** 返回未加外框的可聚焦单元格，供全宽行与宽屏左栏共享。 */
function renderSelectableCell(
  label: string,
  description: string | undefined,
  active: boolean,
  width: number,
  theme: FooterTheme,
  token: 'accent' | 'danger' | 'warning' | 'success' | 'muted'
): string {
  const rowWidth = Math.max(1, width - (active ? 1 : 0));
  const prefix = active ? ' ' : '  ';
  const detail = description || '';
  const detailWidth = calculateRightColumnWidth(displayWidth(detail), displayWidth(label), rowWidth, displayWidth(prefix));
  const labelWidth = Math.max(0, rowWidth - detailWidth);
  const gapWidth = calculateColumnGap(labelWidth, displayWidth(prefix), detailWidth);
  const visibleLabel = clampCellText(label, Math.max(0, labelWidth - displayWidth(prefix) - gapWidth));
  const labelText = tokenText(theme, active ? 'accentStrong' : token, active ? ansi.bold(visibleLabel) : visibleLabel);
  const detailText = detailWidth > 0 ? ansi.dim(clampCellText(detail, detailWidth)) : '';
  const body = `${padVisibleText(`${prefix}${labelText}`, labelWidth)}${padLeftVisibleText(detailText, detailWidth)}`;
  return renderFocusableCell(body, active, width, theme);
}

/**
 * 计算贴右内容列宽；优先保留完整短标签，长标签最多占可用正文的一定比例，其余空间全部交给右列。
 */
function calculateRightColumnWidth(naturalWidth: number, labelNaturalWidth: number, rowWidth: number, prefixWidth: number): number {
  if (naturalWidth <= 0) return 0;
  const available = Math.max(0, rowWidth - prefixWidth - SPLIT_COLUMN_GAP);
  const labelLimit = Math.max(1, Math.floor(available * LEFT_COLUMN_MAX_RATIO));
  const reservedLabelWidth = Math.min(Math.max(1, labelNaturalWidth), labelLimit);
  return Math.min(naturalWidth, Math.max(0, available - reservedLabelWidth));
}

/** 右列存在时从左列预算中保留固定间隔；极窄布局按实际剩余列收缩。 */
function calculateColumnGap(leftWidth: number, prefixWidth: number, rightWidth: number): number {
  if (rightWidth <= 0) return 0;
  return Math.min(SPLIT_COLUMN_GAP, Math.max(0, leftWidth - prefixWidth));
}

/** 在固定右列内左侧补空格，让宽字符截断后不足一列的内容仍贴齐右边。 */
function padLeftVisibleText(text: string, width: number): string {
  const padding = Math.max(0, width - displayWidth(text));
  return `${' '.repeat(padding)}${text}`;
}

function renderFocusableCell(body: string, active: boolean, width: number, theme: FooterTheme): string {
  if (!active) return padVisibleText(body, width);
  const rowWidth = Math.max(1, width - 1);
  return `${renderFocusBar(theme)}${activeBackground(theme, padVisibleText(body, rowWidth))}`;
}

/** 把单行编辑内容裁剪到光标附近，并保持 grapheme 与终端列宽边界。 */
function projectSingleLineEditor(text: string, cursor: number, width: number): EditorProjection {
  const chars = splitEditorText(text.replace(/\n/gu, ' '));
  const cursorIndex = Math.min(Math.max(0, cursor), chars.length);
  let start = cursorIndex;
  while (start > 0) {
    const candidate = chars.slice(start - 1, cursorIndex).join('');
    const markerWidth = start - 1 > 0 ? 1 : 0;
    if (displayWidth(candidate) + markerWidth > Math.max(0, width - 1)) break;
    start -= 1;
  }
  const leftMarker = start > 0 ? '…' : '';
  const before = chars.slice(start, cursorIndex).join('');
  let end = cursorIndex;
  while (end < chars.length) {
    const candidate = chars.slice(start, end + 1).join('');
    const rightMarkerWidth = end + 1 < chars.length ? 1 : 0;
    if (displayWidth(leftMarker) + displayWidth(candidate) + rightMarkerWidth > width) break;
    end += 1;
  }
  const rightMarker = end < chars.length ? '…' : '';
  return {
    cursorColumn: displayWidth(leftMarker) + displayWidth(before),
    text: `${leftMarker}${chars.slice(start, end).join('')}${rightMarker}`
  };
}

function createLogicalLines(chars: string[], cursor: number): {cursorColumn: number; cursorRow: number; lines: string[]} {
  const lines = [''];
  let row = 0;
  let cursorRow = 0;
  let cursorColumn = 0;
  for (let index = 0; index <= chars.length; index += 1) {
    if (index === cursor) {
      cursorRow = row;
      cursorColumn = splitEditorText(lines[row]).length;
    }
    if (index === chars.length) break;
    if (chars[index] === '\n') {
      row += 1;
      lines[row] = '';
    } else {
      lines[row] += chars[index];
    }
  }
  return {cursorColumn, cursorRow, lines};
}

function splitEditorText(text: string): string[] {
  return Array.from(new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(text), (entry) => entry.segment);
}

function clampStyledParts(parts: string[], separator: string, width: number): string {
  const result: string[] = [];
  let used = 0;
  for (const part of parts) {
    const prefix = result.length > 0 ? separator : '';
    const nextWidth = displayWidth(prefix) + displayWidth(part);
    if (used + nextWidth > width) break;
    result.push(`${prefix}${part}`);
    used += nextWidth;
  }
  return result.join('');
}

/** 在卡片内部单元格按精确列宽裁剪；不同于终端整行裁剪，不额外扣除最后一列。 */
function clampCellText(text: string, width: number): string {
  const safeWidth = Math.max(0, Math.floor(width));
  if (safeWidth === 0) {
    return '';
  }
  if (displayWidth(text) <= safeWidth) {
    return text;
  }
  const chars = splitEditorText(text);
  let result = '';
  for (const char of chars) {
    if (displayWidth(`${result}${char}…`) > safeWidth) {
      break;
    }
    result += char;
  }
  return `${result}…`;
}

function renderMessage(message: string, token: 'danger' | 'success', contentWidth: number, theme: FooterTheme): string {
  return renderLine(tokenText(theme, token, clampPlainText(message, contentWidth)), contentWidth, theme);
}

function renderTop(width: number, title: string, theme: FooterTheme, right = ''): string {
  const suffixText = normalizeSingleLineText(right);
  // 后缀只在标题至少还能保留 1 列时显示：tag 与两侧边框固定占用 5 列，否则整行会超出卡片宽度。
  const suffix = suffixText && displayWidth(` ${suffixText} `) <= width - 5 ? ansi.dim(` ${suffixText} `) : '';
  const titleText = clampPlainText(title, Math.max(1, width - 4 - displayWidth(suffix)));
  const tag = tokenText(theme, 'accentStrong', ansi.bold(` ${titleText} `));
  const rail = tokenText(theme, 'accentDeep', '─'.repeat(Math.max(0, width - 2 - displayWidth(tag) - displayWidth(suffix))));
  return `${tokenText(theme, 'accentDeep', '╭')}${tag}${rail}${suffix}${tokenText(theme, 'accentDeep', '╮')}`;
}

function renderBottom(width: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '╰')}${tokenText(theme, 'accentDeep', '─'.repeat(Math.max(0, width - 2)))}${tokenText(theme, 'accentDeep', '╯')}`;
}

function renderLine(content: string, contentWidth: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '│')} ${padVisibleText(content, contentWidth)} ${tokenText(theme, 'accentDeep', '│')}`;
}

function withoutCursor(rows: string[]): AgentsBodyLayout {
  return {cursorColumn: 0, cursorRow: Math.max(0, rows.length - 1), rows, showCursor: false};
}

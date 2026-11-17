import * as ansi from '../../terminal/ansi';
import {renderComposer, wrapTextToWidth} from '../layout';
import {resolveFooterTheme, type FooterTheme, type TuiTheme} from '../colors';
import {clampPlainText} from './text';
import {actionRow, bottom, boxWidth, contentWidth, dimHint, errorLine, feedbackLine, kvRow, line, moreRow, renderTabsLine, sectionLine, splitRow, top} from './config-panel-rows';
import {createSelectedWindowRows, normalizeLineLimit} from './window';

import type {SystemPromptFileFact, SystemPromptSourceKind} from '../../types/agent';
import type {ConfigSurfaceTab, ConfigTabId, SystemPromptConfigState, SystemPromptDynamicSection, SystemPromptMenuRow} from '../../types/command';
import type {FooterLayout} from '../../types/render';

const READ_CHROME_LINES = 5; // 阅读态的外框、Tab strip、空行、提示与底边总行数。
const EDIT_BODY_OFFSET = 2; // 编辑区正文相对外框内沿的缩进列数。
const MIN_COMPACT_MENU_LINES = 3; // 低于该高度时连状态行都放不下，只保留焦点按钮。

type SystemPromptReadRow = {
  lineNumber: number | null; // 逻辑行号；折行续行省略行号。
  text: string; // 已按正文宽度折行的物理行文本。
};

type SystemPromptReadProjection = {
  gutter: number; // 行号列宽，按逻辑行总数自适应。
  maxScroll: number; // 可滚动到的最大物理起始行。
  rows: SystemPromptReadRow[]; // 完整物理行列表，含折行续行。
  start: number; // 已夹取的物理起始行。
  viewport: number; // 可见物理行数。
};

type RenderSystemPromptOptions = {
  maxLines?: number; // footer 可用行预算，不含终端安全留白。
  theme?: TuiTheme; // 当前主题；渲染期间不读盘。
};

/**
 * 来源标签是面板与常规摘要共用的唯一映射；unknown 表示快照整体读取失败。
 */
function describeSystemPromptSourceKind(kind: SystemPromptSourceKind | 'unknown'): string {
  if (kind === 'project') {
    return '项目 SYSTEM.md';
  }

  if (kind === 'global') {
    return '全局 SYSTEM.md';
  }

  if (kind === 'unknown') {
    return '读取失败';
  }

  return '内置默认';
}

/**
 * 渲染常规 Tab 内的系统提示词子视图；状态全部来自 command session，renderer 不读盘。
 */
function renderSystemPromptSurface(state: SystemPromptConfigState, tabs: ConfigSurfaceTab[], activeTab: ConfigTabId, columns: number, options: RenderSystemPromptOptions = {}): FooterLayout {
  const theme = resolveFooterTheme(options.theme);

  if (state.mode === 'read') {
    return renderReadView(state, tabs, activeTab, columns, options.maxLines, theme);
  }

  if (state.mode === 'edit') {
    return renderEditView(state, tabs, activeTab, columns, options.maxLines, theme);
  }

  if (state.mode === 'confirmSave' || state.mode === 'confirmReset') {
    return withoutCursor(renderConfirmView(state, tabs, activeTab, columns, theme));
  }

  return withoutCursor(renderMenuView(state, tabs, activeTab, columns, options.maxLines, theme));
}

/**
 * menu 态：状态事实 + 固定顺序按钮；动态段摘要只在按钮之后仍有预算时展示。
 */
function renderMenuView(state: SystemPromptConfigState, tabs: ConfigSurfaceTab[], activeTab: ConfigTabId, columns: number, maxLines: number | undefined, theme: FooterTheme): string[] {
  const width = boxWidth(columns);
  const limit = normalizeLineLimit(maxLines);
  const header = [
    top(width, ' CONFIG ', 'accentStrong', theme, ansi.dim('系统提示词')),
    renderTabsLine(width, tabs, activeTab, theme),
    line(width, '', theme),
    kvRow(width, '当前生效', describeSystemPromptSourceKind(state.sourceKind), false, theme),
    kvRow(width, '项目文件', describeFact(state.project), false, theme),
    kvRow(width, '全局文件', describeFact(state.global), false, theme),
    line(width, '', theme)
  ];
  const footer = [line(width, dimHint(width, '↑/↓ 移动 · Enter 执行 · Esc 返回'), theme), bottom(width, theme)];
  const feedback = state.error
    ? errorLine(width, state.error, theme)
    : state.feedback
      ? feedbackLine(width, state.feedback, theme)
      : null;

  // 高度放不下完整外框时按优先级降级，避免尾部裁剪把焦点行切走。
  if (Number.isFinite(limit) && limit < MIN_COMPACT_MENU_LINES) {
    const focused = state.menuRows[Math.min(Math.max(0, state.selectedIndex), state.menuRows.length - 1)];

    return focused ? [renderMenuRow(state, focused, true, width, theme)] : [];
  }

  if (Number.isFinite(limit) && limit < header.length + footer.length + 1) {
    const rows = createSelectedWindowRows(state.menuRows, state.selectedIndex, Math.max(1, limit - 2));
    const compact = [kvRow(width, '当前生效', describeSystemPromptSourceKind(state.sourceKind), false, theme)];

    for (const row of rows) {
      if (row.kind === 'more') {
        compact.push(moreRow(width, row.direction, row.count, theme));
      } else {
        compact.push(renderMenuRow(state, row.item, row.index === state.selectedIndex, width, theme));
      }
    }

    if (compact.length < limit) {
      compact.push(bottom(width, theme));
    }

    return compact;
  }

  const fixed = header.length + footer.length + (feedback ? 1 : 0);
  const bodyBudget = Number.isFinite(limit) ? Math.max(1, Math.floor(limit) - fixed) : Number.POSITIVE_INFINITY;
  const rows = createSelectedWindowRows(state.menuRows, state.selectedIndex, bodyBudget);
  const lines = [...header];

  for (const row of rows) {
    if (row.kind === 'more') {
      lines.push(moreRow(width, row.direction, row.count, theme));
      continue;
    }

    lines.push(renderMenuRow(state, row.item, row.index === state.selectedIndex, width, theme));
  }

  const dynamicBudget = Number.isFinite(bodyBudget) ? bodyBudget - rows.length - 2 : Number.POSITIVE_INFINITY;
  if (dynamicBudget >= 1) {
    lines.push(line(width, '', theme));
    lines.push(sectionLine(width, '动态段（运行时拼装，不可编辑）', theme));
    for (const section of state.dynamicSections.slice(0, Math.max(0, dynamicBudget))) {
      lines.push(splitRow(width, section.label, describeDynamicSection(section), false, theme));
    }
  }

  if (feedback) {
    lines.push(feedback);
  }

  lines.push(...footer);
  return lines;
}

function renderMenuRow(state: SystemPromptConfigState, row: SystemPromptMenuRow, active: boolean, width: number, theme: FooterTheme): string {
  if (row.id === 'view') {
    return actionRow(width, '查看当前生效的 system prompt', '只读', active, false, theme);
  }

  if (row.id === 'editProject' || row.id === 'editGlobal') {
    const label = row.id === 'editProject' ? '编辑项目 SYSTEM.md' : '编辑全局 SYSTEM.md';
    const exists = row.id === 'editProject' ? state.project.exists : state.global.exists;
    return actionRow(width, label, exists ? '修改现有文件' : '新建', active, false, theme);
  }

  if (row.id === 'deleteProject' || row.id === 'deleteGlobal') {
    const label = row.id === 'deleteProject' ? '删除项目 SYSTEM.md' : '删除全局 SYSTEM.md';
    return row.available
      ? actionRow(width, label, '已存在', active, true, theme)
      : splitRow(width, `${label}（不可用）`, '文件不存在', active, theme);
  }

  return actionRow(width, '返回常规设置', 'Esc', active, false, theme);
}

/**
 * 把基础文本按终端宽度展开为物理行；逻辑行过长时折行，续行不重复行号。
 * handler 用同一次投影获取滚动上限，避免 handler 与 renderer 各自换算宽度。
 */
function projectSystemPromptRead(options: {columns: number; content: string; maxLines?: number; offset: number}): SystemPromptReadProjection {
  const width = boxWidth(options.columns);
  const limit = normalizeLineLimit(options.maxLines);
  const contentLines = options.content.split('\n');
  const gutter = String(contentLines.length).length;
  const textWidth = Math.max(1, contentWidth(width) - gutter - 3);
  const rows: SystemPromptReadRow[] = [];

  contentLines.forEach((text, index) => {
    wrapTextToWidth(text, textWidth).forEach((segment, offset) => {
      rows.push({lineNumber: offset === 0 ? index + 1 : null, text: segment});
    });
  });

  const viewport = Number.isFinite(limit) ? Math.max(1, Math.floor(limit) - READ_CHROME_LINES) : Math.max(1, rows.length);
  const maxScroll = Math.max(0, rows.length - viewport);
  const offset = Number.isFinite(options.offset) ? Math.max(0, Math.floor(options.offset)) : 0;

  return {gutter, maxScroll, rows, start: Math.min(offset, maxScroll), viewport};
}

/**
 * read 态：只投影基础文本与行号，不拼接动态段；长行折行后整段可见。
 */
function renderReadView(state: SystemPromptConfigState, tabs: ConfigSurfaceTab[], activeTab: ConfigTabId, columns: number, maxLines: number | undefined, theme: FooterTheme): FooterLayout {
  const width = boxWidth(columns);
  const header = [
    top(width, ' 系统提示词 ', 'accentStrong', theme, ansi.dim(`只读 · ${describeSystemPromptSourceKind(state.sourceKind)}`)),
    renderTabsLine(width, tabs, activeTab, theme),
    line(width, '', theme)
  ];
  const footer = [line(width, dimHint(width, '↑/↓ 逐行 · PgUp/PgDn 翻页 · Esc 返回'), theme), bottom(width, theme)];
  const projection = projectSystemPromptRead({columns, content: state.baseContent, maxLines, offset: state.readScroll});
  const end = Math.min(projection.rows.length, projection.start + projection.viewport);
  const lines = [...header];

  for (let index = projection.start; index < end; index += 1) {
    const row = projection.rows[index];
    const number = row.lineNumber === null ? ' '.repeat(projection.gutter) : String(row.lineNumber).padStart(projection.gutter, ' ');
    lines.push(line(width, `${ansi.dim(number)} │ ${row.text}`, theme));
  }

  lines.push(...footer);
  return withoutCursor(lines);
}

/**
 * edit 态：多行 composer 投影，窗口始终包含光标行，并返回真实终端光标位置。
 */
function renderEditView(state: SystemPromptConfigState, tabs: ConfigSurfaceTab[], activeTab: ConfigTabId, columns: number, maxLines: number | undefined, theme: FooterTheme): FooterLayout {
  const width = boxWidth(columns);
  const limit = normalizeLineLimit(maxLines);
  const header = [
    top(width, ' 系统提示词 ', 'accentStrong', theme, ansi.dim(`编辑 ${describeSystemPromptSourceKind(state.target)}`)),
    renderTabsLine(width, tabs, activeTab, theme),
    line(width, '', theme)
  ];
  const footer = [line(width, dimHint(width, 'Enter 保存 · Ctrl+J 换行 · Esc 取消'), theme), bottom(width, theme)];
  const bodyWidth = Math.max(1, contentWidth(width) - EDIT_BODY_OFFSET);
  // renderComposer 已给出折行后的可见行与光标位置，编辑语义仍由 composer 自身维护。
  const projection = state.draft
    ? renderComposer(state.draft, bodyWidth + 1, ' '.repeat(EDIT_BODY_OFFSET))
    : {lines: [' '.repeat(EDIT_BODY_OFFSET)], cursorRow: 0, cursorColumn: EDIT_BODY_OFFSET};
  const fixed = header.length + footer.length;
  const viewport = Number.isFinite(limit) ? Math.max(1, Math.floor(limit) - fixed) : projection.lines.length;
  const start = Math.min(Math.max(0, projection.cursorRow - viewport + 1), Math.max(0, projection.lines.length - viewport));
  const end = Math.min(projection.lines.length, start + viewport);
  const lines = [...header];

  for (let index = start; index < end; index += 1) {
    lines.push(line(width, clampPlainText(projection.lines[index], contentWidth(width)), theme));
  }

  lines.push(...footer);
  return {
    lines,
    cursorRow: header.length + (projection.cursorRow - start),
    // line() 自带左框与一个空格占两列。
    cursorColumn: Math.min(2 + projection.cursorColumn, Math.max(2, width - 3)),
    showCursor: true
  };
}

/**
 * confirm 态：写入展示覆盖事实，删除展示 handler 预先算好的回落来源。
 */
function renderConfirmView(state: SystemPromptConfigState, tabs: ConfigSurfaceTab[], activeTab: ConfigTabId, columns: number, theme: FooterTheme): string[] {
  const width = boxWidth(columns);
  const isSave = state.mode === 'confirmSave';
  const target = state.target === 'global' ? state.global : state.project;
  const lines = [
    top(width, ' 系统提示词 ', 'accentStrong', theme, ansi.dim(isSave ? '确认写入' : '确认删除')),
    renderTabsLine(width, tabs, activeTab, theme),
    line(width, '', theme),
    kvRow(width, isSave ? '写入目标' : '将删除', target.filePath, false, theme)
  ];

  if (isSave) {
    lines.push(kvRow(width, '覆盖', state.pendingOverwrites ? '是（替换现有文件）' : '否（新建）', false, theme));
    lines.push(actionRow(width, '确认写入', '原子替换目标文件', state.confirmIndex === 0, false, theme));
    lines.push(actionRow(width, '返回编辑', '保留当前草稿', state.confirmIndex === 1, false, theme));
  } else {
    if (state.pendingFallback !== undefined) {
      lines.push(kvRow(width, '回落', state.pendingFallback, false, theme));
    }
    lines.push(actionRow(width, '确认删除', '只删除该文件', state.confirmIndex === 0, true, theme));
    lines.push(actionRow(width, '取消', '保留文件', state.confirmIndex === 1, false, theme));
  }

  if (state.error) {
    lines.push(errorLine(width, state.error, theme));
  }

  lines.push(line(width, '', theme));
  lines.push(line(width, dimHint(width, '↑/↓ 移动 · Enter 确认 · Esc 返回'), theme));
  lines.push(bottom(width, theme));
  return lines;
}

function describeFact(fact: SystemPromptFileFact): string {
  if (fact.unavailableReason) {
    return `不可用 · ${fact.unavailableReason}`;
  }

  if (!fact.exists) {
    return `不存在 · ${fact.filePath}`;
  }

  return `${fact.filePath} · ${fact.lines} 行`;
}

function describeDynamicSection(section: SystemPromptDynamicSection): string {
  return section.estimatedTokens === undefined
    ? section.detail
    : `${section.detail} · ~${section.estimatedTokens.toLocaleString('en-US')} tokens`;
}

function withoutCursor(lines: string[]): FooterLayout {
  return {lines, cursorRow: Math.max(0, lines.length - 1), cursorColumn: 0, showCursor: false};
}

export {
  describeSystemPromptSourceKind,
  projectSystemPromptRead,
  renderSystemPromptSurface
};

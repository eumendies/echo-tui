/**
 * pending preview 渲染：thinking、tool call、并行子 Agent、streaming、reasoning 与 shell 输出的有界预览。
 */
import * as ansi from '../../terminal/ansi';
import {blockText} from '../colors';
import {DEFAULT_TUI_THEME, type TuiTheme} from '../../config/theme-config';
import {collapseToSingleLine, displayWidth, safeRenderWidth} from '../layout';
import {renderMarkdownLinesWithOptions} from '../markdown';
import {createCompactToolCallPreviewText, renderToolCallPreviewLines} from '../tool-message-renderer';
import {createSubagentRunRowText, renderSubagentPendingLines} from '../subagent-renderer';
import {clampToDisplayWidth, padToDisplayWidth, renderSymbolMessage} from './symbol-message-renderer';
import {renderReasoningSummaryLines, renderShellMessageLines, withMarkdownRoleColor} from './message-renderer';

import type { PendingState, PendingToolCall, SubagentPendingState } from '../../types/render';

/**
 * 把 pending assistant 状态投影为逐行字符串。
 * pending 包括 thinking、reasoning_streaming、streaming、tool_call、tool_calls、shell_output 状态
 * thinking状态：由 status line 展示，pending preview 不再占独立行
 * reasoning_streaming状态：展示有界的可读 reasoning preview
 * streaming状态：展示模型正文流式输出内容
 * tool_call状态：展示模型调用的工具
 *
 */
export function renderPendingAssistantLines(
  pending: PendingState,
  width = 80,
  maxLines = Number.POSITIVE_INFINITY,
  theme: TuiTheme = DEFAULT_TUI_THEME
): string[] {
  const normalizedMaxLines = normalizePreviewMaxLines(maxLines);

  if (normalizedMaxLines === 0) {
    return [];
  }

  if (pending.kind === 'thinking') {
    return [];
  }

  if (pending.kind === 'tool_call') {
    return truncatePendingPreviewLines(renderToolCallPreviewLines(pending.toolName, pending.argumentsText, width, theme), width, normalizedMaxLines, theme);
  }

  if (pending.kind === 'tool_calls') {
    return renderPendingToolCallsLines(pending.calls, width, normalizedMaxLines, theme);
  }

  if (pending.kind === 'shell_output') {
    return renderShellOutputPendingLines(pending.output.slice(pending.historyRawLength ?? 0), width, normalizedMaxLines, theme);
  }

  if (pending.kind === 'reasoning_streaming') {
    return renderReasoningPendingLines(pending.text, pending.historyText || '', width, normalizedMaxLines, theme);
  }

  if (pending.kind === 'subagent') {
    return renderSubagentPendingLines(pending, width, normalizedMaxLines, theme);
  }

  if (pending.kind === 'subagents') {
    return renderSubagentsPendingLines(pending.runs, width, normalizedMaxLines, theme);
  }

  return renderStreamingPendingLines(pending.text, pending.historyText || '', width, normalizedMaxLines, theme);
}

/**
 * 将多个运行中工具投影为一个 compact 活动块；标题和隐藏数量都计入 footer 物理行预算。
 */
function renderPendingToolCallsLines(calls: PendingToolCall[], width: number, maxLines: number, theme: TuiTheme): string[] {
  if (maxLines <= 0) {
    return [];
  }

  const safeWidth = safeRenderWidth(width);
  const header = renderCompactPendingToolHeader(calls.length, safeWidth, theme);
  if (maxLines === 1) {
    return [header];
  }

  const availableRows = maxLines - 1;
  if (calls.length <= availableRows) {
    return [
      header,
      ...calls.map((call, index) => renderCompactPendingToolRow(
        createCompactToolCallPreviewText(call.toolName, call.argumentsText, theme),
        index === calls.length - 1 ? '└─ ' : '├─ ',
        safeWidth,
        theme
      ))
    ];
  }

  const visibleCount = Math.max(0, availableRows - 1);
  const hiddenCount = calls.length - visibleCount;
  return [
    header,
    ...calls.slice(0, visibleCount).map((call) => renderCompactPendingToolRow(
      createCompactToolCallPreviewText(call.toolName, call.argumentsText, theme),
      '├─ ',
      safeWidth,
      theme
    )),
    renderCompactPendingToolRow(`… +${hiddenCount} more`, '└─ ', safeWidth, theme, true)
  ];
}

/** 渲染多工具 compact 块的共享标题，并让状态文本遵守 safe width。 */
function renderCompactPendingToolHeader(count: number, width: number, theme: TuiTheme): string {
  return renderCompactPendingHeader(`${count} tools · running`, width, theme);
}

/** 渲染 compact pending 块的共享标题；标记符使用工具输出色，其余文本遵守 safe width。 */
function renderCompactPendingHeader(label: string, width: number, theme: TuiTheme): string {
  const plain = clampToDisplayWidth(`◆ ${label}`, width);
  return plain.startsWith('◆') ? `${blockText(theme, 'toolOutput', '◆')}${plain.slice(1)}` : plain;
}

/** 渲染一个单行工具摘要或隐藏数量行；树形前缀使用 muted 色降低视觉噪声。 */
function renderCompactPendingToolRow(text: string, prefix: '├─ ' | '└─ ', width: number, theme: TuiTheme, dimText = false): string {
  const structuralPrefix = `  ${prefix}`;
  // 行文本来自任务/参数等外部来源,可能含换行;单行摘要契约在此收口。
  const plain = clampToDisplayWidth(`${structuralPrefix}${collapseToSingleLine(text)}`, width);
  if (!plain.startsWith(structuralPrefix)) {
    return blockText(theme, 'muted', plain);
  }

  const content = plain.slice(structuralPrefix.length);
  return `${blockText(theme, 'muted', structuralPrefix)}${dimText ? ansi.dim(blockText(theme, 'muted', content)) : content}`;
}

/**
 * 将多个并行子 Agent 投影为一个 compact 活动块；每行固定展示名称、任务摘要、阶段与 elapsed。
 * 行序按 start 顺序稳定排列，预算不足时折叠为隐藏数量行。
 */
function renderSubagentsPendingLines(runs: SubagentPendingState[], width: number, maxLines: number, theme: TuiTheme): string[] {
  if (maxLines <= 0 || runs.length === 0) {
    return [];
  }

  const safeWidth = safeRenderWidth(width);
  const totalSeconds = (Math.max(...runs.map((run) => run.elapsedMs)) / 1000).toFixed(1);
  const header = renderCompactPendingHeader(`${runs.length} agents · ${totalSeconds}s · ctrl+o 详情`, safeWidth, theme);
  if (maxLines === 1) {
    return [header];
  }

  const rows = runs.map((run) => createSubagentRunRowText(run));
  const availableRows = maxLines - 1;
  if (rows.length <= availableRows) {
    return [
      header,
      ...rows.map((text, index) => renderCompactPendingToolRow(
        text,
        index === rows.length - 1 ? '└─ ' : '├─ ',
        safeWidth,
        theme
      ))
    ];
  }

  const visibleCount = Math.max(0, availableRows - 1);
  const hiddenCount = rows.length - visibleCount;
  return [
    header,
    ...rows.slice(0, visibleCount).map((text) => renderCompactPendingToolRow(text, '├─ ', safeWidth, theme)),
    renderCompactPendingToolRow(`… +${hiddenCount} more`, '└─ ', safeWidth, theme, true)
  ];
}

/**
 * 渲染 reasoning 流式预览；已经移入终端历史区的部分不再重复显示。
 */
function renderReasoningPendingLines(text: string, historyText: string, width: number, maxLines: number, theme: TuiTheme): string[] {
  const fullLines = renderReasoningSummaryLines(text, width, theme);
  const committedLineCount = historyText === '' ? 0 : renderReasoningSummaryLines(historyText, width, theme).length;
  const lines = fullLines.slice(committedLineCount);
  const normalizedMaxLines = normalizePreviewMaxLines(maxLines);

  if (normalizedMaxLines === 0) {
    return [];
  }

  if (lines.length <= normalizedMaxLines) {
    return lines;
  }

  const safeTextWidth = Math.max(1, safeRenderWidth(width) - displayWidth('◇ '));

  if (normalizedMaxLines === 1) {
    const summaryText = clampToDisplayWidth(`…已生成 ${lines.length} 行 reasoning`, safeTextWidth);
    return renderReasoningSummaryLines(summaryText, width, theme);
  }

  const tailLineCount = normalizedMaxLines - 1;
  const summaryText = clampToDisplayWidth(`…已生成 ${lines.length} 行 reasoning，显示最新 ${tailLineCount} 行`, safeTextWidth);
  return [renderReasoningSummaryLines(summaryText, width, theme)[0], ...lines.slice(-tailLineCount)];
}

/**
 * 渲染 shell mode 运行期尚未确定的输出尾部；已进入终端历史区的命令行与完整行不再重复展示。
 * 只做纯文本换行和尾部截断，不走 Markdown。
 */
function renderShellOutputPendingLines(output: string, width: number, maxLines: number, theme: TuiTheme): string[] {
  const text = output.replace(/\n$/u, '');

  if (text === '') {
    return [];
  }

  const lines = renderShellMessageLines(text, width, theme);

  if (lines.length <= maxLines) {
    return lines;
  }

  if (maxLines <= 0) {
    return [];
  }

  const safeWidth = safeRenderWidth(width);
  if (maxLines === 1) {
    const summary = clampToDisplayWidth(`…已生成 ${lines.length} 行`, safeWidth);
    return [blockText(theme, 'shell', padToDisplayWidth(summary, safeWidth))];
  }

  const tailLineCount = maxLines - 1;
  const summary = clampToDisplayWidth(`…已生成 ${lines.length} 行，显示最新 ${tailLineCount} 行`, safeWidth);
  return [blockText(theme, 'shell', padToDisplayWidth(summary, safeWidth)), ...lines.slice(-tailLineCount)];
}

/**
 * 渲染 streaming pending preview；长文本只保留尾部，避免 footer 高度无限增长。
 *
 */
function renderStreamingPendingLines(text: string, historyText: string, width: number, maxLines: number, theme: TuiTheme): string[] {
  const pendingTheme = withMarkdownRoleColor(theme, theme.blocks.colors.pendingPrefix);
  const fullLines = renderMarkdownLinesWithOptions(text, { width, prefix: '◇ ', theme: pendingTheme });
  const committedLineCount = historyText === ''
    ? 0
    : renderMarkdownLinesWithOptions(historyText, { width, prefix: '◇ ', theme: pendingTheme }).length;
  const lines = fullLines.slice(committedLineCount);
  const normalizedMaxLines = normalizePreviewMaxLines(maxLines);

  if (normalizedMaxLines === 0) {
    return [];
  }

  if (lines.length <= normalizedMaxLines) {
    return lines;
  }

  if (normalizedMaxLines === 1) {
    const summary = `…已生成 ${lines.length} 行`;
    const summaryText = clampToDisplayWidth(summary, Math.max(1, safeRenderWidth(width) - displayWidth('◇ ')));

    return renderSymbolMessage({
      text: summaryText,
      width,
      prefix: '◇ ',
        colorizePrefix: (prefix) => blockText(theme, 'pendingPrefix', prefix)
    });
  }

  const tailLineCount = normalizedMaxLines - 1;
  const summary = `…已生成 ${lines.length} 行，显示最新 ${tailLineCount} 行`;
  const summaryText = clampToDisplayWidth(summary, Math.max(1, safeRenderWidth(width) - displayWidth('◇ ')));
  const summaryLine = renderSymbolMessage({
    text: summaryText,
    width,
    prefix: '◇ ',
      colorizePrefix: (prefix) => blockText(theme, 'pendingPrefix', prefix)
  })[0];

  return [summaryLine, ...lines.slice(-tailLineCount)];
}

function normalizePreviewMaxLines(maxLines: number): number {
  return Number.isFinite(maxLines) ? Math.max(0, Math.floor(maxLines)) : Number.POSITIVE_INFINITY;
}

function truncatePendingPreviewLines(lines: string[], width: number, maxLines: number, theme: TuiTheme): string[] {
  if (lines.length <= maxLines) {
    return lines;
  }

  if (maxLines <= 0) {
    return [];
  }

  if (maxLines === 1) {
    return [lines[0]];
  }

  const hiddenCount = lines.length - maxLines + 1;
  const summary = clampToDisplayWidth(`…隐藏 ${hiddenCount} 行 tool call preview`, safeRenderWidth(width));
    return [...lines.slice(0, maxLines - 1), ansi.dim(blockText(theme, 'muted', summary))];
}

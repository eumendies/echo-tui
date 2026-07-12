import * as ansi from '../../terminal/ansi';
import { wrapText } from '../layout';
import { renderChoiceSurface } from './choice-surface';
import { renderConfigSurface } from './config-surface';
import { renderContextSurface } from './context-surface';
import { renderCopySurface } from './copy-surface';
import { renderDiffSurface } from './diff-surface';
import { renderFilePickerSurface } from './file-picker-surface';
import { renderHooksSurface } from './hooks-surface';
import { renderMcpSurface } from './mcp-surface';
import { renderMemorySurface } from './memory-surface';
import { renderResumeSurface } from './resume-surface';
import { renderScaleSurface } from './scale-surface';
import { renderSkillsSurface } from './skills-surface';
import { renderUsageSurface } from './usage-surface';
import { activeBackground, renderFocusBar, resolveFooterTheme, tokenText, type TuiTheme, type FooterTheme } from '../colors';
import { clampPlainText, formatSelectOptionText, padVisibleText } from './text';
import { constrainLayoutTail, createSelectedWindowRows } from './window';
import type {
  CheckboxCommandSurface,
  CommandSurface,
  ConfirmCommandSurface,
  InfoCommandSurface,
  SelectCommandSurface
} from '../../types/command';
import type { FooterLayout } from '../../types/render';

type CommandSurfaceRenderOptions = {
  maxLines?: number;
  theme?: TuiTheme;
};

/**
 * 根据统一 surface kind 渲染命令面板，而不是读取具体命令名。
 */
export function renderCommandSurface(commandSurface: CommandSurface, width: number, options: CommandSurfaceRenderOptions = {}): FooterLayout {
  const theme = resolveFooterTheme(options.theme);

  if (commandSurface.kind === 'info') {
    return renderInfoSurface(commandSurface, width, options.maxLines, theme);
  }

  if (commandSurface.kind === 'select') {
    return renderSelectSurface(commandSurface, width, options.maxLines, theme);
  }

  if (commandSurface.kind === 'resume') {
    return constrainLayoutTail(renderResumeSurface(commandSurface, width, theme), options.maxLines);
  }

  if (commandSurface.kind === 'checkbox') {
    return renderCheckboxSurface(commandSurface, width, options.maxLines, theme);
  }

  if (commandSurface.kind === 'skills') {
    return constrainLayoutTail(renderSkillsSurface(commandSurface, width, theme), options.maxLines);
  }

  if (commandSurface.kind === 'mcp') {
    return constrainLayoutTail(renderMcpSurface(commandSurface, width, theme), options.maxLines);
  }

  if (commandSurface.kind === 'memory') {
    return constrainLayoutTail(renderMemorySurface(commandSurface, width, theme), options.maxLines);
  }

  if (commandSurface.kind === 'hooks') {
    return constrainLayoutTail(renderHooksSurface(commandSurface, width, theme), options.maxLines);
  }

  if (commandSurface.kind === 'scale') {
    return constrainLayoutTail(renderScaleSurface(commandSurface, width, theme), options.maxLines);
  }

  if (commandSurface.kind === 'choice') {
    return renderChoiceSurface(commandSurface, width, options.maxLines, theme);
  }

  if (commandSurface.kind === 'confirm') {
    return renderConfirmSurface(commandSurface, width, options.maxLines, theme);
  }

  if (commandSurface.kind === 'config') {
    return renderConfigSurface(commandSurface, width, {maxLines: options.maxLines, theme: options.theme});
  }

  if (commandSurface.kind === 'context') {
    return renderContextSurface(commandSurface, width, options.maxLines, theme);
  }

  if (commandSurface.kind === 'usage') {
    return renderUsageSurface(commandSurface, width, options.maxLines, theme);
  }

  if (commandSurface.kind === 'copy') {
    return renderCopySurface(commandSurface, width, options.maxLines, options.theme);
  }

  if (commandSurface.kind === 'file_picker') {
    return renderFilePickerSurface(commandSurface, width, options.maxLines, options.theme);
  }

  if (commandSurface.kind === 'diff') {
    return renderDiffSurface(commandSurface, width, options.maxLines, theme);
  }

  const unsupported: never = commandSurface;
  return unsupported;
}

/**
 * 渲染只读信息面板，用于命令错误、安全提示和纯说明内容。
 */
function renderInfoSurface(commandSurface: InfoCommandSurface, width: number, maxLines: number | undefined, theme: FooterTheme): FooterLayout {
  const titleLines = wrapText(commandSurface.title || '', width).map((line) => ansi.bold(tokenText(theme, 'accentStrong', line)));
  const bodyLines = (commandSurface.lines || []).flatMap((line) => wrapText(line, width, '  '));
  const dismissLine = ansi.dim(commandSurface.dismissHint || 'Esc 关闭');
  const bodyBudget = calculateBodyBudget(maxLines, titleLines.length, 1);
  const lines = [...titleLines, ...bodyLines, dismissLine];
  const visibleLines = bodyBudget === null ? lines : [...titleLines, ...bodyLines.slice(0, bodyBudget), dismissLine];

  return {
    lines: visibleLines,
    cursorRow: visibleLines.length - 1,
    cursorColumn: 0,
    showCursor: false
  };
}

/**
 * 渲染单选列表面板；选中项只影响可见高亮，不在渲染层产生业务副作用。
 */
function renderSelectSurface(commandSurface: SelectCommandSurface, width: number, maxLines: number | undefined, theme: FooterTheme): FooterLayout {
  const titleLines = wrapText(commandSurface.title || '', width).map((line) => ansi.bold(tokenText(theme, 'accentStrong', line)));
  const optionLines: string[] = [];
  const options = commandSurface.options || [];
  const selectedIndex = Number.isInteger(commandSurface.selectedIndex) ? Number(commandSurface.selectedIndex) : 0;
  const optionBudget = calculateBodyBudget(maxLines, titleLines.length, 1);
  const visibleRows = optionBudget === null
    ? options.map((option, index) => ({kind: 'item' as const, item: option, index}))
    : createSelectedWindowRows(options, selectedIndex, optionBudget);

  for (const row of visibleRows) {
    if (row.kind === 'more') {
      optionLines.push(ansi.dim(`  ${row.direction === 'up' ? '↑' : '↓'} ${row.count} 更多`));
      continue;
    }

    const option = row.item;
    const originalIndex = row.index;
    const optionText = formatSelectOptionText(option.label, option.description);

    if (originalIndex === selectedIndex) {
      optionLines.push(renderFocusedPlainOption(optionText, width, theme));
    } else {
      optionLines.push(`  ${clampPlainText(optionText, Math.max(1, width - 2))}`);
    }
  }

  const dismissLine = ansi.dim(commandSurface.dismissHint || 'Enter 确认 · Esc 关闭');
  const lines = [...titleLines, ...optionLines, dismissLine];

  return {
    lines,
    cursorRow: lines.length - 1,
    cursorColumn: 0,
    showCursor: false
  };
}

/**
 * 渲染复选列表面板；checkbox 状态由 command runtime 提供，renderer 只投影当前快照。
 */
function renderCheckboxSurface(commandSurface: CheckboxCommandSurface, width: number, maxLines: number | undefined, theme: FooterTheme): FooterLayout {
  const titleLines = wrapText(commandSurface.title || '', width).map((line) => ansi.bold(tokenText(theme, 'accentStrong', line)));
  const optionLines: string[] = [];
  const options = commandSurface.options || [];
  const selectedIndex = Number.isInteger(commandSurface.selectedIndex) ? Number(commandSurface.selectedIndex) : 0;
  const optionBudget = calculateBodyBudget(maxLines, titleLines.length, 1);
  const visibleRows = optionBudget === null
    ? options.map((option, index) => ({kind: 'item' as const, item: option, index}))
    : createSelectedWindowRows(options, selectedIndex, optionBudget);

  for (const row of visibleRows) {
    if (row.kind === 'more') {
      optionLines.push(ansi.dim(`  ${row.direction === 'up' ? '↑' : '↓'} ${row.count} 更多`));
      continue;
    }

    const option = row.item;
    const originalIndex = row.index;
    const marker = option.checked ? '●' : '○';
    const optionText = formatSelectOptionText(`${marker} ${option.label || ''}`, option.description);

    if (originalIndex === selectedIndex) {
      optionLines.push(renderFocusedPlainOption(optionText, width, theme));
    } else {
      optionLines.push(`  ${clampPlainText(optionText, Math.max(1, width - 2))}`);
    }
  }

  const dismissLine = ansi.dim(commandSurface.dismissHint || 'Space 切换 · Enter 确认 · Esc 关闭');
  const lines = [...titleLines, ...optionLines, dismissLine];

  return {
    lines,
    cursorRow: lines.length - 1,
    cursorColumn: 0,
    showCursor: false
  };
}

/**
 * 渲染确认面板；Enter/Esc 的语义由 command runtime 处理。
 */
function renderConfirmSurface(commandSurface: ConfirmCommandSurface, width: number, maxLines: number | undefined, theme: FooterTheme): FooterLayout {
  const titleLines = wrapText(commandSurface.title || '', width).map((line) => ansi.bold(tokenText(theme, 'accentStrong', line)));
  const bodyLines = (commandSurface.bodyLines || []).flatMap((line) => wrapText(line, width, '  '));
  const confirmLabel = commandSurface.confirmLabel || '确认';
  const cancelLabel = commandSurface.cancelLabel || '取消';
  const actionText = tokenText(theme, 'accentStrong', ansi.bold(` Enter ${confirmLabel} `));
  const actionLine = `${activeBackground(theme, actionText)}  ${ansi.dim(`Esc ${cancelLabel}`)}`;
  const bodyBudget = calculateBodyBudget(maxLines, titleLines.length, 1);
  const lines = bodyBudget === null ? [...titleLines, ...bodyLines, actionLine] : [...titleLines, ...bodyLines.slice(0, bodyBudget), actionLine];

  return {
    lines,
    cursorRow: lines.length - 1,
    cursorColumn: 0,
    showCursor: false
  };
}

/**
 * 渲染普通列表当前项：粗竖条只表达焦点，不为无 toggle 语义的 select 强加状态 marker。
 */
function renderFocusedPlainOption(optionText: string, width: number, theme: FooterTheme): string {
  const rowWidth = Math.max(1, width - 1);
  const text = tokenText(theme, 'accentStrong', ansi.bold(clampPlainText(optionText, Math.max(1, rowWidth - 1))));
  return `${renderFocusBar(theme)}${activeBackground(theme, padVisibleText(` ${text}`, rowWidth))}`;
}

function calculateBodyBudget(maxLines: number | undefined, leadingCount: number, trailingCount: number): number | null {
  if (!Number.isFinite(maxLines)) {
    return null;
  }

  return Math.max(0, Math.floor(Number(maxLines)) - leadingCount - trailingCount);
}

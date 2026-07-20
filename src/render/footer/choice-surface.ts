import * as ansi from '../../terminal/ansi';
import { displayWidth, safeRenderWidth, wrapText } from '../layout';
import { activeBackground, codeBackground, renderFocusBar, resolveFooterTheme, tokenText, type FooterTheme } from '../colors';
import { clampPlainText, padVisibleText } from './text';
import { clampCursorRow, clampIndex, normalizeLineLimit } from './window';
import type { ChoiceCommandSurface, ChoiceCommandSurfaceTab } from '../../types/command';
import type { FooterLayout } from '../../types/render';

const CHOICE_CARD_MIN_WIDTH = 48;
const CHOICE_CARD_MAX_WIDTH = 88;
// 受限布局固定保留：顶部边框、操作提示、底部边框；空白分隔行会被省略。
const CHOICE_CARD_CONSTRAINED_FIXED_LINES = 3;
// options 放不下全量时，仍尽量给选中项周围保留一小段可读上下文。
const CHOICE_CARD_OPTION_WINDOW_TARGET_LINES = 3;

type ChoiceOptionLine = {
  hasInlineInput: boolean;
  labelText: string;
  inputText: string;
  inputIsPlaceholder: boolean;
  plain: string;
  plainBeforeCursor: string;
};

type InlineInputViewport = {
  text: string;
  beforeCursor: string;
};

type ChoiceOptionRenderUnit = {
  cursorColumn?: number;
  cursorRow?: number;
  lines: string[];
};

/**
 * 渲染统一 choice card；调用方只提供标题、正文 section、选项 section 和当前选择快照。
 */
export function renderChoiceSurface(commandSurface: ChoiceCommandSurface, width: number, maxLines = Number.POSITIVE_INFINITY, theme: FooterTheme = resolveFooterTheme(undefined)): FooterLayout {
  const boxWidth = calculateChoiceCardBoxWidth(commandSurface, width);
  const innerWidth = Math.max(1, boxWidth - 2);
  const options = commandSurface.options;
  const focusedIndex = commandSurface.focusedIndex;
  const selectionMode = commandSurface.selectionMode || 'single';
  const topLine = renderChoiceCardBorderTop(commandSurface.title, innerWidth, theme);
  const tabLines = renderChoiceCardTabs(commandSurface.tabs, commandSurface.activeTabIndex, innerWidth, theme);
  const messageLines = commandSurface.message
    ? renderChoiceCardMessageSection(commandSurface.message, commandSurface.messageTitle || '消息', commandSurface.messageStyle || 'text', innerWidth, theme)
    : [];
  const optionsLine = renderChoiceCardBoxLine(renderChoiceCardSectionRule(commandSurface.optionsTitle, Math.max(1, innerWidth - 2), theme), innerWidth, theme);
  const optionUnits = options.map((option, index) => renderChoiceCardOptionUnit(option, index, focusedIndex, selectionMode, innerWidth, theme));
  const dismissHint = commandSurface.dismissHint;
  const dismissLine = renderChoiceCardBoxLine(ansi.dim(clampPlainText(dismissHint, Math.max(1, innerWidth - 2))), innerWidth, theme);
  const bottomLine = renderChoiceCardBorderBottom(innerWidth, theme);
  const fullLayout = createChoiceCardLayout({
    bottomLine,
    dismissLine,
    messageLines,
    optionUnits,
    optionsLine,
    tabLines,
    topLine,
    theme
  });

  if (fullLayout.lines.length <= maxLines) {
    return fullLayout;
  }

  return createConstrainedChoiceCardLayout({
    bottomLine,
    dismissLine,
    maxLines,
    messageLines,
    optionUnits,
    optionsLine,
    focusedIndex,
    tabLines,
    topLine,
    theme
  });
}

/**
 * 组装完整 choice card；假设调用方已给出终端安全宽度和未受限的行预算。
 */
function createChoiceCardLayout(options: {
  bottomLine: string;
  dismissLine: string;
  messageLines: string[];
  optionUnits: ChoiceOptionRenderUnit[];
  optionsLine: string;
  tabLines: string[];
  theme: FooterTheme;
  topLine: string;
}): FooterLayout {
  const lines: string[] = [options.topLine];
  let cursorRow = 0;
  let cursorColumn = 0;
  let showCursor = false;

  lines.push(...options.tabLines);
  lines.push(renderChoiceCardBoxLine('', displayWidth(options.topLine) - 2, options.theme));
  lines.push(...options.messageLines);

  if (options.messageLines.length > 0) {
    lines.push(renderChoiceCardBoxLine('', displayWidth(options.topLine) - 2, options.theme));
  }

  lines.push(options.optionsLine);

  for (const unit of options.optionUnits) {
    const unitStart = lines.length;

    if (typeof unit.cursorRow === 'number' && typeof unit.cursorColumn === 'number') {
      cursorRow = unitStart + unit.cursorRow;
      cursorColumn = unit.cursorColumn;
      showCursor = true;
    }

    lines.push(...unit.lines);
  }

  lines.push(renderChoiceCardBoxLine('', displayWidth(options.topLine) - 2, options.theme));
  lines.push(options.dismissLine);
  lines.push(options.bottomLine);

  return {
    lines,
    cursorColumn: showCursor ? cursorColumn : 0,
    cursorRow: showCursor ? cursorRow : lines.length - 1,
    showCursor
  };
}

/**
 * 在 footer 行数受限时组装 choice card；优先保留交互选项和底部操作提示。
 */
function createConstrainedChoiceCardLayout(options: {
  bottomLine: string;
  dismissLine: string;
  maxLines: number;
  messageLines: string[];
  optionUnits: ChoiceOptionRenderUnit[];
  optionsLine: string;
  tabLines: string[];
  focusedIndex: number;
  theme: FooterTheme;
  topLine: string;
}): FooterLayout {
  const normalizedMaxLines = normalizeLineLimit(options.maxLines);
  const innerWidth = Math.max(1, displayWidth(options.topLine) - 2);
  const fixedLines = CHOICE_CARD_CONSTRAINED_FIXED_LINES + options.tabLines.length;

  if (normalizedMaxLines <= fixedLines) {
    return {
      lines: [options.topLine, ...options.tabLines, options.dismissLine, options.bottomLine].slice(0, normalizedMaxLines),
      cursorColumn: 0,
      cursorRow: clampCursorRow(normalizedMaxLines - 2, normalizedMaxLines),
      showCursor: false
    };
  }

  const bodyLines = normalizedMaxLines - fixedLines;
  const optionLineBudget = calculateChoiceCardOptionLineBudget(options.optionUnits, options.focusedIndex, bodyLines);
  const visibleOptionUnits = createVisibleOptionWindow(options.optionUnits, options.focusedIndex, optionLineBudget);
  const usedOptionLines = visibleOptionUnits.reduce((sum, unit) => sum + unit.lines.length, 0);
  let remainingLines = Math.max(0, bodyLines - usedOptionLines);
  const lines: string[] = [options.topLine];
  let cursorRow = 0;
  let cursorColumn = 0;
  let showCursor = false;

  lines.push(...options.tabLines);

  if (options.messageLines.length > 0 && remainingLines > 1) {
    const visibleMessageLines = createVisibleChoiceCardMessageLines(options.messageLines, remainingLines - 1, innerWidth, options.theme);
    lines.push(...visibleMessageLines);
    remainingLines -= visibleMessageLines.length;
  }

  if (remainingLines > 0) {
    lines.push(options.optionsLine);
  }

  for (const unit of visibleOptionUnits) {
    const unitStart = lines.length;

    if (typeof unit.cursorRow === 'number' && typeof unit.cursorColumn === 'number') {
      cursorRow = unitStart + unit.cursorRow;
      cursorColumn = unit.cursorColumn;
      showCursor = true;
    }

    lines.push(...unit.lines);
  }

  lines.push(options.dismissLine);
  lines.push(options.bottomLine);

  const visibleLines = lines.slice(0, normalizedMaxLines);

  return {
    lines: visibleLines,
    cursorColumn,
    cursorRow: clampCursorRow(cursorRow, visibleLines.length),
    showCursor
  };
}

/**
 * 计算受限 card 中 option 区可使用的行数，确保焦点项始终可见。
 */
function calculateChoiceCardOptionLineBudget(units: ChoiceOptionRenderUnit[], focusedIndex: number, bodyLines: number): number {
  const normalizedBodyLines = Math.max(0, Math.floor(bodyLines));

  if (normalizedBodyLines <= 0 || units.length === 0) {
    return 0;
  }

  const totalOptionLines = units.reduce((sum, unit) => sum + unit.lines.length, 0);
  const focusedUnit = units[clampIndex(focusedIndex, units.length)];

  if (totalOptionLines <= normalizedBodyLines) {
    return totalOptionLines;
  }

  const focusedOptionLines = focusedUnit ? Math.min(focusedUnit.lines.length, normalizedBodyLines) : 0;
  return Math.min(normalizedBodyLines, Math.max(focusedOptionLines, CHOICE_CARD_OPTION_WINDOW_TARGET_LINES));
}

/**
 * 渲染 choice card 正文分区；code 样式用于命令，text 样式用于普通问题说明。
 */
function renderChoiceCardMessageSection(message: string, title: string, style: NonNullable<ChoiceCommandSurface['messageStyle']>, innerWidth: number, theme: FooterTheme): string[] {
  const contentWidth = Math.max(1, innerWidth - 2);
  const sectionLine = renderChoiceCardBoxLine(renderChoiceCardSectionRule(title, contentWidth, theme), innerWidth, theme);

  if (style === 'code') {
    const codeWidth = Math.max(1, contentWidth - 3);
    const messageLines = wrapText(message, codeWidth);
    return [
      sectionLine,
      ...messageLines.map((line) => renderChoiceCardCodeLine(line, innerWidth, theme))
    ];
  }

  const textLines = wrapText(message, contentWidth, ' ');
  return [
    sectionLine,
    ...textLines.map((line) => renderChoiceCardBoxLine(ansi.white(clampPlainText(line, contentWidth)), innerWidth, theme))
  ];
}

/**
 * 渲染单行 code-like 内容；用深色背景突出真实待执行文本。
 */
function renderChoiceCardCodeLine(line: string, innerWidth: number, theme: FooterTheme): string {
  const contentWidth = Math.max(1, innerWidth - 2);
  const codeWidth = Math.max(1, contentWidth - 2);
  const codeText = clampPlainText(line, Math.max(1, codeWidth - 1));
  const code = codeBackground(theme, padVisibleText(` ${ansi.bold(codeText)}`, codeWidth));

  return renderChoiceCardBoxLine(` ${code}`, innerWidth, theme);
}

/**
 * 按高度预算裁剪正文分区；空间不足时显示明确的 truncated 提示。
 */
function createVisibleChoiceCardMessageLines(lines: string[], maxLines: number, innerWidth: number, theme: FooterTheme): string[] {
  const normalizedMaxLines = Math.max(0, Math.floor(maxLines));

  if (lines.length <= normalizedMaxLines) {
    return lines;
  }

  if (normalizedMaxLines <= 0) {
    return [];
  }

  if (normalizedMaxLines === 1) {
    return [renderChoiceCardBoxLine(ansi.dim('…（已截断）'), innerWidth, theme)];
  }

  if (normalizedMaxLines === 2) {
    return [
      lines[1],
      renderChoiceCardBoxLine(ansi.dim('…（已截断）'), innerWidth, theme)
    ];
  }

  return [
    ...lines.slice(0, normalizedMaxLines - 1),
    renderChoiceCardBoxLine(ansi.dim('…（已截断）'), innerWidth, theme)
  ];
}

/**
 * 渲染 choice card 选项，并把内联输入光标映射到 footer 的绝对列。
 */
function renderChoiceCardOptionUnit(option: NonNullable<ChoiceCommandSurface['options']>[number], index: number, focusedIndex: number, selectionMode: NonNullable<ChoiceCommandSurface['selectionMode']>, innerWidth: number, theme: FooterTheme): ChoiceOptionRenderUnit {
  const focused = index === focusedIndex;
  const selected = selectionMode === 'multiple' ? option.checked === true : option.selected ?? focused;
  const contentWidth = Math.max(1, innerWidth - 2);
  const marker = selected ? '●' : '○';
  const optionLine = formatChoiceCardOptionLine(option, marker, Math.max(1, contentWidth - 3));
  const renderedOption = renderChoiceCardOptionLine(optionLine, focused, contentWidth, theme);
  const unit: ChoiceOptionRenderUnit = {lines: [renderChoiceCardBoxLine(renderedOption, innerWidth, theme)]};

  if (focused && option.inlineInput) {
    unit.cursorRow = 0;
    unit.cursorColumn = 3 + Math.min(displayWidth(` ${optionLine.plainBeforeCursor}`), Math.max(1, contentWidth - 1));
  }

  if (option.description) {
    const descriptionLines = wrapText(option.description, Math.max(1, contentWidth - 4), '    ');
    unit.lines.push(...descriptionLines.map((line) => renderChoiceCardBoxLine(tokenText(theme, 'muted', line), innerWidth, theme)));
  }

  return unit;
}

/**
 * 渲染可选 tab 导航条；tab 数量有限，受限高度时由 card 布局优先保留该行。
 */
function renderChoiceCardTabs(tabs: ChoiceCommandSurfaceTab[] | undefined, activeTabIndex: number | undefined, innerWidth: number, theme: FooterTheme): string[] {
  if (!tabs || tabs.length === 0) {
    return [];
  }

  const activeIndex = clampIndex(Number.isInteger(activeTabIndex) ? Number(activeTabIndex) : 0, tabs.length);
  const contentWidth = Math.max(1, innerWidth - 2);
  const tabWidth = Math.max(3, Math.floor((contentWidth - Math.max(0, tabs.length - 1)) / tabs.length));
  const labelWidth = Math.max(1, tabWidth - 4);
  const parts = tabs.map((tab, index) => {
    const marker = getChoiceTabMarker(tab.status);
    const plain = `[${marker ? `${marker} ` : ''}${clampPlainText(tab.label, labelWidth)}]`;
    return index === activeIndex
      ? activeBackground(theme, tokenText(theme, 'accentStrong', ansi.bold(plain)))
      : tokenText(theme, tab.status === 'missing' || tab.status === 'blocked' ? 'warning' : 'muted', plain);
  });
  const rendered = parts.join(' ');

  return [renderChoiceCardBoxLine(rendered, innerWidth, theme)];
}

/**
 * 将调用方提供的 tab 状态转为紧凑且可读的状态标记。
 */
function getChoiceTabMarker(status: ChoiceCommandSurfaceTab['status']): string {
  if (status === 'complete') {
    return '✓';
  }

  if (status === 'missing' || status === 'blocked') {
    return '!';
  }

  return '';
}

/**
 * 格式化 option 的纯文本模型；该模型同时服务 ANSI 渲染和光标宽度计算。
 */
function formatChoiceCardOptionLine(option: {label?: string; inlineInput?: {placeholder?: string; text?: string; cursor?: number}}, marker: string, width: number): ChoiceOptionLine {
  const labelText = `${marker} ${option.label}`;

  if (!option.inlineInput) {
    const plain = clampPlainText(labelText, width);

    return {
      hasInlineInput: false,
      labelText: plain,
      inputText: '',
      inputIsPlaceholder: false,
      plain,
      plainBeforeCursor: plain
    };
  }

  const inputText = option.inlineInput.text || '';
  const placeholder = option.inlineInput.placeholder || '';
  const visibleInput = inputText === '' ? placeholder : inputText;
  const inputBudget = width - displayWidth(`${labelText} `);
  const cursor = Math.min(Math.max(0, option.inlineInput.cursor || 0), Array.from(inputText).length);

  if (inputBudget <= 0) {
    const plain = clampPlainText(labelText, width);

    return {
      hasInlineInput: true,
      labelText: plain,
      inputText: '',
      inputIsPlaceholder: false,
      plain,
      plainBeforeCursor: plain
    };
  }

  const inputViewport = formatInlineInputViewport(visibleInput, inputText === '' ? 0 : cursor, inputBudget);
  const plain = `${labelText} ${inputViewport.text}`;

  return {
    hasInlineInput: true,
    labelText,
    inputText: inputViewport.text,
    inputIsPlaceholder: inputText === '',
    plain,
    plainBeforeCursor: `${labelText} ${inputViewport.beforeCursor}`
  };
}

/**
 * 为单行内联输入生成跟随光标的视窗；长文本裁剪时优先保留光标附近内容。
 */
function formatInlineInputViewport(text: string, cursor: number, width: number): InlineInputViewport {
  const safeWidth = Math.max(1, safeRenderWidth(width));

  if (displayWidth(text) <= safeWidth) {
    return {
      text,
      beforeCursor: Array.from(text).slice(0, cursor).join('')
    };
  }

  const chars = Array.from(text);
  let start = 0;
  let beforeCursor = chars.slice(start, cursor).join('');
  const beforeBudget = cursor < chars.length ? Math.max(1, Math.floor(safeWidth / 2)) : safeWidth;

  while (start < cursor && displayWidth(`…${beforeCursor}`) > beforeBudget) {
    start += 1;
    beforeCursor = chars.slice(start, cursor).join('');
  }

  const leading = start > 0 ? '…' : '';
  let visible = `${leading}${beforeCursor}`;
  let index = cursor;

  while (index < chars.length && displayWidth(`${visible}${chars[index]}`) <= safeWidth) {
    visible += chars[index];
    index += 1;
  }

  if (index < chars.length) {
    visible = appendTrailingEllipsis(visible, safeWidth);
  }

  return {
    text: visible,
    beforeCursor: `${leading}${beforeCursor}`
  };
}

/**
 * 在不超过宽度的前提下追加尾部省略号，必要时移除最后一个可见字符。
 */
function appendTrailingEllipsis(text: string, width: number): string {
  const ellipsis = '…';
  let next = text;

  while (next !== '' && displayWidth(`${next}${ellipsis}`) > width) {
    next = Array.from(next).slice(0, -1).join('');
  }

  return `${next}${ellipsis}`;
}

/**
 * 投影 option 的焦点与非焦点样式；普通焦点项铺满整行背景，内联输入项保留输入区原样。
 */
function renderChoiceCardOptionLine(optionLine: ChoiceOptionLine, focused: boolean, contentWidth: number, theme: FooterTheme): string {
  if (focused) {
    const accent = renderFocusBar(theme);

    if (!optionLine.hasInlineInput) {
      const rowWidth = Math.max(1, contentWidth - displayWidth(accent));
      const label = tokenText(theme, 'accentStrong', ansi.bold(optionLine.labelText));
      return `${accent}${activeBackground(theme, padVisibleText(` ${label}`, rowWidth))}`;
    }

    // 内联输入属于用户正在编辑的区域，不能被选中背景吞掉光标附近文本。
    const activeLabel = activeBackground(theme, tokenText(theme, 'accentStrong', ` ${ansi.bold(optionLine.labelText)} `));
    const inputText = optionLine.inputText ? (optionLine.inputIsPlaceholder ? tokenText(theme, 'muted', optionLine.inputText) : tokenText(theme, 'white', optionLine.inputText)) : '';
    return `${accent}${activeLabel}${inputText}`;
  }

  const renderedPlain = optionLine.inputText
    ? `${tokenText(theme, 'white', optionLine.labelText)} ${optionLine.inputIsPlaceholder ? tokenText(theme, 'muted', optionLine.inputText) : tokenText(theme, 'white', optionLine.inputText)}`
    : tokenText(theme, 'white', optionLine.plain);
  return `  ${renderedPlain}`;
}

/**
 * 渲染 card 分区标题线；宽度由调用方控制以匹配面板内部宽度。
 */
function renderChoiceCardSectionRule(label: string, width: number, theme: FooterTheme): string {
  const prefix = `── ${label} `;
  const rule = '─'.repeat(Math.max(0, width - displayWidth(prefix)));
  return `${tokenText(theme, 'accentStrong', prefix)}${tokenText(theme, 'frame', rule)}`;
}

/**
 * 渲染 card 顶部边框和标题；标题过长时截断以避开终端自动换行。
 */
function renderChoiceCardBorderTop(title: string, innerWidth: number, theme: FooterTheme): string {
  const titleText = ` ${clampPlainText(title, Math.max(1, innerWidth - 2))} `;
  const railWidth = Math.max(0, innerWidth - displayWidth(titleText));
  const tag = tokenText(theme, 'warning', ansi.bold(titleText));
  return `${tokenText(theme, 'frame', '╭')}${tag}${tokenText(theme, 'frame', '─'.repeat(railWidth))}${tokenText(theme, 'frame', '╮')}`;
}

/**
 * 渲染 card 底部边框；使用实色边框以匹配其他 command surface。
 */
function renderChoiceCardBorderBottom(innerWidth: number, theme: FooterTheme): string {
  return tokenText(theme, 'frame', `╰${'─'.repeat(innerWidth)}╯`);
}

/**
 * 渲染 card 内容行；按可见宽度补齐，保证右边框稳定对齐。
 */
function renderChoiceCardBoxLine(content: string, innerWidth: number, theme: FooterTheme): string {
  const contentWidth = Math.max(1, innerWidth - 2);
  const body = padVisibleText(content, contentWidth);
  const bar = tokenText(theme, 'frame', '│');
  return `${bar} ${body} ${bar}`;
}

/**
 * 根据当前焦点项创建可见 option 窗口；窗口化只裁剪显示，不改变原始选项顺序。
 */
function createVisibleOptionWindow(units: ChoiceOptionRenderUnit[], focusedIndex: number, maxLines: number): ChoiceOptionRenderUnit[] {
  const normalizedMaxLines = Math.max(0, Math.floor(maxLines));

  if (normalizedMaxLines <= 0 || units.length === 0) {
    return [];
  }

  const focused = clampIndex(focusedIndex, units.length);
  const focusedUnit = cropOptionUnit(units[focused], normalizedMaxLines);
  const visible: ChoiceOptionRenderUnit[] = [focusedUnit];
  let usedLines = focusedUnit.lines.length;
  let before = focused - 1;
  let after = focused + 1;

  while ((before >= 0 || after < units.length) && usedLines < normalizedMaxLines) {
    if (before >= 0) {
      const unit = units[before];

      if (usedLines + unit.lines.length <= normalizedMaxLines) {
        visible.unshift(unit);
        usedLines += unit.lines.length;
      }

      before -= 1;
    }

    if (after < units.length && usedLines < normalizedMaxLines) {
      const unit = units[after];

      if (usedLines + unit.lines.length <= normalizedMaxLines) {
        visible.push(unit);
        usedLines += unit.lines.length;
      }

      after += 1;
    }
  }

  return visible;
}

/**
 * 裁剪单个 option 渲染单元，并把内联输入光标限制在裁剪后的可见行内。
 */
function cropOptionUnit(unit: ChoiceOptionRenderUnit, maxLines: number): ChoiceOptionRenderUnit {
  if (unit.lines.length <= maxLines) {
    return unit;
  }

  return {
    ...unit,
    lines: unit.lines.slice(0, Math.max(1, maxLines)),
    cursorRow: typeof unit.cursorRow === 'number' ? clampCursorRow(unit.cursorRow, maxLines) : undefined
  };
}

/**
 * 计算 card 宽度；在终端安全宽度内尽量容纳 message、选项和操作提示。
 */
function calculateChoiceCardBoxWidth(commandSurface: ChoiceCommandSurface, width: number): number {
  const safeWidth = safeRenderWidth(width);
  const hint = commandSurface.dismissHint;
  const contentWidths = [
    displayWidth(` ${commandSurface.title} `),
    ...(commandSurface.tabs || []).map((tab) => displayWidth(`[${getChoiceTabMarker(tab.status)} ${tab.label}]`)),
    commandSurface.message && commandSurface.messageTitle ? displayWidth(`── ${commandSurface.messageTitle} `) : 0,
    displayWidth(`── ${commandSurface.optionsTitle || '操作'} `),
    commandSurface.message ? displayWidth(commandSurface.message) + 4 : 0,
    displayWidth(hint),
    ...commandSurface.options.flatMap((option) => [
      displayWidth(`● ${option.label}`),
      option.inlineInput ? displayWidth(`● ${option.label} ${option.inlineInput.text || option.inlineInput.placeholder}`) : 0,
      option.description ? displayWidth(`    ${option.description}`) : 0
    ])
  ];
  const desiredWidth = Math.max(CHOICE_CARD_MIN_WIDTH, Math.max(...contentWidths) + 8);
  return Math.min(safeWidth, CHOICE_CARD_MAX_WIDTH, desiredWidth);
}

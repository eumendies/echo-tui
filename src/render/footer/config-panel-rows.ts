import * as ansi from '../../terminal/ansi';
import {displayWidth} from '../layout';
import {activeBackground, renderFocusBar, tokenText, type FooterTheme} from '../colors';
import {clampPlainText, padVisibleText} from './text';

/**
 * 配置类面板（/config、/mcp）共用的边框与行原语：两边共享同一套外框、双列、动作行与选中态渲染，
 * 避免两处各写一份导致视觉风格漂移。
 */
function contentWidth(width: number): number {
  return Math.max(0, width - 4);
}

function activeBodyWidth(inner: number, active: boolean): number {
  return Math.max(0, inner - (active ? 1 : 0));
}

function renderSelectableBody(inner: number, body: string, active: boolean, theme: FooterTheme): string {
  if (!active) {
    return body;
  }

  return `${renderFocusBar(theme)}${activeBackground(theme, padVisibleText(body, activeBodyWidth(inner, true)))}`;
}

function clampInnerText(text: string, width: number): string {
  return clampPlainText(text, width + 1);
}

/** 开关状态圆点：绿色实心为开启，暗色空心为停用（与 /skills、/config 的标记一致）。 */
function renderDot(enabled: boolean, theme: FooterTheme): string {
  return enabled ? tokenText(theme, 'success', '●') : tokenText(theme, 'muted', '○');
}

function kvRow(width: number, key: string, rawValue: string, active: boolean, theme: FooterTheme): string {
  return splitRow(width, key, rawValue || '未设置', active, theme);
}

/**
 * 渲染左右两列设置行；优先保留完整标签和列间隔，长值使用剩余宽度安全截断。
 */
function splitRow(width: number, leftText: string, rightText: string, active: boolean, theme: FooterTheme): string {
  const inner = contentWidth(width);
  const bodyWidth = activeBodyWidth(inner, active);
  const prefix = active ? ' ' : '  ';
  const leftNaturalWidth = Math.min(displayWidth(prefix) + displayWidth(leftText), bodyWidth);
  // 标签和值始终留出可辨识的列间隔，避免长值占满时与标签粘连。
  const columnGap = Math.min(2, Math.max(0, bodyWidth - leftNaturalWidth));
  const rightWidth = Math.min(displayWidth(rightText), Math.max(0, bodyWidth - leftNaturalWidth - columnGap));
  const leftWidth = Math.max(0, bodyWidth - rightWidth);
  // 必须先截断纯文本再着色；否则 ANSI 转义字节会被逐字符截断逻辑误算，造成右列提前结束。
  const visibleLeftText = clampInnerText(leftText, Math.max(0, leftWidth - displayWidth(prefix)));
  const left = `${prefix}${tokenText(theme, active ? 'accentStrong' : 'accent', active ? ansi.bold(visibleLeftText) : visibleLeftText)}`;
  const right = tokenText(theme, active ? 'accentStrong' : 'accent', clampInnerText(rightText, rightWidth));
  const body = `${padVisibleText(left, leftWidth)}${padVisibleText(right, rightWidth)}`;
  return line(width, renderSelectableBody(inner, body, active, theme), theme);
}

function actionRow(width: number, labelText: string, hint: string, active: boolean, danger: boolean, theme: FooterTheme): string {
  const inner = contentWidth(width);
  const bodyWidth = activeBodyWidth(inner, active);
  const prefix = active ? ' ' : '  ';
  const rightWidth = Math.min(displayWidth(hint), Math.max(0, Math.floor(bodyWidth * 0.45)));
  const leftWidth = Math.max(1, bodyWidth - rightWidth);
  const labelTextVisible = clampInnerText(labelText, Math.max(1, leftWidth - 2));
  const token = danger ? 'danger' : active ? 'success' : 'accent';
  const label = tokenText(theme, token, active ? ansi.bold(labelTextVisible) : labelTextVisible);
  const left = `${prefix}${label}`;
  const right = rightWidth > 0 ? ansi.dim(clampInnerText(hint, rightWidth)) : '';
  const body = `${padVisibleText(left, leftWidth)}${padVisibleText(right, rightWidth)}`;
  return line(width, renderSelectableBody(inner, body, active, theme), theme);
}

function dimHint(width: number, text: string): string {
  return ansi.dim(clampInnerText(text, contentWidth(width)));
}

function sectionLine(width: number, text: string, theme: FooterTheme): string {
  const label = tokenText(theme, 'accentDeep', ansi.bold(text));
  const rail = tokenText(theme, 'accentDeep', '─'.repeat(Math.max(0, contentWidth(width) - displayWidth(label) - 1)));
  return line(width, `${label} ${rail}`, theme);
}

function top(width: number, title: string, token: keyof FooterTheme['colors'], theme: FooterTheme, right = ''): string {
  const inner = Math.max(0, width - 2);
  const suffix = right && displayWidth(` ${right} `) < inner ? ` ${right} ` : '';
  const titleWidth = Math.max(0, inner - displayWidth(suffix));
  const tag = titleWidth > 0 ? tokenText(theme, token, ansi.bold(clampPlainText(title, titleWidth))) : '';
  const rail = tokenText(theme, 'accentDeep', '─'.repeat(Math.max(0, inner - displayWidth(tag) - displayWidth(suffix))));
  return `${tokenText(theme, 'accentDeep', '╭')}${tag}${rail}${suffix}${tokenText(theme, 'accentDeep', '╮')}`;
}

function bottom(width: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '╰')}${tokenText(theme, 'accentDeep', '─'.repeat(Math.max(0, width - 2)))}${tokenText(theme, 'accentDeep', '╯')}`;
}

function line(width: number, content: string, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '│')} ${padVisibleText(content, contentWidth(width))} ${tokenText(theme, 'accentDeep', '│')}`;
}

function moreRow(width: number, direction: 'up' | 'down', count: number, theme: FooterTheme): string {
  return line(width, `  ${ansi.dim(`${direction === 'up' ? '↑' : '↓'} ${count} 更多`)}`, theme);
}

function calculateItemBudget(maxLines: number | undefined, fixedLines: number): number {
  if (!Number.isFinite(maxLines)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, Math.floor(Number(maxLines)) - fixedLines);
}

/** 行内编辑缓冲：统一用 █ 作为块光标；密钥类字段按缓冲长度显示 • 掩码。 */
function editingText(buffer: string, masked = false): string {
  return `${masked ? '•'.repeat(Array.from(buffer).length) : buffer}█`;
}

export {
  actionRow,
  activeBodyWidth,
  bottom,
  calculateItemBudget,
  clampInnerText,
  contentWidth,
  dimHint,
  editingText,
  kvRow,
  line,
  moreRow,
  renderDot,
  renderSelectableBody,
  sectionLine,
  splitRow,
  top
};

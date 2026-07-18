const ESC = '\x1b[';

// 这里集中放 ANSI 控制序列，避免业务代码里散落裸 escape code。
/**
 * 生成光标上移控制序列。
 *
 * @param {number} [count=1]
 * @returns {string}
 */
export function cursorUp(count = 1): string {
  return count > 0 ? `${ESC}${count}A` : '';
}

/**
 * 生成光标下移控制序列。
 *
 * @param {number} [count=1]
 * @returns {string}
 */
export function cursorDown(count = 1): string {
  return count > 0 ? `${ESC}${count}B` : '';
}

/**
 * 生成光标右移控制序列。
 *
 * @param {number} [count=1]
 * @returns {string}
 */
export function cursorForward(count = 1): string {
  return count > 0 ? `${ESC}${count}C` : '';
}

/**
 * 返回回车符，把光标移到当前行开头。
 *
 * @returns {string}
 */
export function carriageReturn(): string {
  return '\r';
}

/**
 * 把光标移动到屏幕左上角。
 *
 * @returns {string}
 */
export function cursorHome(): string {
  return `${ESC}H`;
}

/**
 * 清理当前整行内容，不影响其他行或 scrollback。
 *
 * @returns {string}
 */
export function clearLine(): string {
  // 2K 只清理当前行，不会清空整个屏幕或 scrollback。
  return `${ESC}2K`;
}

/**
 * 清理当前可见屏幕内容。
 *
 * @returns {string}
 */
export function clearVisibleScreen(): string {
  return `${ESC}2J`;
}

/**
 * 清理终端 scrollback 历史；兼容性依赖具体终端实现。
 *
 * @returns {string}
 */
export function clearScrollback(): string {
  return `${ESC}3J`;
}

/**
 * 重置滚动区域到整屏，避免 destructive repaint 受先前滚动边界影响。
 *
 * @returns {string}
 */
export function resetScrollRegion(): string {
  return `${ESC}r`;
}

/**
 * 启用 bracketed paste，让粘贴内容带边界序列，避免多行粘贴中的换行被误判为 Enter。
 *
 * @returns {string}
 */
export function enableBracketedPaste(): string {
  return `${ESC}?2004h`;
}

/**
 * 关闭 bracketed paste，避免应用退出后影响用户 shell。
 *
 * @returns {string}
 */
export function disableBracketedPaste(): string {
  return `${ESC}?2004l`;
}

/**
 * 隐藏终端光标。
 *
 * @returns {string}
 */
export function hideCursor(): string {
  return `${ESC}?25l`;
}

/**
 * 显示终端光标。
 *
 * @returns {string}
 */
export function showCursor(): string {
  return `${ESC}?25h`;
}

/**
 * 给文本加粗显示。
 *
 * @param {string} text
 * @returns {string}
 */
export function bold(text: string): string {
  return `${ESC}1m${text}${ESC}22m`;
}

/**
 * 给文本应用 dim 样式。
 *
 * @param {string} text
 * @returns {string}
 */
export function dim(text: string): string {
  return `${ESC}2m${text}${ESC}22m`;
}

/**
 * 给文本应用反色样式。
 *
 * @param {string} text
 * @returns {string}
 */
export function inverse(text: string): string {
  return `${ESC}7m${text}${ESC}27m`;
}

/**
 * 给文本应用删除线；不支持该样式的终端会保留原始文本内容。
 */
export function strikethrough(text: string): string {
  return `${ESC}9m${text}${ESC}29m`;
}

/**
 * 用指定前景色代码包裹文本。
 *
 * @param {number | string} code
 * @param {string} text
 * @returns {string}
 */
export function foreground(code: number | string, text: string): string {
  return `${ESC}${code}m${text}${ESC}39m`;
}

/**
 * 使用 24-bit RGB 前景色包裹文本，用于需要细腻色阶的局部控件。
 */
export function rgb(r: number, g: number, b: number, text: string): string {
  return `${ESC}38;2;${r};${g};${b}m${text}${ESC}39m`;
}

/**
 * 用 256 色背景包裹文本，用于比标准 ANSI 背景更柔和的局部高亮。
 */
export function background256(code: number, text: string): string {
  return `${ESC}48;5;${code}m${text}${ESC}49m`;
}

/**
 * 用 24-bit RGB 背景色包裹文本，用于需要贴近设计稿色值的局部高亮。
 */
export function backgroundRgb(r: number, g: number, b: number, text: string): string {
  return `${ESC}48;2;${r};${g};${b}m${text}${ESC}49m`;
}

/**
 * 用 256 色背景和显式前景色包裹文本，避免终端主题把高亮内容调成暗字。
 */
export function background256WithForeground(backgroundCode: number, foregroundCode: number, text: string): string {
  return `${ESC}${foregroundCode}m${background256(backgroundCode, text)}${ESC}39m`;
}

/** @param {string} text @returns {string} */
export function cyan(text: string): string {
  return foreground(36, text);
}

/** @param {string} text @returns {string} */
export function white(text: string): string {
  return foreground(37, text);
}

/**
 * 给文本加红色背景，用于删除内容高亮。
 *
 * @param {string} text
 * @returns {string}
 */
export function bgRed(text: string): string {
  return background256WithForeground(52, 97, text);
}

/**
 * 给文本加绿色背景，用于新增内容高亮。
 *
 * @param {string} text
 * @returns {string}
 */
export function bgGreen(text: string): string {
  return background256WithForeground(22, 97, text);
}

/**
 * 重置终端样式到默认状态。
 *
 * @returns {string}
 */
export function reset(): string {
  return `${ESC}0m`;
}

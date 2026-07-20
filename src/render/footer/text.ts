import { charWidth, displayWidth, safeRenderWidth, splitGraphemes } from '../layout';

/**
 * 将 select 或 slash suggestion 的 label 和 description 压成单行展示文本。
 */
export function formatSelectOptionText(label: string, description: string | undefined): string {
  if (!description) {
    return label;
  }

  return `${label} — ${description}`;
}

/**
 * 将普通文本截断到安全显示宽度，避免 footer 写满终端最后一列。
 */
export function clampPlainText(text: string, width: number): string {
  const safeWidth = Math.max(1, safeRenderWidth(width));
  const ellipsis = '…';
  const contentWidth = Math.max(0, safeWidth - charWidth(ellipsis));
  let result = '';
  let column = 0;

  if (displayWidth(text) <= safeWidth) {
    return text;
  }

  for (const char of splitGraphemes(text)) {
    const nextColumn = column + charWidth(char);

    if (nextColumn > contentWidth) {
      return `${result}${ellipsis}`;
    }

    result += char;
    column = nextColumn;
  }

  return result;
}

/**
 * 按显示宽度补齐文本；调用方可先给文本加样式，宽度计算会忽略 ANSI 序列。
 */
export function padVisibleText(text: string, width: number): string {
  return `${text}${' '.repeat(Math.max(0, width - displayWidth(text)))}`;
}

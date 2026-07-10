import * as ansi from '../terminal/ansi';
import {DEFAULT_TUI_THEME, type BlocksTheme, type FooterTheme, type MarkdownTheme, type RgbColor, type ThemeColor, type ThemeTextStyle, type TuiTheme} from '../config/theme-config';

export type {BlocksTheme, FooterTheme, MarkdownTheme, RgbColor, ThemeColor, ThemeTextStyle, TuiTheme};

/**
 * 返回完整 TUI theme 中的 footer theme，直接调用 footer surface 时使用默认值兜底。
 */
export function resolveFooterTheme(theme: TuiTheme | undefined): FooterTheme {
  return theme?.footer || DEFAULT_TUI_THEME.footer;
}

/**
 * 用指定 theme color 渲染前景色，支持 RGB 和 256 色两种格式。
 */
export function colorText(color: ThemeColor, text: string): string {
  if (color.kind === 'ansi256') {
    return ansi.foreground(`38;5;${color.ansi256}`, text);
  }

  return ansi.rgb(color.value[0], color.value[1], color.value[2], text);
}

/**
 * 兼容需要直接传 RGB 色阶的局部动效。
 */
export function rgbText(color: RgbColor, text: string): string {
  return ansi.rgb(color[0], color[1], color[2], text);
}

/**
 * 用 theme color 渲染背景色。
 */
export function colorBackground(color: ThemeColor, text: string): string {
  if (color.kind === 'ansi256') {
    return ansi.background256(color.ansi256, text);
  }

  return ansi.backgroundRgb(color.value[0], color.value[1], color.value[2], text);
}

/**
 * 应用 theme text style，统一处理前景、背景、dim、bold 和 inverse。
 */
export function styleText(style: ThemeTextStyle, text: string): string {
  let rendered = text;

  if (style.background) {
    rendered = colorBackground(style.background, rendered);
  }
  if (style.foreground) {
    rendered = colorText(style.foreground, rendered);
  }
  if (style.dim) {
    rendered = ansi.dim(rendered);
  }
  if (style.bold) {
    rendered = ansi.bold(rendered);
  }
  if (style.inverse) {
    rendered = ansi.inverse(rendered);
  }

  return rendered;
}

/**
 * 用 footer semantic token 渲染前景色。
 */
export function tokenText(theme: FooterTheme, token: keyof FooterTheme['colors'], text: string): string {
  return colorText(theme.colors[token], text);
}

/**
 * 用统一 active 背景包裹行内容，供不同 command surface 复用。
 */
export function activeBackground(theme: FooterTheme, text: string): string {
  return colorBackground(theme.colors.selectionBackground, text);
}

/**
 * 用统一 code-like 背景包裹内容。
 */
export function codeBackground(theme: FooterTheme, text: string): string {
  return colorText(theme.colors.codeForeground, colorBackground(theme.colors.codeBackground, text));
}

/**
 * 渲染 footer 内统一的焦点条，表示当前键盘焦点所在行。
 */
export function renderFocusBar(theme: FooterTheme): string {
  return tokenText(theme, 'accent', theme.focusBar);
}

/**
 * 用 blocks semantic token 渲染前景色。
 */
export function blockText(theme: TuiTheme, token: keyof BlocksTheme['colors'], text: string): string {
  return colorText(theme.blocks.colors[token], text);
}

/**
 * 用 blocks semantic token 渲染背景色。
 */
export function blockBackground(theme: TuiTheme, token: keyof BlocksTheme['colors'], text: string): string {
  return colorBackground(theme.blocks.colors[token], text);
}

/**
 * 用 Markdown semantic style 渲染文本。
 */
export function markdownStyle(theme: TuiTheme, token: keyof MarkdownTheme['styles'], text: string): string {
  return styleText(theme.markdown.styles[token], text);
}

/**
 * 在两个 RGB 端点之间线性插值，用于 footer 渐变线和轨道。
 */
export function mixRgb(left: RgbColor, right: RgbColor, ratio: number): [number, number, number] {
  const clamped = Math.min(Math.max(ratio, 0), 1);
  return [
    Math.round(left[0] + (right[0] - left[0]) * clamped),
    Math.round(left[1] + (right[1] - left[1]) * clamped),
    Math.round(left[2] + (right[2] - left[2]) * clamped)
  ];
}

/**
 * 把 theme color 转成 RGB，供渐变控件在用户配置 256 色时也能稳定渲染。
 */
export function colorToRgb(color: ThemeColor): RgbColor {
  if (color.kind === 'rgb') {
    return color.value;
  }

  return ansi256ToRgb(color.ansi256);
}

function ansi256ToRgb(code: number): RgbColor {
  if (code < 16) {
    const base: RgbColor[] = [
      [0, 0, 0],
      [128, 0, 0],
      [0, 128, 0],
      [128, 128, 0],
      [0, 0, 128],
      [128, 0, 128],
      [0, 128, 128],
      [192, 192, 192],
      [128, 128, 128],
      [255, 0, 0],
      [0, 255, 0],
      [255, 255, 0],
      [0, 0, 255],
      [255, 0, 255],
      [0, 255, 255],
      [255, 255, 255]
    ];
    return base[code] || [255, 255, 255];
  }

  if (code >= 232) {
    const value = 8 + (code - 232) * 10;
    return [value, value, value];
  }

  const normalized = code - 16;
  const red = Math.floor(normalized / 36);
  const green = Math.floor(normalized % 36 / 6);
  const blue = normalized % 6;
  const component = (value: number): number => value === 0 ? 0 : 55 + value * 40;

  return [component(red), component(green), component(blue)];
}

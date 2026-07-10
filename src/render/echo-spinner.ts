import {DEFAULT_TUI_THEME} from '../config/theme-config';
import { colorToRgb, mixRgb, rgbText, type FooterTheme } from './colors';

const ECHO_SPINNER_RAMP = ' ░▒▓█';

export const ECHO_SPINNER_FRAME_INTERVAL_MS = 100;

const ECHO_SPINNER_ACTIVE_FRAMES = [
  '   ▒█▒   ',
  '  ░█▒█░  ',
  ' ░▓▓░▓▓░ ',
  ' ▓▓░ ░▓▓ ',
  '▒█░   ░█▒',
  '█░     ░█',
  '▒       ▒',
  '░       ░'
] as const;

const ECHO_SPINNER_PAUSE_FRAMES = [
  '         ',
  '         ',
  '         ',
  '         '
] as const;

const ECHO_SPINNER_FRAMES = [...ECHO_SPINNER_ACTIVE_FRAMES, ...ECHO_SPINNER_PAUSE_FRAMES] as const;

export const ECHO_SPINNER_ACTIVE_FRAME_COUNT = ECHO_SPINNER_ACTIVE_FRAMES.length;

/**
 * 根据 elapsedMs 选择 echo 声场帧；帧表固定宽度，保证 footer 重绘时不横向抖动。
 */
export function getEchoSpinnerFrame(elapsedMs: number): string {
  return ECHO_SPINNER_FRAMES[getEchoSpinnerFrameIndex(elapsedMs)];
}

/**
 * 返回当前 echo spinner 在完整帧表中的索引，供关联动效复用同一个空帧节奏。
 */
export function getEchoSpinnerFrameIndex(elapsedMs: number): number {
  const safeElapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const frame = Math.floor(safeElapsed / ECHO_SPINNER_FRAME_INTERVAL_MS);
  return frame % ECHO_SPINNER_FRAMES.length;
}

/**
 * 渲染完整 echo spinner 帧；working 行等无需逐字符 shimmer 的场景可直接使用。
 */
export function renderEchoSpinnerFrame(elapsedMs: number, theme: FooterTheme = DEFAULT_TUI_THEME.footer): string {
  return Array.from(getEchoSpinnerFrame(elapsedMs)).map((char) => colorEchoSpinnerCell(char, theme)).join('');
}

/**
 * 按 cell 强弱映射到当前 footer accent 渐变；空白不着色，避免污染后续文本样式。
 */
function colorEchoSpinnerCell(char: string, theme: FooterTheme): string {
  if (char === ' ') {
    return char;
  }

  const rampIndex = ECHO_SPINNER_RAMP.indexOf(char);

  if (rampIndex < 0) {
    return char;
  }

  const loudness = rampIndex / (ECHO_SPINNER_RAMP.length - 1);
  const color = mixRgb(colorToRgb(theme.colors.accentDeep), colorToRgb(theme.colors.accentStrong), loudness);
  return rgbText(color, char);
}

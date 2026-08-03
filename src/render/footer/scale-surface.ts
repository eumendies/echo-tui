import * as ansi from '../../terminal/ansi';
import { displayWidth, safeRenderWidth } from '../layout';
import { colorText, colorToRgb, mixRgb, resolveFooterTheme, tokenText, type FooterTheme } from '../colors';
import { clampPlainText, padVisibleText } from './text';
import type { CommandSurfaceOption, ScaleCommandSurface } from '../../types/command';
import type { FooterLayout } from '../../types/render';

const SCALE_SURFACE_MIN_WIDTH = 42;
const SCALE_SURFACE_MAX_WIDTH = 84;
const SCALE_METER_WIDTH = 10;

/**
 * 渲染 scale 面板；用于有序强度选择，视觉上呈现为 rounded cyan slider。
 */
export function renderScaleSurface(commandSurface: ScaleCommandSurface, width: number, theme: FooterTheme = resolveFooterTheme(undefined)): FooterLayout {
  const options = commandSurface.options;
  const selectedIndex = Math.min(Math.max(commandSurface.selectedIndex, 0), Math.max(0, options.length - 1));
  const boxWidth = calculateScaleBoxWidth(commandSurface, width);
  const contentWidth = Math.max(1, boxWidth - 4);
  const trackWidth = Math.max(22, Math.min(60, contentWidth - 8));
  const positions = calculateScalePositions(options.length, trackWidth);
  const lines = [
    renderScaleBoxTop(boxWidth, theme),
    renderScaleBoxLine(ansi.bold(tokenText(theme, 'accentStrong', clampPlainText(commandSurface.title, contentWidth))), contentWidth, theme),
    renderScaleBoxLine('', contentWidth, theme),
    renderScaleBoxLine(renderScaleTrack(positions, selectedIndex, trackWidth, theme), contentWidth, theme),
    renderScaleBoxLine(renderScaleLabels(options, positions, selectedIndex, trackWidth, theme), contentWidth, theme),
    renderScaleBoxLine('', contentWidth, theme),
    renderScaleBoxLine(renderScaleMeter(options[selectedIndex]?.label || '', selectedIndex, options.length, theme), contentWidth, theme),
    renderScaleBoxLine(ansi.dim(clampPlainText(commandSurface.dismissHint, contentWidth)), contentWidth, theme),
    renderScaleBoxBottom(boxWidth, theme)
  ];

  return {
    lines,
    cursorRow: lines.length - 1,
    cursorColumn: 0,
    showCursor: false
  };
}

/**
 * 根据标题、标签和终端安全宽度计算 slider 外框宽度。
 */
function calculateScaleBoxWidth(commandSurface: ScaleCommandSurface, width: number): number {
  const safeWidth = safeRenderWidth(width);
  const labelWidth = commandSurface.options.reduce((sum, option) => sum + displayWidth(option.description || option.label) + 2, 0);
  const minContentWidth = Math.max(
    displayWidth(commandSurface.title),
    labelWidth,
    displayWidth(commandSurface.dismissHint),
    34
  ) + 6;
  const availableWidth = Math.max(SCALE_SURFACE_MIN_WIDTH, safeWidth - 8);

  return Math.min(safeWidth, SCALE_SURFACE_MAX_WIDTH, Math.max(SCALE_SURFACE_MIN_WIDTH, minContentWidth, availableWidth));
}

/**
 * 渲染 slider 轨道、方向箭头、档位点和当前 knob。
 */
function renderScaleTrack(positions: number[], selectedIndex: number, trackWidth: number, theme: FooterTheme): string {
  const knobColumn = positions[selectedIndex] || 0;
  const gradientStart = colorToRgb(theme.colors.accentDeep);
  const gradientEnd = colorToRgb(theme.colors.accentStrong);
  const chars = Array.from({length: trackWidth}, (_value, index) => {
    const t = index / Math.max(1, trackWidth - 1);
    const color = mixRgb(gradientStart, gradientEnd, t);
    const optionIndex = positions.indexOf(index);

    if (index === knobColumn) {
      return ansi.bold(tokenText(theme, 'accentStrong', '◉'));
    }

    if (optionIndex >= 0) {
      return index < knobColumn ? colorText({kind: 'rgb', value: color}, '●') : tokenText(theme, 'railOff', '●');
    }

    return index < knobColumn ? colorText({kind: 'rgb', value: color}, '━') : ansi.dim(tokenText(theme, 'railOff', '─'));
  });

  return `  ${tokenText(theme, 'accent', '◂')} ${chars.join('')} ${tokenText(theme, 'accent', '▸')}`;
}

/**
 * 将档位短标签对齐到 slider 轨道位置，并高亮当前档位。
 */
function renderScaleLabels(options: CommandSurfaceOption[], positions: number[], selectedIndex: number, trackWidth: number, theme: FooterTheme): string {
  const cells = Array.from({length: trackWidth}, () => ' ');
  const activeCells = new Set<number>();

  options.forEach((option, index) => {
    const label = (option.description || option.label).slice(0, 8);
    const start = Math.min(Math.max(0, (positions[index] || 0) - Math.floor(displayWidth(label) / 2)), Math.max(0, trackWidth - displayWidth(label)));
    const active = index === selectedIndex;

    Array.from(label).forEach((char, offset) => {
      const cellIndex = start + offset;
      cells[cellIndex] = char;

      if (active) {
        activeCells.add(cellIndex);
      }
    });
  });

  const rendered = cells.map((char, index) => activeCells.has(index) ? ansi.bold(tokenText(theme, 'white', char)) : ansi.dim(char)).join('');
  return `    ${rendered}`;
}

/**
 * 渲染当前真实 value、进度 meter 和 active 状态。
 */
function renderScaleMeter(value: string, selectedIndex: number, optionCount: number, theme: FooterTheme): string {
  const filledCount = Math.round((selectedIndex / Math.max(1, optionCount - 1)) * SCALE_METER_WIDTH);
  const meter = `${tokenText(theme, 'accent', '█'.repeat(filledCount))}${ansi.dim('░'.repeat(SCALE_METER_WIDTH - filledCount))}`;
  const label = tokenText(theme, 'accentStrong', ansi.bold(value.padEnd(7, ' ')));
  return `  ${label} ${meter} ${ansi.dim('已选择')}`;
}

/**
 * 根据选项数量把档位均匀投影到轨道列。
 */
function calculateScalePositions(optionCount: number, trackWidth: number): number[] {
  if (optionCount <= 1) {
    return [Math.floor(trackWidth / 2)];
  }

  return Array.from({length: optionCount}, (_value, index) => Math.round(index * (trackWidth - 1) / (optionCount - 1)));
}

/**
 * 渲染 scale 面板顶部边框。
 */
function renderScaleBoxTop(width: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '╭')}${tokenText(theme, 'accentDeep', '─'.repeat(Math.max(0, width - 2)))}${tokenText(theme, 'accentDeep', '╮')}`;
}

/**
 * 渲染 scale 面板底部边框。
 */
function renderScaleBoxBottom(width: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '╰')}${tokenText(theme, 'accentDeep', '─'.repeat(Math.max(0, width - 2)))}${tokenText(theme, 'accentDeep', '╯')}`;
}

/**
 * 渲染 scale 面板内容行，按可见宽度补齐以保持右边框稳定。
 */
function renderScaleBoxLine(content: string, width: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '│')} ${padVisibleText(content, width)} ${tokenText(theme, 'accentDeep', '│')}`;
}

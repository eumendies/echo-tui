import * as ansi from '../terminal/ansi';
import { renderPendingAssistantLines } from './blocks';
import { renderCommandSurface } from './footer/command-surfaces';
import { renderComposerSurface } from './footer/composer-surface';
import { constrainLayoutTail } from './footer/window';
import { DEFAULT_RENDER_PREFERENCES } from '../config/app-settings-config';
import { DEFAULT_TUI_THEME } from '../config/theme-config';
import type { FooterLayout, FooterRenderer, PendingState, RenderState, StatusLineState, WorkingState } from '../types/render';

const FOOTER_TOP_PADDING_LINES = 2;
const DEFAULT_TERMINAL_ROWS = 24;
// composer 自带边框；这里保留语义空行，分隔 transcript 与输入区而不画额外实线。
const TRANSCRIPT_COMPOSER_SPACER_LINE = '';
const TRANSCRIPT_COMPOSER_SPACER_LINE_COUNT = 1;

/**
 * 创建独立 footer renderer，只负责 pending、composer、transcript/composer 间隔和 status line 的局部重绘。
 *
 */
export function createFooterRenderer(output: NodeJS.WriteStream = process.stdout): FooterRenderer {
  // footer 是唯一可重复重绘的临时区域；记录上一帧形状，才能只擦掉 footer。
  let previousHeight = 0;
  let previousCursorRow = 0;

  /**
   * 生成清掉上一帧 footer 的定位和擦除序列，不直接写终端，供 clear 与 render 组合完整输出帧。
   */
  function createClearPreviousSequence(): string {
    if (previousHeight === 0) {
      return '';
    }

    let sequence = '';
    // 当前光标位于上一次 composer 逻辑位置，先回到上一次 footer 顶部。
    sequence += ansi.cursorUp(previousCursorRow);
    sequence += ansi.carriageReturn();

    for (let index = 0; index < previousHeight; index += 1) {
      // 逐行清理 footer，不碰 footer 以上已经进入 scrollback 的历史输出。
      sequence += ansi.clearLine();
      if (index < previousHeight - 1) {
        sequence += ansi.cursorDown(1);
      }
    }

    sequence += ansi.cursorUp(previousHeight - 1);
    sequence += ansi.carriageReturn();
    return sequence;
  }

  /**
   * 移除当前临时 footer，为 transcript append 或退出让出干净的终端尾部。
   */
  function clear(): void {
    const clearSequence = createClearPreviousSequence();
    if (clearSequence !== '') {
      output.write(`${ansi.hideCursor()}${clearSequence}${ansi.showCursor()}`);
    }
    previousHeight = 0;
    previousCursorRow = 0;
  }

  /**
   * 渲染新的 footer 布局，并在完成后把光标放回 composer 的逻辑位置。
   *
   */
  function render(options: RenderState): void {
    const layout = renderFooterLayout(options);

    let sequence = ansi.hideCursor();
    sequence += createClearPreviousSequence();
    sequence += layout.lines.join('\n');
    sequence += ansi.cursorUp(layout.lines.length - 1 - layout.cursorRow);
    sequence += ansi.carriageReturn();
    sequence += ansi.cursorForward(layout.cursorColumn);

    if (layout.showCursor) {
      sequence += ansi.showCursor();
    }

    output.write(sequence);
    rememberLayout(layout);
  }

  /**
   * 在 footer 已经由其他路径完整绘制后，同步记录它的形状，供下一次局部清理使用。
   */
  function rememberLayout(layout: FooterLayout): void {
    previousHeight = layout.lines.length;
    previousCursorRow = layout.cursorRow;
  }

  return {
    clear,
    rememberLayout,
    render
  };
}

/**
 * 根据当前状态生成 footer 的逐行布局和光标坐标。
 *
 */
export function renderFooterLayout({ composer, conversationReference, commandSurface, slashSuggestions, pending, working, theme = DEFAULT_TUI_THEME, renderPreferences = DEFAULT_RENDER_PREFERENCES, statusLine, rows, width }: RenderState): FooterLayout {
  const footerWidth = width || 80;
  const maxFooterLines = calculateFooterMaxLines(rows);
  const transcriptComposerSpacerLine = TRANSCRIPT_COMPOSER_SPACER_LINE;
  const fixedLineCount = TRANSCRIPT_COMPOSER_SPACER_LINE_COUNT;
  const inputMaxLines = calculateCommandSurfaceMaxLines(rows);
  const effectiveStatusLine = attachStatusLineActivity(statusLine, pending, working);
  const inputSurface = commandSurface
    ? renderCommandSurface(commandSurface, footerWidth, {maxLines: inputMaxLines, theme})
    : renderComposerSurface(composer, effectiveStatusLine, footerWidth, slashSuggestions ?? null, inputMaxLines, theme, renderPreferences.slashSuggestionMaxVisible, conversationReference);
  const pendingMaxLines = Math.max(0, maxFooterLines - fixedLineCount - inputSurface.lines.length);
  const pendingLines = pending ? renderPendingAssistantLines(pending, footerWidth, pendingMaxLines, theme) : [];
  const layout = {
    lines: [...pendingLines, transcriptComposerSpacerLine, ...inputSurface.lines],
    cursorRow: pendingLines.length + 1 + inputSurface.cursorRow,
    cursorColumn: inputSurface.cursorColumn,
    showCursor: inputSurface.showCursor
  };

  return constrainLayoutTail(layout, maxFooterLines);
}

/**
 * 计算 command surface 可使用的 footer 行数；需扣除 transcript 与 composer 之间的固定空行。
 */
export function calculateCommandSurfaceMaxLines(rows: number | undefined): number {
  return Math.max(1, calculateFooterMaxLines(rows) - TRANSCRIPT_COMPOSER_SPACER_LINE_COUNT);
}

/**
 * 根据终端总行数计算 footer 可占用高度；顶部保留两行，避免局部 footer 写入 scrollback。
 */
function calculateFooterMaxLines(rows: number | undefined): number {
  const terminalRows = Number.isFinite(rows) ? Number(rows) : DEFAULT_TERMINAL_ROWS;
  return Math.max(1, Math.floor(terminalRows) - FOOTER_TOP_PADDING_LINES);
}

/**
 * 把响应中状态附加到 status line 的 mode 段，替代独立 thinking/working 行。
 */
function attachStatusLineActivity(statusLine: StatusLineState | undefined, pending: PendingState | null, working: WorkingState | null): StatusLineState | undefined {
  if (!statusLine) {
    return undefined;
  }

  if (working) {
    return {...statusLine, activity: {kind: 'working', elapsedMs: working.elapsedMs}};
  }

  if (pending?.kind === 'thinking') {
    return {...statusLine, activity: {kind: 'thinking', elapsedMs: pending.elapsedMs}};
  }

  return statusLine;
}

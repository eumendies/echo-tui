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
 * 管理 footer 临时区域的局部重绘，并记录上一帧的高度与光标位置。
 */
class DefaultFooterRenderer implements FooterRenderer {
  private readonly output: NodeJS.WriteStream;
  private previousHeight = 0;
  private previousCursorRow = 0;

  constructor(output: NodeJS.WriteStream = process.stdout) {
    this.output = output;
  }

  /** 生成清掉上一帧 footer 的定位和擦除序列，不直接写终端。 */
  private createClearPreviousSequence(): string {
    if (this.previousHeight === 0) {
      return '';
    }

    let sequence = '';
    // 当前光标位于上一次 composer 逻辑位置，先回到上一次 footer 顶部。
    sequence += ansi.cursorUp(this.previousCursorRow);
    sequence += ansi.carriageReturn();

    for (let index = 0; index < this.previousHeight; index += 1) {
      // 逐行清理 footer，不碰 footer 以上已经进入终端历史区的内容。
      sequence += ansi.clearLine();
      if (index < this.previousHeight - 1) {
        sequence += ansi.cursorDown(1);
      }
    }

    sequence += ansi.cursorUp(this.previousHeight - 1);
    sequence += ansi.carriageReturn();
    return sequence;
  }

  /** 移除当前临时 footer，为 transcript append 或退出让出干净的终端尾部。 */
  clear(): void {
    const clearSequence = this.createClearPreviousSequence();
    if (clearSequence !== '') {
      this.output.write(`${ansi.hideCursor()}${clearSequence}${ansi.showCursor()}`);
    }
    this.previousHeight = 0;
    this.previousCursorRow = 0;
  }

  /**
   * 在一个终端帧中移除旧 footer、追加稳定内容并恢复新 footer。
   * content 必须以换行结束，使新 footer 从追加内容后的下一行开始；该内容后续不再重绘。
   */
  append(content: string, options: RenderState): void {
    const layout = renderFooterLayout(options);

    let sequence = ansi.hideCursor();
    sequence += this.createClearPreviousSequence();
    sequence += content;
    sequence += layout.lines.join('\n');
    sequence += ansi.cursorUp(layout.lines.length - 1 - layout.cursorRow);
    sequence += ansi.carriageReturn();
    sequence += ansi.cursorForward(layout.cursorColumn);

    if (layout.showCursor) {
      sequence += ansi.showCursor();
    }

    this.output.write(sequence);
    this.rememberLayout(layout);
  }

  /** 渲染新的 footer 布局，并把光标放回 composer 的逻辑位置。 */
  render(options: RenderState): void {
    this.append('', options);
  }

  /** 在其他路径完整绘制 footer 后，同步记录其形状供下一次局部清理使用。 */
  rememberLayout(layout: FooterLayout): void {
    this.previousHeight = layout.lines.length;
    this.previousCursorRow = layout.cursorRow;
  }
}

/** 创建独立的 footer renderer 实例，保留现有调用入口。 */
export function createFooterRenderer(output: NodeJS.WriteStream = process.stdout): FooterRenderer {
  return new DefaultFooterRenderer(output);
}

/**
 * 根据当前状态生成 footer 的逐行布局和光标坐标。
 *
 */
export function renderFooterLayout({ composer, conversationReference, pendingMessage, commandSurface, slashSuggestions, pending, working, theme = DEFAULT_TUI_THEME, renderPreferences = DEFAULT_RENDER_PREFERENCES, statusLine, rows, width }: RenderState): FooterLayout {
  const footerWidth = width || 80;
  const maxFooterLines = calculateFooterMaxLines(rows);
  const transcriptComposerSpacerLine = TRANSCRIPT_COMPOSER_SPACER_LINE;
  const fixedLineCount = TRANSCRIPT_COMPOSER_SPACER_LINE_COUNT;
  const inputMaxLines = calculateCommandSurfaceMaxLines(rows);
  const effectiveStatusLine = attachStatusLineActivity(statusLine, pending, working);
  const inputSurface = commandSurface
    ? renderCommandSurface(commandSurface, footerWidth, {maxLines: inputMaxLines, theme})
    : renderComposerSurface(composer, effectiveStatusLine, footerWidth, slashSuggestions ?? null, inputMaxLines, theme, renderPreferences.slashSuggestionMaxVisible, conversationReference, pendingMessage);
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

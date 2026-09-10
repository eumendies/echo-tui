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
 * 管理 footer 临时区域的局部重绘，并记录上一帧行内容与光标位置；帧高由行数组长度推导。
 */
class DefaultFooterRenderer implements FooterRenderer {
  private readonly output: NodeJS.WriteStream;
  private previousCursorRow = 0;
  // 上一帧的最终行内容(经 constrainLayoutTail 之后)，供帧级增量重绘做行级 diff。
  private previousLines: string[] = [];
  private previousCursorColumn = 0;
  // 终端光标当前可见性；用于最小化 hide/show 序列，避免每次重绘重置光标闪烁相位。
  private cursorVisible = true;

  constructor(output: NodeJS.WriteStream = process.stdout) {
    this.output = output;
  }

  /** 生成清掉上一帧 footer 的定位和擦除序列，不直接写终端。 */
  private createClearPreviousSequence(): string {
    if (this.previousLines.length === 0) {
      return '';
    }

    let sequence = '';
    // 清理前先复位 SGR:上方 transcript 或上一帧可能遗留未复位的背景/属性,
    // 否则 clearLine 会按脏背景擦除(BCE)产生色块。
    sequence += ansi.reset();
    // 当前光标位于上一次 composer 逻辑位置，先回到上一次 footer 顶部。
    sequence += ansi.cursorUp(this.previousCursorRow);
    sequence += ansi.carriageReturn();

    for (let index = 0; index < this.previousLines.length; index += 1) {
      // 逐行清理 footer，不碰 footer 以上已经进入终端历史区的内容。
      sequence += ansi.clearLine();
      if (index < this.previousLines.length - 1) {
        sequence += ansi.cursorDown(1);
      }
    }

    sequence += ansi.cursorUp(this.previousLines.length - 1);
    sequence += ansi.carriageReturn();
    return sequence;
  }

  /** 移除当前临时 footer，为 transcript append 或退出让出干净的终端尾部。 */
  clear(): void {
    const clearSequence = this.createClearPreviousSequence();
    if (clearSequence !== '') {
      this.output.write(`${ansi.hideCursor()}${clearSequence}${ansi.showCursor()}`);
    }
    this.previousCursorRow = 0;
    this.previousLines = [];
    this.previousCursorColumn = 0;
    this.cursorVisible = true;
  }

  /**
   * 在一个终端帧中移除旧 footer、追加稳定内容并恢复新 footer。
   * content 必须以换行结束，使新 footer 从追加内容后的下一行开始；该内容后续不再重绘。
   */
  append(content: string, options: RenderState): void {
    const layout = renderFooterLayout(options);

    // 无 transcript 追加且已有上一帧时走帧级增量重绘；首帧与追加路径保持整帧重绘。
    if (content === '' && this.previousLines.length > 0 && layout.lines.length > 0) {
      this.appendIncrementally(layout);
      return;
    }

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

  /**
   * 帧级增量重绘：与上一帧逐行比较，未变行不触碰终端，变化行原位覆写(先写新内容再清行尾)，
   * 帧高变化只处理增量行(尾部追加或清理底部多余行)。全部序列合并为一次 write；
   * hide cursor 仅在整帧语义(帧高变化或多行变化)时输出，单行覆写不重置光标闪烁相位。
   */
  private appendIncrementally(layout: FooterLayout): void {
    const previousLines = this.previousLines;
    const previousHeight = previousLines.length;
    const nextLines = layout.lines;
    const nextHeight = nextLines.length;
    const commonHeight = Math.min(previousHeight, nextHeight);
    const changedRows: number[] = [];

    for (let index = 0; index < commonHeight; index += 1) {
      if (nextLines[index] !== previousLines[index]) {
        changedRows.push(index);
      }
    }

    const heightChanged = nextHeight !== previousHeight;

    if (!heightChanged && changedRows.length === 0) {
      // 帧内容完全一致：只按需移动光标(方向键移动、纯状态重定位)，不做任何行擦写。
      if (layout.cursorRow === this.previousCursorRow && layout.cursorColumn === this.previousCursorColumn && layout.showCursor === this.cursorVisible) {
        return;
      }

      let move = '';
      const rowDelta = layout.cursorRow - this.previousCursorRow;
      if (rowDelta > 0) {
        move += ansi.cursorDown(rowDelta);
      } else if (rowDelta < 0) {
        move += ansi.cursorUp(-rowDelta);
      }
      move += ansi.carriageReturn() + ansi.cursorForward(layout.cursorColumn);
      if (layout.showCursor !== this.cursorVisible) {
        move += layout.showCursor ? ansi.showCursor() : ansi.hideCursor();
      }

      this.output.write(move);
      this.rememberLayout(layout);
      return;
    }

    // 回到上一帧顶部，再逐行扫描：未变行仅光标下移，变化行原位覆写。
    let sequence = ansi.cursorUp(this.previousCursorRow) + ansi.carriageReturn();
    for (let index = 0; index < commonHeight; index += 1) {
      if (nextLines[index] !== previousLines[index]) {
        // 每行写入前复位 SGR,避免继承相邻行或上方内容遗留的背景/属性;
        // 否则行尾 EL 按脏背景擦除(BCE)会在行尾画出色块。
        sequence += ansi.reset() + ansi.carriageReturn() + nextLines[index] + ansi.clearEndOfLine();
      }
      if (index < commonHeight - 1) {
        sequence += ansi.cursorDown(1);
      }
    }

    if (nextHeight > previousHeight) {
      // 增高：用 LF 而非 cursorDown 逐行下移。帧底贴住屏幕最后一行时 cursorDown
      // 会被终端钳制，新行全部叠印在底行上，且光标收位落到帧外上方，后续增量
      // diff 全部错位；LF 在底行触发终端滚动腾出新行，与整帧路径 '\n' 连接的行为一致。
      for (let index = commonHeight; index < nextHeight; index += 1) {
        sequence += '\n' + ansi.reset() + nextLines[index];
      }
    } else if (nextHeight < previousHeight) {
      // 降低：只清理底部多出来的旧行，再把光标收回新帧底部。
      for (let index = nextHeight; index < previousHeight; index += 1) {
        sequence += ansi.cursorDown(1) + ansi.carriageReturn() + ansi.reset() + ansi.clearLine();
      }
      sequence += ansi.cursorUp(previousHeight - nextHeight);
    }

    // 此时光标位于新帧底部，再定位到目标 composer 光标位。
    sequence += ansi.cursorUp(nextHeight - 1 - layout.cursorRow) + ansi.carriageReturn() + ansi.cursorForward(layout.cursorColumn);

    if (heightChanged || changedRows.length > 1) {
      sequence = ansi.hideCursor() + sequence;
      if (layout.showCursor) {
        sequence += ansi.showCursor();
      }
    } else if (layout.showCursor !== this.cursorVisible) {
      sequence += layout.showCursor ? ansi.showCursor() : ansi.hideCursor();
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
    this.previousCursorRow = layout.cursorRow;
    this.previousLines = layout.lines.slice();
    this.previousCursorColumn = layout.cursorColumn;
    this.cursorVisible = layout.showCursor;
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

  if (pending?.kind === 'subagent') {
    return {...statusLine, activity: {kind: 'working', elapsedMs: pending.elapsedMs}};
  }

  if (working) {
    return {...statusLine, activity: {kind: 'working', elapsedMs: working.elapsedMs}};
  }

  if (pending?.kind === 'thinking') {
    return {...statusLine, activity: {kind: 'thinking', elapsedMs: pending.elapsedMs}};
  }

  return statusLine;
}

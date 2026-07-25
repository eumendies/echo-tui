import * as ansi from '../terminal/ansi';
import {DEFAULT_RENDER_PREFERENCES} from '../config/app-settings-config';
import {DEFAULT_TUI_THEME} from '../config/theme-config';
import { renderAssistantBlock, renderBanner, renderCompactionNoticeBlock, renderErrorBlock, renderLocalNoticeBlock, renderReasoningSummaryBlock, renderShellBlock, renderUserBlock } from './blocks';
import { createFooterRenderer, renderFooterLayout } from './footer';
import { renderToolPairBlock, renderToolRecordBlock } from './tool-message-renderer';
import type { ToolCallTranscriptRecord, ToolResultTranscriptRecord, TranscriptRecord, UserTranscriptRecord } from '../types/transcript';
import type {
  AppendRecordOptions,
  AppendRecordsOptions,
  AppRenderer,
  BannerContext,
  RenderDestructiveOptions,
  RenderFinalOptions,
  RenderInitialOptions,
  RenderState
} from '../types/render';

type TranscriptBlock =
  | { kind: 'record'; record: TranscriptRecord }
  | { kind: 'tool_pair'; call: ToolCallTranscriptRecord; result: ToolResultTranscriptRecord };

/**
 * 创建应用级 renderer 门面，统一编排 footer-only redraw、transcript append 和 destructive replay。
 *
 */
export function createAppRenderer(output: NodeJS.WriteStream = process.stdout): AppRenderer {
  const footer = createFooterRenderer(output);

  /**
   * 启动时先追加 banner，再绘制 footer；main 不需要自己拼接多种 renderer。
   *
   */
  function renderInitial({ bannerContext, composer, commandSurface, slashSuggestions, pending, working, theme, renderPreferences, statusLine, rows, width }: RenderInitialOptions): void {
    output.write(renderBanner(bannerContext, theme));
    footer.render({ composer, commandSurface, slashSuggestions, pending, working, theme, renderPreferences, statusLine, rows, width });
  }

  /**
   * 普通输入、spinner 和 pending 更新只重绘 footer 临时区域。
   *
   */
  function renderFooter(options: RenderState): void {
    footer.render(options);
  }

  /**
   * 移除当前 footer，供退出或其他需要清空临时区域的场景使用。
   */
  function clearFooter(): void {
    footer.clear();
  }

  /**
   * transcript 新增事实内容时，统一执行“清 footer → append block → 重绘 footer”。
   *
   */
  function appendRecord({ record, composer, commandSurface, slashSuggestions, pending, working, theme, renderPreferences, statusLine, rows, width }: AppendRecordOptions): void {
    appendRecords({ records: [record], composer, commandSurface, slashSuggestions, pending, working, theme, renderPreferences, statusLine, rows, width });
  }

  /**
   * transcript 成组新增事实内容时，一次性清 footer、append blocks、再重绘 footer。
   */
  function appendRecords({ records, composer, commandSurface, slashSuggestions, pending, working, theme, renderPreferences, statusLine, rows, width }: AppendRecordsOptions): void {
    const blocks = renderTranscriptBlocks(records, width, theme, renderPreferences);

    footer.clear();
    if (blocks.length > 0) {
      output.write(blocks.join(''));
    }
    footer.render({ composer, commandSurface, slashSuggestions, pending, working, theme, renderPreferences, statusLine, rows, width });
  }

  /**
   * 在 destructive recovery 中清屏并从左上角重放 banner、transcript 和 footer 的完整快照。
   *
   */
  function renderDestructive({ bannerContext, records, composer, commandSurface, slashSuggestions, pending, working, theme, renderPreferences, statusLine, rows, width }: RenderDestructiveOptions): void {
    const footerLayout = renderFooterLayout({ composer, commandSurface, slashSuggestions, pending, working, theme, renderPreferences, statusLine, rows, width });
    const bannerLines = splitRenderedBlock(renderBanner(bannerContext, theme));
    const transcriptLines = renderTranscriptLines(records, width, theme, renderPreferences);
    const lines = [...bannerLines, ...transcriptLines, ...footerLayout.lines];
    const cursorRow = bannerLines.length + transcriptLines.length + footerLayout.cursorRow;

    let sequence = ansi.hideCursor();
    sequence += ansi.resetScrollRegion();
    sequence += ansi.reset();
    sequence += ansi.cursorHome();
    sequence += ansi.clearVisibleScreen();
    sequence += ansi.clearScrollback();
    sequence += ansi.cursorHome();
    sequence += lines.join('\n');
    sequence += ansi.cursorUp(lines.length - 1 - cursorRow);
    sequence += ansi.carriageReturn();
    sequence += ansi.cursorForward(footerLayout.cursorColumn);

    if (footerLayout.showCursor) {
      sequence += ansi.showCursor();
    }

    output.write(sequence);

    footer.rememberLayout(footerLayout);
  }

  /**
   * 输出退出时使用的最终静态内容；调用方应先移除临时 footer。
   *
   */
  function renderFinal({ bannerContext, records, theme, renderPreferences, width }: RenderFinalOptions): void {
    const lines = [...renderBannerLines(bannerContext, theme), ...renderTranscriptLines(records, width, theme, renderPreferences)];
    output.write(`${ansi.showCursor()}${lines.join('\n')}\n`);
  }

  return {
    appendRecord,
    appendRecords,
    clearFooter,
    renderDestructive,
    renderFinal,
    renderFooter,
    renderInitial
  };
}

/**
 * 把 banner block 拆成逐行数组，供完整快照统一拼接。
 *
 */
  function renderBannerLines(context: BannerContext, theme: RenderState['theme']): string[] {
    return splitRenderedBlock(renderBanner(context, theme));
}

/**
 * 把 transcript records 投影成当前宽度下的可见行。
 *
 */
export function renderTranscriptLines(
  records: TranscriptRecord[] = [],
  width = 80,
  theme: RenderState['theme'] = DEFAULT_TUI_THEME,
  renderPreferences: RenderState['renderPreferences'] = DEFAULT_RENDER_PREFERENCES
): string[] {
  const lines: string[] = [];

  for (const block of renderTranscriptBlocks(records, width, theme, renderPreferences)) {
    lines.push(...splitRenderedBlock(block));
  }

  return lines;
}

/**
 * 把 transcript records 投影成完整 block 字符串，保留实时 append 所需的尾部换行。
 */
function renderTranscriptBlocks(
  records: TranscriptRecord[] = [],
  width = 80,
  theme: RenderState['theme'] = DEFAULT_TUI_THEME,
  renderPreferences: RenderState['renderPreferences'] = DEFAULT_RENDER_PREFERENCES
): string[] {
  const visibleRecords = renderPreferences.showReasoningSummary
    ? records
    : records.filter((record) => record.role !== 'reasoning_summary');
  return groupTranscriptRecords(visibleRecords)
    .map((block) => renderTranscriptBlock(block, width, theme))
    .filter((block) => block.length > 0);
}

/**
 * 顺序扫描 transcript，把相邻且同 call id 的工具调用和结果聚合为一个渲染块。
 */
function groupTranscriptRecords(records: TranscriptRecord[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const nextRecord = records[index + 1];

    if (
      record.role === 'tool_call' &&
      nextRecord?.role === 'tool_result' &&
      record.toolCallId !== '' &&
      record.toolCallId === nextRecord.toolCallId
    ) {
      blocks.push({ kind: 'tool_pair', call: record, result: nextRecord });
      index += 1;
      continue;
    }

    blocks.push({ kind: 'record', record });
  }

  return blocks;
}

/**
 * 按聚合后的 transcript block 类型选择对应 renderer。
 */
function renderTranscriptBlock(block: TranscriptBlock, width: number, theme: RenderState['theme']): string {
  if (block.kind === 'tool_pair') {
    return renderToolPairBlock(block.call, block.result, width, theme);
  }

  return renderRecordBlock(block.record, width, theme);
}

/**
 * 按 record role 选择对应的 transcript block renderer。
 * user record 的 plan mode 颜色依赖提交时写入的 metadata，避免重绘时受当前 mode 影响。
 *
 */
function renderRecordBlock(record: TranscriptRecord, width: number, theme: RenderState['theme']): string {
  if (record.role === 'user') {
    return renderUserBlock(getUserDisplayText(record), width, theme, record.metadata?.interactionMode);
  }

  if (record.role === 'assistant') {
    return renderAssistantBlock(record.text, width, theme);
  }

  if (record.role === 'tool_call' || record.role === 'tool_result') {
    return renderToolRecordBlock(record, width, theme);
  }

  if (record.role === 'shell') {
    return renderShellBlock(record.text, width, theme);
  }

  if (record.role === 'error') {
    return renderErrorBlock(record.text, width, theme);
  }

  if (record.role === 'compaction_notice') {
    return renderCompactionNoticeBlock(record.text, width, theme);
  }

  if (record.role === 'local_notice') {
    return renderLocalNoticeBlock(record.text, width, theme);
  }

  if (record.role === 'reasoning_summary') {
    return renderReasoningSummaryBlock(record.text, width, theme);
  }

  return '';
}

function getUserDisplayText(record: UserTranscriptRecord): string {
  return record.displayText && record.displayText.trim() !== '' ? record.displayText : record.text;
}

/**
 * 把 block 字符串拆成逐行数组，并去掉仅用于 block 拼接的末尾空行。
 *
 */
function splitRenderedBlock(block: string): string[] {
  const lines = String(block).split('\n');

  if (lines[lines.length - 1] === '') {
    // block 末尾的换行只表示下一个 block 从新行开始，拼接数组时不能再额外放大一行。
    lines.pop();
  }

  return lines;
}

import {DEFAULT_TUI_THEME, type TuiTheme} from '../../config/theme-config';
import {isTerminalControlChar, sanitizeTerminalText} from '../../terminal/control-chars';
import {renderShellBlockLines, renderShellMessageLines} from '../blocks/message-renderer';
import {stripAnsi} from '../layout';

import type {RenderState} from '../../types/render';
import type {TranscriptRecord} from '../../types/transcript';

/**
 * shell mode 运行期输出的增量净化与稳定行边界扫描状态。
 * 净化口径与 sanitizeTerminalText 一致：CRLF 归一为 LF、孤立 CR 与控制字符删除；
 * 确定边界只落在完整行尾，保证分批投影始终是最终 record block 投影的连续前缀。
 */
export type ShellLiveOutputState = {
  carry: string; // 跨 chunk 驻留的 '\r'：可能与下一 chunk 的 '\n' 组成 CRLF。
  sanitized: string; // 已扫描原始输出前缀的净化文本，作为稳定前缀的唯一来源。
  scannedRawLength: number; // 已扫描的原始输出前缀长度。
  committedLength: number; // sanitized 中已进入终端历史区的长度，始终落在完整行边界。
  committedRawLength: number; // committedLength 对应的原始输出前缀长度，供 footer 尾部切片。
  boundaryLength: number; // sanitized 中最新完整行边界长度（含换行）。
  boundaryRawLength: number; // boundaryLength 对应的原始输出前缀长度。
};

type ShellLiveCommitState = {
  echoText: string; // 当前命令的命令行展示文本；变化表示新命令，确定游标随之重置。
  echoCommitted: boolean; // 命令行是否已写入终端历史区。
  output: ShellLiveOutputState; // 运行期输出的增量净化与稳定行边界游标。
};

export function createShellLiveOutputState(): ShellLiveOutputState {
  return {
    carry: '',
    sanitized: '',
    scannedRawLength: 0,
    committedLength: 0,
    committedRawLength: 0,
    boundaryLength: 0,
    boundaryRawLength: 0
  };
}

/**
 * 增量推进扫描：只处理新到达的原始输出；跨 chunk 的 CRLF 由 carry 归一，行边界保持单调。
 */
export function scanShellLiveOutput(state: ShellLiveOutputState, rawOutput: string): void {
  let sanitized = state.sanitized;

  for (let index = state.scannedRawLength; index < rawOutput.length; index += 1) {
    const char = rawOutput[index];

    if (state.carry === '\r') {
      state.carry = '';
      if (char === '\n') {
        sanitized += '\n';
        state.boundaryLength = sanitized.length;
        state.boundaryRawLength = index + 1;
        continue;
      }
      // 孤立 CR 删除后，当前字符仍按普通字符继续处理。
    }

    if (char === '\r') {
      // 可能与下一字符组成 CRLF：先驻留 carry，等下一字符或下一次扫描决定。
      state.carry = '\r';
      continue;
    }

    if (char === '\n') {
      sanitized += '\n';
      state.boundaryLength = sanitized.length;
      state.boundaryRawLength = index + 1;
      continue;
    }

    if (isTerminalControlChar(char)) {
      continue;
    }

    sanitized += char;
  }

  state.sanitized = sanitized;
  state.scannedRawLength = rawOutput.length;
}

/**
 * 取出最新稳定行边界之前尚未确定的新增输出；无新增边界或整体仍为空白时返回 null。
 * 纯空白前缀延后确定：最终 record 会省略 trim 后为空的输出区段。
 */
export function takeShellStableOutput(state: ShellLiveOutputState): string | null {
  if (state.boundaryLength <= state.committedLength) {
    return null;
  }

  if (state.committedLength === 0 && state.sanitized.slice(0, state.boundaryLength).trim() === '') {
    return null;
  }

  const chunk = state.sanitized.slice(state.committedLength, state.boundaryLength);
  state.committedLength = state.boundaryLength;
  state.committedRawLength = state.boundaryRawLength;
  return chunk;
}

/** 返回已经写入终端历史区的输出文本（净化口径，含行尾换行）。 */
export function getShellCommittedOutputText(state: ShellLiveOutputState): string {
  return state.sanitized.slice(0, state.committedLength);
}

/**
 * 把新增的已确定行按顺序拼接为 commit content：每个行元素以换行结束，
 * 与 block 元素流逐字节同构（block 末尾空元素只表示换行边界）。
 */
function joinShellDeltaContent(lines: string[]): string {
  return lines.map((line) => `${line}\n`).join('');
}

/** 渲染 record 文本内的 section 分隔空行；与 text 按换行拆分后的空行同源。 */
function renderShellSeparatorLine(width: number, theme: TuiTheme): string {
  return renderShellMessageLines('', width, theme)[0];
}

/** 渲染命令行首帧投影的 commit content（含 block 前导空行）。 */
export function renderShellEchoContent(echoText: string, width: number, theme: TuiTheme = DEFAULT_TUI_THEME): string {
  return joinShellDeltaContent(['', ...renderShellMessageLines(echoText, width, theme)]);
}

/**
 * 取出最新稳定行边界之后新增的 commit content；没有新边界或整体仍为空白时返回 null。
 * 首个输出片段自带 record 文本内的 section 分隔空行。
 */
export function takeShellStableContent(state: ShellLiveOutputState, width: number, theme: TuiTheme = DEFAULT_TUI_THEME): string | null {
  const leadingSeparator = state.committedLength === 0;
  const chunk = takeShellStableOutput(state);

  if (chunk === null) {
    return null;
  }

  const lines = renderShellMessageLines(chunk.replace(/\n$/u, ''), width, theme);
  return joinShellDeltaContent(leadingSeparator ? [renderShellSeparatorLine(width, theme), ...lines] : lines);
}

/**
 * 把命令行与已确定输出投影为已写入终端历史区的行数组；行序与一次性渲染 shell record
 * block 的前缀同构，供 destructive recovery 重建与 completion 校验复用。
 */
function renderShellCommittedLines({committedOutputText, echoText, width = 80, theme = DEFAULT_TUI_THEME}: {committedOutputText: string; echoText: string; theme?: TuiTheme; width?: number}): string[] {
  const lines = ['', ...renderShellMessageLines(echoText, width, theme)];

  if (committedOutputText !== '') {
    lines.push(renderShellSeparatorLine(width, theme), ...renderShellMessageLines(committedOutputText.replace(/\n$/u, ''), width, theme));
  }

  return lines;
}

/**
 * 渲染 shell record completion 尚未确定的剩余投影；已确定前缀不重复写入。
 * 前缀校验失败（ctx 超限 offload 改变了输出区段）时以 echo 边界为基准补写最终 record 投影。
 */
export function renderShellCompletionContent(recordText: string, echoText: string, committedOutputText: string, width = 80, theme: TuiTheme = DEFAULT_TUI_THEME): string {
  const blockLines = renderShellBlockLines(sanitizeTerminalText(recordText), width, theme);
  const echoLines = renderShellCommittedLines({committedOutputText: '', echoText, width, theme});
  const committedLines = renderShellCommittedLines({committedOutputText, echoText, width, theme});
  const committedIsPrefix = committedLines.length <= blockLines.length
    && committedLines.every((line, index) => stripAnsi(line) === stripAnsi(blockLines[index]));
  const remainingLines = committedIsPrefix ? blockLines.slice(committedLines.length) : blockLines.slice(echoLines.length);

  return remainingLines.join('\n');
}

/**
 * 管理 shell mode 运行期投影：命令行 echo、稳定整行增量确定、completion 补写与快照重建。
 * 每步确定都与 footer 重绘合并为同一次终端写入。
 * shell 命令只从 main composer 提交（BTW 仅继承 normal/plan 回答语义，子会话窗口不接管输入），
 * 因此运行期状态是单实例，不需要像 streaming 那样按 owner 键控。
 */
class ShellLiveRenderer {
  private state: ShellLiveCommitState | null = null;

  /** 返回当前命令的运行期确定状态；命令行变化时丢弃旧游标。 */
  private getState(echoText: string): ShellLiveCommitState {
    if (this.state && this.state.echoText === echoText) {
      return this.state;
    }

    this.state = {echoText, echoCommitted: false, output: createShellLiveOutputState()};
    return this.state;
  }

  /**
   * 推进运行期投影：首个投影确定命令行，activity tick 确定新增稳定完整行。
   * 返回本次需要追加到终端历史区的 content；没有待确定内容时返回空串。
   */
  commitDeltas(options: RenderState): string {
    const pending = options.pending;

    if (pending?.kind !== 'shell_output') {
      return '';
    }

    const state = this.getState(pending.commandLine);
    let content = '';

    if (!state.echoCommitted) {
      state.echoCommitted = true;
      content += renderShellEchoContent(state.echoText, options.width, options.theme);
    }

    scanShellLiveOutput(state.output, pending.output);
    const chunkContent = takeShellStableContent(state.output, options.width, options.theme);

    if (chunkContent !== null) {
      content += chunkContent;
    }

    return content;
  }

  /** 注入 footer 未确定尾部起点，避免已进入终端历史区的行重复展示。 */
  injectHistory(options: RenderState): RenderState {
    const pending = options.pending;

    if (pending?.kind !== 'shell_output') {
      return options;
    }

    return {
      ...options,
      pending: {...pending, historyRawLength: this.state ? this.state.output.committedRawLength : 0}
    };
  }

  /** destructive recovery：按当前宽度推进确定游标并重建已确定投影行。 */
  snapshotLines(options: RenderState): string[] {
    this.commitDeltas(options);

    const pending = options.pending;
    const state = pending?.kind === 'shell_output' ? this.state : null;

    if (!state?.echoCommitted) {
      return [];
    }

    return renderShellCommittedLines({
      committedOutputText: getShellCommittedOutputText(state.output),
      echoText: state.echoText,
      width: options.width,
      theme: options.theme
    });
  }

  /** shell record completion 补写；返回 null 表示没有运行期确定状态、按普通 record block 渲染。 */
  takeCompletion(records: TranscriptRecord[], options: RenderState): string | null {
    const [record] = records;

    if (records.length !== 1 || record.role !== 'shell') {
      return null;
    }

    const state = this.state;

    if (!state?.echoCommitted) {
      return null;
    }

    // 记录首行必须与已 echo 的命令一致；不一致时按普通 block 完整渲染，避免错误裁剪。
    if (!record.text.startsWith(state.echoText)) {
      return null;
    }

    return renderShellCompletionContent(record.text, state.echoText, getShellCommittedOutputText(state.output), options.width, options.theme);
  }

  /** 丢弃运行期确定状态（命令完成、失败或切换命令）。 */
  reset(): void {
    this.state = null;
  }
}

export {
  ShellLiveRenderer
};

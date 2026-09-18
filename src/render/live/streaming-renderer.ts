import {DEFAULT_RENDER_PREFERENCES} from '../../config/app-settings-config';
import {sanitizeTerminalText} from '../../terminal/control-chars';
import { renderAssistantMessageLines, renderReasoningSummaryLines } from '../blocks/message-renderer';
import { getCommittableReasoningText, getCommittableStreamingText, renderStreamingCommitLines } from '../blocks/streaming-text';

import type {RenderState} from '../../types/render';
import type {TranscriptRecord} from '../../types/transcript';

type DisplayedStreamingText = {
  assistant: string; // 已经移入终端历史区的 assistant 文本。
  reasoning: string; // 已经移入终端历史区的 reasoning 文本。
};

type StreamingDisplayState = DisplayedStreamingText & {
  reasoningDisplayClosed: boolean; // 首个正文 token 后禁止再把迟到 reasoning 追加到当前终端历史区。
};

/** 运行期投影按 owner 隔离；主会话与 BTW 各自维护流式显示进度。 */
function resolveOwner(options: RenderState): string {
  return options.streamingOwner || 'main';
}

/**
 * 管理 assistant 正文与 reasoning 的运行期增量确定：稳定前缀提交、finalizeRecord 补写、
 * footer 尾部注入与 destructive 快照重算；状态按 owner 键控。
 */
class StreamingLiveRenderer {
  private readonly byOwner = new Map<string, StreamingDisplayState>();

  /** 返回当前 owner 已经写入终端历史区的流式文本状态。 */
  private getState(options: RenderState): StreamingDisplayState {
    const owner = resolveOwner(options);
    let state = this.byOwner.get(owner);

    if (!state) {
      state = {assistant: '', reasoning: '', reasoningDisplayClosed: false};
      this.byOwner.set(owner, state);
    }

    return state;
  }

  /** 根据完整草稿计算当前时刻可以留在终端历史区的文本。 */
  private getStableText(options: RenderState, current: StreamingDisplayState): DisplayedStreamingText {
    const pending = options.pending;
    const preferences = options.renderPreferences || DEFAULT_RENDER_PREFERENCES;

    if (pending?.kind === 'reasoning_streaming') {
      return {
        assistant: current.assistant,
        reasoning: preferences.showReasoningSummary
          ? getCommittableReasoningText(pending.text, options.width)
          : current.reasoning
      };
    }

    if (pending?.kind === 'streaming') {
      return {
        assistant: getCommittableStreamingText(pending.text),
        reasoning: !preferences.showReasoningSummary
          ? ''
          : current.reasoningDisplayClosed
            ? current.reasoning
            : pending.reasoningText || current.reasoning
      };
    }

    return {assistant: '', reasoning: ''};
  }

  /**
   * 提交本轮新增的稳定内容，并按需补写 finalizeRecord 尚未展示的尾部。
   * 返回需要追加到终端历史区的 content；没有新内容时返回空串。
   */
  commitDeltas(options: RenderState, finalizeRecord?: Extract<TranscriptRecord, {role: 'assistant' | 'reasoning_summary'}>): string {
    const current = this.getState(options);
    const next = finalizeRecord && !options.pending
      ? {assistant: current.assistant, reasoning: current.reasoning}
      : this.getStableText(options, current);
    const reasoningLines = renderStreamingCommitLines('reasoning', next.reasoning, current.reasoning, options.width, options.theme);
    const assistantLines = renderStreamingCommitLines('assistant', next.assistant, current.assistant, options.width, options.theme);
    // 首次进入正文时补齐当时已有的 reasoning 和消息间距；之后的迟到 reasoning 不再进入当前历史区。
    const startsAssistant = options.pending?.kind === 'streaming' && !current.reasoningDisplayClosed;
    const closesReasoning = startsAssistant && next.reasoning !== '';
    const lines = [...reasoningLines, ...(closesReasoning ? [''] : []), ...assistantLines];
    let content = lines.length > 0 ? `${lines.join('\n')}\n` : '';

    current.reasoning = next.reasoning;
    current.assistant = next.assistant;
    if (startsAssistant) current.reasoningDisplayClosed = true;

    if (finalizeRecord) {
      const kind = finalizeRecord.role === 'assistant' ? 'assistant' : 'reasoning';
      const renderMessage = kind === 'assistant' ? renderAssistantMessageLines : renderReasoningSummaryLines;
      const fullLines = renderMessage(sanitizeTerminalText(finalizeRecord.text), options.width, options.theme);
      const displayedText = current[kind];
      const displayedLines = displayedText === '' ? [] : renderMessage(displayedText, options.width, options.theme);
      const remainingLines = fullLines.slice(displayedLines.length);
      const visible = finalizeRecord.role !== 'reasoning_summary' || options.renderPreferences.showReasoningSummary;
      const suppressLateReasoning = kind === 'reasoning' && current.reasoningDisplayClosed;

      if (visible && !suppressLateReasoning) {
        content += `${remainingLines.join('\n')}${remainingLines.length > 0 ? '\n' : ''}\n`;
      }

      current[kind] = '';
      if (kind === 'assistant') {
        current.reasoning = '';
        current.reasoningDisplayClosed = false;
      }
    }

    return content;
  }

  /** 注入已进入终端历史区的正文/reasoning 文本，避免 footer 重复展示。 */
  injectHistory(options: RenderState): RenderState {
    const pending = options.pending;
    const state = this.byOwner.get(resolveOwner(options));

    if (pending?.kind === 'reasoning_streaming' && state && state.reasoning !== '') {
      return {
        ...options,
        pending: {...pending, historyText: state.reasoning}
      };
    }

    if (pending?.kind === 'streaming' && state && state.assistant !== '') {
      return {
        ...options,
        pending: {...pending, historyText: state.assistant}
      };
    }

    return options;
  }

  /** destructive recovery：按当前宽度重算稳定文本，返回快照行并同步 owner 游标。 */
  snapshotLines(options: RenderState): string[] {
    const current = this.getState(options);
    const next = this.getStableText(options, {assistant: '', reasoning: '', reasoningDisplayClosed: false});

    current.reasoning = next.reasoning;
    current.assistant = next.assistant;
    current.reasoningDisplayClosed = options.pending?.kind === 'streaming';

    return [
      ...(next.reasoning === '' ? [] : renderReasoningSummaryLines(next.reasoning, options.width, options.theme)),
      ...(next.assistant === '' ? [] : renderAssistantMessageLines(next.assistant, options.width, options.theme))
    ];
  }
}

export {
  StreamingLiveRenderer
};

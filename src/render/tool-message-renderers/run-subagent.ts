import {blockText} from '../colors';
import {stripAnsi} from '../layout';
import {
  createSubagentRailLayout,
  renderPrefixedLines,
  renderRailText,
  renderSubagentRailSpacer,
  resolveToolCallPrefixStyle
} from './shared';
import {formatSubagentRawName, formatSubagentTerminalIdentity} from '../../agent/subagent/name';

import type {TuiTheme} from '../../config/theme-config';
import type {ToolCallTranscriptRecord, ToolResultTranscriptRecord} from '../../types/transcript';

const RUN_SUBAGENT_TOOL_NAME = 'run_subagent';

type RunSubagentCallDisplay = {
  agent: unknown; // 保留原始解析值，由安全 formatter 决定显示身份。
  task: string; // 已消除 ANSI 的委派任务原文，保留换行结构，不做展示截断。
};

/**
 * 将相邻 run_subagent call/result 投影为与单 subagent rail 同构的三段形态：rail 标题段（agent 原名 · 任务原文，专属 rail 色）、
 * 报告正文段（rail assistant 同款弱化正文与 12 行预算）与终态行；不渲染中间过程与原始 JSON 参数。
 * 参数解析失败时返回 null，交回通用工具投影以保留事实内容。
 */
function renderRunSubagentToolPairLines(
  call: ToolCallTranscriptRecord,
  result: ToolResultTranscriptRecord,
  width: number,
  theme: TuiTheme
): string[] | null {
  const request = parseRunSubagentCall(call.argumentsText);
  if (!request) {
    return null;
  }

  const {firstPrefix, outerPrefix} = createSubagentRailLayout(width);
  const lines: string[] = [];
  lines.push(...renderRailText(`${formatSubagentRawName(request.agent)} · ${request.task}`, width, firstPrefix, outerPrefix, theme, null, 'title'));
  lines.push(renderSubagentRailSpacer(outerPrefix, theme));
  lines.push(...renderRailText(result.text.trim() !== '' ? result.text : '(no output)', width, outerPrefix, outerPrefix, theme));
  lines.push(renderSubagentRailSpacer(outerPrefix, theme));
  lines.push(...renderRailText(!result.ok ? 'failed' : 'completed', width, outerPrefix, outerPrefix, theme, 1));
  return lines;
}

/** 渲染 run_subagent 工具对的折叠形态：单行终态身份文案，用于已有本地子运行终态的单委派；自 tool-message-renderer 内联投影迁入。 */
function renderRunSubagentCompactPairLines(
  call: ToolCallTranscriptRecord,
  result: ToolResultTranscriptRecord,
  width: number,
  theme: TuiTheme
): string[] {
  return renderPrefixedLines({
    text: formatSubagentTerminalIdentity(resolveRunSubagentAgent(call.argumentsText), result.ok ? 'completed' : 'failed'),
    width,
    firstPrefix: '◆ ',
    continuationPrefix: '  ',
    colorizeFirstSymbol: resolveToolCallPrefixStyle(result.ok, theme),
    colorizeLine: (line) => blockText(theme, 'toolOutput', line)
  });
}

/** 保守解析委派参数；agent 或 task 形状不可信时整体交给通用 renderer。 */
function parseRunSubagentCall(argumentsText: unknown): RunSubagentCallDisplay | null {
  if (typeof argumentsText !== 'string') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const payload = parsed as Record<string, unknown>;
  if (typeof payload.agent !== 'string' || payload.agent.trim() === '') {
    return null;
  }

  const task = typeof payload.task === 'string' ? stripAnsi(payload.task).trim() : '';
  if (task === '') {
    return null;
  }

  return {
    agent: payload.agent,
    task
  };
}

/** 仅为折叠形态容错解析 agent；不可信值交给安全 formatter 回退通用身份。 */
function resolveRunSubagentAgent(argumentsText: string): unknown {
  try {
    const parsed: unknown = JSON.parse(argumentsText);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as {agent?: unknown}).agent
      : undefined;
  } catch {
    // 外层参数可能来自旧记录或损坏journal，只影响可见回退文案。
  }
  return undefined;
}

export {
  RUN_SUBAGENT_TOOL_NAME,
  renderRunSubagentCompactPairLines,
  renderRunSubagentToolPairLines
};

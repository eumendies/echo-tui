import {type TuiTheme} from '../../config/theme-config';
import {blockText} from '../colors';
import {
  TOOL_RESULT_MAX_DISPLAY_LINES,
  renderPrefixedLines,
  resolveToolCallPrefixStyle,
  truncateDisplayText
} from './shared';

import type {ToolCallTranscriptRecord, ToolResultTranscriptRecord} from '../../types/transcript';

const USE_SKILL_TOOL_NAME = 'use_skill';

/**
 * 将 use_skill 相邻 call/result 投影成面向用户的摘要；成功结果正文继续只留在原始 transcript 中。
 */
function renderUseSkillToolPairLines(call: ToolCallTranscriptRecord, result: ToolResultTranscriptRecord, width: number, theme: TuiTheme): string[] {
  const lines = renderUseSkillToolCallLines(call, width, result.ok, theme);

  if (result.ok === false) {
    lines.push(...renderUseSkillFailureResultLines(result, width, theme));
  }

  return lines;
}

/**
 * 渲染 use_skill 调用摘要；只暴露 skill 名称，不展示 arguments JSON 或附加参数。
 */
function renderUseSkillToolCallLines(record: ToolCallTranscriptRecord, width: number, callStatus: unknown, theme: TuiTheme): string[] {
  return renderUseSkillSummaryLines(resolveSkillNameFromArguments(record.argumentsText), width, callStatus, theme);
}

/**
 * 渲染孤立 use_skill result；成功结果隐藏正文，失败结果保留短诊断。
 */
function renderUseSkillToolResultLines(record: ToolResultTranscriptRecord, width: number, theme: TuiTheme): string[] {
  const lines = renderUseSkillSummaryLines(resolveSkillNameFromResultText(record.text), width, record.ok, theme);

  if (record.ok === false) {
    lines.push(...renderUseSkillFailureResultLines(record, width, theme));
  }

  return lines;
}

/**
 * 构造带工具状态颜色的 use_skill 摘要行，保持宽度处理和通用工具调用一致。
 */
function renderUseSkillSummaryLines(skillName: string | null, width: number, callStatus: unknown, theme: TuiTheme): string[] {
  return renderPrefixedLines({
    text: createUseSkillSummaryText(skillName),
    width,
    firstPrefix: '◆ ',
    continuationPrefix: '  ',
    colorizeFirstSymbol: resolveToolCallPrefixStyle(callStatus, theme)
  });
}

/**
 * 失败结果保留原始短诊断的可见投影，但仍套用既有工具输出截断预算。
 */
function renderUseSkillFailureResultLines(record: ToolResultTranscriptRecord, width: number, theme: TuiTheme): string[] {
  const resultText = record.text.trim() !== '' ? record.text : '(no output)';

  return renderPrefixedLines({
    text: truncateDisplayText(resultText, TOOL_RESULT_MAX_DISPLAY_LINES),
    width,
    firstPrefix: '  ⎿ ',
    continuationPrefix: '    ',
    colorizeLine: (line) => blockText(theme, 'toolOutput', line)
  });
}

/**
 * 生成用户可读摘要；缺少可信名称时只显示安全的通用文案。
 */
function createUseSkillSummaryText(skillName: string | null): string {
  return skillName ? `Using skill · ${skillName}` : 'Using skill';
}

/**
 * 从 tool_call arguments JSON 中保守读取 skill 名称，解析失败不向上抛错。
 */
function resolveSkillNameFromArguments(argumentsText: unknown): string | null {
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

  const name = (parsed as {name?: unknown}).name;

  return typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
}

/**
 * 为孤立成功 result 尝试读取 `skill:` 头部，避免展示完整 skill 正文来恢复名称。
 */
function resolveSkillNameFromResultText(text: unknown): string | null {
  if (typeof text !== 'string') {
    return null;
  }

  const firstLine = text.split('\n', 1)[0] || '';
  const match = firstLine.match(/^skill:\s*(.+)$/u);
  const name = match?.[1]?.trim();

  return name ? name : null;
}

export {
  USE_SKILL_TOOL_NAME,
  renderUseSkillToolCallLines,
  renderUseSkillToolPairLines,
  renderUseSkillToolResultLines
};

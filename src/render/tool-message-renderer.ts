import {DEFAULT_TUI_THEME, type TuiTheme} from '../config/theme-config';
import {blockText} from './colors';
import {
  ASK_USER_QUESTIONS_TOOL_NAME,
  renderAskUserQuestionsToolPairLines
} from './tool-message-renderers/ask-user-questions';
import {
  APPLY_PATCH_TOOL_NAME,
  isApplyPatchDisplayMetadata,
  renderApplyPatchToolCallLines,
  renderApplyPatchToolResultLines
} from './tool-message-renderers/apply-patch';
import {renderBashToolCallLines, renderBashToolPairLines, renderBashToolResultLines} from './tool-message-renderers/bash';
import {
  READ_FILES_TOOL_NAME,
  renderReadFilesToolCallLines,
  renderReadFilesToolResultLines
} from './tool-message-renderers/read-files';
import {isTodoRenderToolName, renderTodoToolCallLines, renderTodoToolResultLines} from './tool-message-renderers/todo';
import {
  USE_SKILL_TOOL_NAME,
  renderUseSkillToolCallLines,
  renderUseSkillToolPairLines,
  renderUseSkillToolResultLines
} from './tool-message-renderers/use-skill';
import {
  TOOL_RESULT_MAX_DISPLAY_LINES,
  renderPrefixedLines,
  resolveToolCallPrefixStyle,
  truncateDisplayText
} from './tool-message-renderers/shared';

import type {TranscriptRecord} from '../types/transcript';
import type {ToolRecordRenderOptions} from './tool-message-renderers/shared';

const BASH_TOOL_NAME = 'run_bash_command';

/**
 * 渲染 tool transcript record 的可见投影，保留 transcript/provider 事实内容不变。
 */
export function renderToolRecordBlock(record: TranscriptRecord, width = 80, theme: TuiTheme = DEFAULT_TUI_THEME): string {
  const lines = renderToolRecordLines(record, width, {}, theme);
  const trailingBlankLines = record.role === 'tool_call' ? [''] : ['', ''];

  return [...lines, ...trailingBlankLines].join('\n');
}

/**
 * 渲染完整 tool call/result 对；call 的状态样式直接来自 result，不向普通 record renderer 泄漏。
 */
export function renderToolPairBlock(call: TranscriptRecord, result: TranscriptRecord, width = 80, theme: TuiTheme = DEFAULT_TUI_THEME): string {
  const pairAwareLines = renderPairAwareToolPairLines(call, result, width, theme);

  if (pairAwareLines) {
    return renderToolPairLinesBlock(pairAwareLines);
  }

  return renderToolPairLinesBlock(renderSplitToolPairLines(call, result, width, theme));
}

/**
 * 尝试使用同时依赖 call/result 的专属 renderer；解析失败时返回 null 交给分开渲染路径。
 */
function renderPairAwareToolPairLines(call: TranscriptRecord, result: TranscriptRecord, width: number, theme: TuiTheme): string[] | null {
  if (call.toolName === BASH_TOOL_NAME && result.toolName === BASH_TOOL_NAME) {
    return renderBashToolPairLines(call, result, width, theme);
  }

  if (call.toolName === ASK_USER_QUESTIONS_TOOL_NAME && result.toolName === ASK_USER_QUESTIONS_TOOL_NAME) {
    return renderAskUserQuestionsToolPairLines(call, result, width, theme);
  }

  if (call.toolName === USE_SKILL_TOOL_NAME && result.toolName === USE_SKILL_TOOL_NAME) {
    return renderUseSkillToolPairLines(call, result, width, theme);
  }

  return null;
}

/**
 * 使用单条 tool record renderer 分别渲染 call 和 result，适合两边不需要互读的工具。
 */
function renderSplitToolPairLines(call: TranscriptRecord, result: TranscriptRecord, width: number, theme: TuiTheme): string[] {
  const callStatus = typeof result.ok === 'boolean' ? result.ok : undefined;

  return [
    ...renderToolRecordLines(call, width, {callStatus}, theme),
    ...renderToolRecordLines(result, width, {}, theme)
  ];
}

/**
 * 给 tool pair 可见行补齐 block 结尾空行，保持 transcript 间距集中在 pair 层处理。
 */
function renderToolPairLinesBlock(lines: string[]): string {
  return [
    ...lines,
    '',
    ''
  ].join('\n');
}

/**
 * 渲染 footer pending 中的工具调用预览，和正式 tool_call 使用一致的参数投影。
 */
export function renderToolCallPreviewLines(toolName: string, argumentsText: string, width = 80, theme: TuiTheme = DEFAULT_TUI_THEME): string[] {
  return renderToolRecordLines({
    role: 'tool_call',
    text: `${toolName}(${argumentsText})`,
    toolName,
    argumentsText
  }, width, {}, theme);
}

/**
 * 根据 toolName 选择工具专属投影；未知工具降级为通用工具消息。
 */
function renderToolRecordLines(record: TranscriptRecord, width: number, options: ToolRecordRenderOptions = {}, theme: TuiTheme): string[] {
  if (record.toolName === APPLY_PATCH_TOOL_NAME) {
    if (record.role === 'tool_call') {
      return renderApplyPatchToolCallLines(record, width, options.callStatus, theme);
    }

    if (record.role === 'tool_result' && record.ok !== false && isApplyPatchDisplayMetadata(record.display)) {
      return renderApplyPatchToolResultLines(record, record.display, width, theme);
    }
  }

  if (record.toolName === BASH_TOOL_NAME) {
    if (record.role === 'tool_call') {
      return renderBashToolCallLines(record, width, options.callStatus, theme)
        ?? renderGenericToolRecordLines(record, width, options, theme);
    }

    return renderBashToolResultLines(record, width, theme);
  }

  if (record.toolName === READ_FILES_TOOL_NAME) {
    if (record.role === 'tool_call') {
      return renderReadFilesToolCallLines(record, width, options.callStatus, theme)
        ?? renderGenericToolRecordLines(record, width, options, theme);
    }

    if (record.role === 'tool_result') {
      return renderReadFilesToolResultLines(record, width, theme)
        ?? renderGenericToolRecordLines(record, width, options, theme);
    }
  }

  if (isTodoRenderToolName(record.toolName)) {
    if (record.role === 'tool_call') {
      return renderTodoToolCallLines(record, width, options.callStatus, theme);
    }

    if (record.role === 'tool_result') {
      return renderTodoToolResultLines(record, width, theme)
        ?? renderGenericToolRecordLines(record, width, options, theme);
    }
  }

  if (record.toolName === USE_SKILL_TOOL_NAME) {
    if (record.role === 'tool_call') {
      return renderUseSkillToolCallLines(record, width, options.callStatus, theme);
    }

    if (record.role === 'tool_result') {
      return renderUseSkillToolResultLines(record, width, theme);
    }
  }

  return renderGenericToolRecordLines(record, width, options, theme);
}

/**
 * 未知工具或缺少工具专属 metadata 的记录走通用 fallback。
 */
function renderGenericToolRecordLines(
  record: TranscriptRecord,
  width: number,
  options: ToolRecordRenderOptions = {},
  theme: TuiTheme
): string[] {
  if (record.role === 'tool_call') {
    const toolName = typeof record.toolName === 'string' && record.toolName ? record.toolName : 'Tool';
    const text = `${toolName}(${typeof record.argumentsText === 'string' ? record.argumentsText : record.text})`;

    return renderPrefixedLines({
      text,
      width,
      firstPrefix: '◆ ',
      continuationPrefix: '  ',
        colorizeFirstSymbol: resolveToolCallPrefixStyle(options.callStatus, theme)
    });
  }

  return renderPrefixedLines({
    text: truncateDisplayText(record.text || '(no output)', TOOL_RESULT_MAX_DISPLAY_LINES),
    width,
    firstPrefix: '  ⎿ ',
    continuationPrefix: '    ',
    colorizeLine: (line) => blockText(theme, 'toolOutput', line)
  });
}

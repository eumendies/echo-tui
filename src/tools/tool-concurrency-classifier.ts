import {RUN_BASH_COMMAND_TOOL_NAME, isPlanReadonlyBashCommand} from './bash-tool-handler';
import {READONLY_OBSERVATION_TOOL_NAMES, parseBashCommand} from './tool-risk-classifier';

import type {ToolCall} from '../types/tool';

type ToolCallConcurrency = 'parallel_read' | 'exclusive';

/**
 * 判断工具调用能否与相邻只读调用重叠执行；未知或无法证明只读的调用一律独占。
 */
function classifyToolCallConcurrency(call: ToolCall): ToolCallConcurrency {
  if (READONLY_OBSERVATION_TOOL_NAMES.has(call.toolName)) {
    return 'parallel_read';
  }

  if (call.toolName === RUN_BASH_COMMAND_TOOL_NAME) {
    const command = parseBashCommand(call.argumentsText);
    return command && isPlanReadonlyBashCommand(command) ? 'parallel_read' : 'exclusive';
  }

  return 'exclusive';
}

export {
  classifyToolCallConcurrency
};

export type {
  ToolCallConcurrency
};

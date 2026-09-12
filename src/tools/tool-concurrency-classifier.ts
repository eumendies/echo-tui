import {RUN_BASH_COMMAND_TOOL_NAME, isPlanReadonlyBashCommand} from './bash-tool-handler';
import {RUN_SUBAGENT_TOOL_NAME} from './run-subagent-tool-handler';
import {READONLY_OBSERVATION_TOOL_NAMES, parseBashCommand} from './tool-risk-classifier';

import type {ToolCall} from '../types/tool';

type ToolCallConcurrency = 'parallel_read' | 'exclusive';

/**
 * 判断工具调用能否与相邻只读调用重叠执行；未知或无法证明只读的调用一律独占。
 * run_subagent 依据注入的只读 subagent 名称集合判定；参数解析失败或名称未命中一律独占。
 */
function classifyToolCallConcurrency(call: ToolCall, readonlySubagentNames?: ReadonlySet<string>): ToolCallConcurrency {
  if (READONLY_OBSERVATION_TOOL_NAMES.has(call.toolName)) {
    return 'parallel_read';
  }

  if (call.toolName === RUN_BASH_COMMAND_TOOL_NAME) {
    const command = parseBashCommand(call.argumentsText);
    return command && isPlanReadonlyBashCommand(command) ? 'parallel_read' : 'exclusive';
  }

  if (call.toolName === RUN_SUBAGENT_TOOL_NAME && readonlySubagentNames) {
    const agentName = parseRunSubagentAgentName(call.argumentsText);
    return agentName !== null && readonlySubagentNames.has(agentName) ? 'parallel_read' : 'exclusive';
  }

  return 'exclusive';
}

/** 解析 run_subagent 参数中的 agent 名称；provider 输出不可信，解析失败返回 null。 */
function parseRunSubagentAgentName(argumentsText: string): string | null {
  let args: unknown;

  try {
    args = JSON.parse(argumentsText);
  } catch {
    return null;
  }

  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return null;
  }

  const agentName = (args as {agent?: unknown}).agent;
  return typeof agentName === 'string' && agentName !== '' ? agentName : null;
}

export {
  classifyToolCallConcurrency
};

export type {
  ToolCallConcurrency
};

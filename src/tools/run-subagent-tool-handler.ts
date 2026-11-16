import type {SubagentToolPort} from '../types/agent';
import {DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES} from './tool-handler-utils';
import {createOffloadedTextPreview} from './tool-result-offloading';

import type {ToolExecutionOptions, ToolExecutionResult, ToolHandler, ToolCall} from '../types/tool';
import type {SubagentWorkspaceOutcomeFacts} from '../types/transcript';
import type {ToolResultStore} from './tool-result-offloading';

const RUN_SUBAGENT_TOOL_NAME = 'run_subagent';

/**
 * 解析 run_subagent 的必填参数。
 * 调度器在创建工作区之前也需要这份判定，避免为注定被拒绝的调用先分配资源。
 */
function parseRunSubagentArguments(argumentsText: string): {agent: string; task: string} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const {agent, task} = parsed as {agent?: unknown; task?: unknown};
  if (typeof agent !== 'string' || typeof task !== 'string' || task.trim() === '') {
    return null;
  }
  return {agent, task: task.trim()};
}

/** 创建普通子 Agent 工具 handler；嵌套运行能力全部通过窄 Port 注入。 */
function createRunSubagentToolHandler(port: SubagentToolPort, toolResultStore?: ToolResultStore): ToolHandler {
  const subagents = port.listDefinitions();
  const names = subagents.map((subagent) => subagent.name);
  const catalog = subagents.map((subagent) => `- ${subagent.name}: ${subagent.description}`).join('\n');

  return {
    definition: {
      name: RUN_SUBAGENT_TOOL_NAME,
      description: [
        'Delegate a self-contained task to a named subagent and return only its bounded final result. Oversized reports may be saved to a local artifact that can be inspected with read_files.',
        'In a Git project the built-in worker may run in its own detached worktree started from a frozen commit: it cannot see your uncommitted changes or other workers\' changes, it does not commit, merge, or push, and its changes are never applied to your working tree automatically.',
        'When that applies, put the interface contracts and dependency assumptions the worker needs into the task, and review and integrate the returned workspace handoff yourself with your existing tools. A successful worker run only means the task finished, not that the change is integrated.'
      ].join(' '),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['agent', 'task'],
        properties: {
          agent: {
            type: 'string',
            enum: names,
            description: `Available subagents:\n${catalog}`
          },
          task: {
            type: 'string',
            description: 'The selected subagent runs in an isolated context and cannot see the parent conversation. Include all necessary context directly; do not refer to prior messages or the user request. If the worker reports a managed workspace, its base commit does not contain your uncommitted changes, so state any required interfaces explicitly.'
          }
        }
      }
    },
    transcriptCommitMode: 'pair_after_execute',
    async execute(args: Record<string, unknown>, call: ToolCall, options?: ToolExecutionOptions): Promise<ToolExecutionResult> {
      const agentName = args.agent;
      const task = args.task;
      if (typeof agentName !== 'string' || !names.includes(agentName)) {
        return createResult(call, false, `agent must be one of: ${names.join(', ')}`, toolResultStore);
      }
      if (typeof task !== 'string' || task.trim() === '') {
        return createResult(call, false, 'task must be a non-empty string', toolResultStore);
      }

      try {
        const result = await port.run(agentName, task.trim(), call, options);
        // 成果定位随结果进入结构化 details，compact 投影也能保留成果入口。
        return createResult(call, result.ok, result.text, toolResultStore, result.workspace);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return createResult(call, false, `Subagent failed: ${message}`, toolResultStore);
      }
    }
  };
}

function createResult(call: ToolCall, ok: boolean, text: string, toolResultStore?: ToolResultStore, workspace?: SubagentWorkspaceOutcomeFacts): ToolExecutionResult {
  const preview = createOffloadedTextPreview({
    maxPreviewBytes: DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES,
    strategy: 'head',
    store: toolResultStore,
    text,
    // 子代理已结束，无法继续询问；只能带长度约束重新委派，或直接使用头部预览。
    truncationMessage: 'Subagent result was truncated and no artifact was saved. Re-run run_subagent with the same task and require a concise report, or continue with this preview.'
  });
  return {
    callId: call.callId,
    toolName: RUN_SUBAGENT_TOOL_NAME,
    ok,
    details: {kind: 'generic', ...(workspace ? {workspace} : {})},
    text: preview.text
  };
}

export {
  RUN_SUBAGENT_TOOL_NAME,
  createRunSubagentToolHandler,
  parseRunSubagentArguments
};

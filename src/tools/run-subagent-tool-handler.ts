import type {SubagentToolPort} from '../types/agent';
import {DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES} from './tool-handler-utils';
import {createOffloadedTextPreview} from './tool-result-offloading';

import type {ToolExecutionOptions, ToolExecutionResult, ToolHandler, ToolCall} from '../types/tool';
import type {ToolResultStore} from './tool-result-offloading';

const RUN_SUBAGENT_TOOL_NAME = 'run_subagent';

/** 创建普通子 Agent 工具 handler；嵌套运行能力全部通过窄 Port 注入。 */
function createRunSubagentToolHandler(port: SubagentToolPort, toolResultStore?: ToolResultStore): ToolHandler {
  const subagents = port.listDefinitions();
  const names = subagents.map((subagent) => subagent.name);
  const catalog = subagents.map((subagent) => `- ${subagent.name}: ${subagent.description}`).join('\n');

  return {
    definition: {
      name: RUN_SUBAGENT_TOOL_NAME,
      description: 'Delegate a self-contained task to a named subagent and return only its bounded final result. Oversized reports may be saved to a local artifact that can be inspected with read_files.',
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
            description: 'The selected subagent runs in an isolated context and cannot see the parent conversation. Include all necessary context directly; do not refer to prior messages or the user request.'
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
        return createResult(call, result.ok, result.text, toolResultStore);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return createResult(call, false, `Subagent failed: ${message}`, toolResultStore);
      }
    }
  };
}

function createResult(call: ToolCall, ok: boolean, text: string, toolResultStore?: ToolResultStore): ToolExecutionResult {
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
    details: {kind: 'generic'},
    text: preview.text
  };
}

export {
  RUN_SUBAGENT_TOOL_NAME,
  createRunSubagentToolHandler
};

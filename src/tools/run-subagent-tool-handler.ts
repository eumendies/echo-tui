import type {SubagentToolPort} from '../types/agent';
import type {ToolExecutionOptions, ToolExecutionResult, ToolHandler, ToolCall} from '../types/tool';

const RUN_SUBAGENT_TOOL_NAME = 'run_subagent';

/** 创建普通子 Agent 工具 handler；嵌套运行能力全部通过窄 Port 注入。 */
function createRunSubagentToolHandler(port: SubagentToolPort): ToolHandler {
  const subagents = port.listDefinitions();
  const names = subagents.map((subagent) => subagent.name);
  const catalog = subagents.map((subagent) => `- ${subagent.name}: ${subagent.description}`).join('\n');

  return {
    definition: {
      name: RUN_SUBAGENT_TOOL_NAME,
      description: 'Delegate a self-contained task to a named subagent and return only its final result.',
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
        return createResult(call, false, `agent must be one of: ${names.join(', ')}`);
      }
      if (typeof task !== 'string' || task.trim() === '') {
        return createResult(call, false, 'task must be a non-empty string');
      }

      const result = await port.run(agentName, task.trim(), call, options);
      return createResult(call, result.ok, result.text);
    }
  };
}

function createResult(call: ToolCall, ok: boolean, text: string): ToolExecutionResult {
  return {
    callId: call.callId,
    toolName: RUN_SUBAGENT_TOOL_NAME,
    ok,
    details: {kind: 'generic'},
    text
  };
}

export {
  RUN_SUBAGENT_TOOL_NAME,
  createRunSubagentToolHandler
};

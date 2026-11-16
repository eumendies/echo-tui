import {RUN_BASH_COMMAND_TOOL_NAME, isPlanReadonlyBashCommand} from './bash-tool-handler';
import {RUN_SUBAGENT_TOOL_NAME} from './run-subagent-tool-handler';
import {READONLY_OBSERVATION_TOOL_NAMES, parseBashBackgroundFlag, parseBashCommand, parseRunSubagentAgentName} from './tool-risk-classifier';

import type {ToolCall} from '../types/tool';

type ToolCallConcurrency = 'parallel_read' | 'parallel_worker' | 'exclusive';

/**
 * 工作区并发资格：由调度器在屏障之后异步预检、冻结之后同步传入。
 * 分类器本身不执行 Git、不读目录、不等待 Promise。
 */
type WorkerWorkspaceConcurrencyContext = {
  mode: 'managed_worktree' | 'shared_cwd'; // 本次并发采用的工作区方式。
  workerAgentName: string; // 唯一获得独立工作区并发资格的内置 Worker 名称。
};

type ToolCallConcurrencyContext = {
  readonlySubagentNames?: ReadonlySet<string>; // run 启动时固定的只读子 Agent 名称集合。
  workerWorkspace?: WorkerWorkspaceConcurrencyContext; // 已完成的工作区预检结论；缺省表示无 Worker 并发资格。
};

/**
 * 判断工具调用能否与相邻只读调用重叠执行；未知或无法证明只读的调用一律独占。
 * run_subagent 依据注入的只读 subagent 名称集合判定；参数解析失败或名称未命中一律独占。
 */
function classifyToolCallConcurrency(call: ToolCall, context: ToolCallConcurrencyContext = {}): ToolCallConcurrency {
  if (READONLY_OBSERVATION_TOOL_NAMES.has(call.toolName)) {
    return 'parallel_read';
  }

  if (call.toolName === RUN_BASH_COMMAND_TOOL_NAME) {
    // 后台启动在交接完成后立即返回;分类仍为独占,屏障只覆盖启动交接,不等待任务结束。
    if (parseBashBackgroundFlag(call.argumentsText)) {
      return 'exclusive';
    }

    const command = parseBashCommand(call.argumentsText);
    return command && isPlanReadonlyBashCommand(command) ? 'parallel_read' : 'exclusive';
  }

  if (call.toolName === RUN_SUBAGENT_TOOL_NAME) {
    const agentName = parseRunSubagentAgentName(call.argumentsText);
    if (agentName === null) {
      return 'exclusive';
    }
    // 只读委派沿用原有并发语义；Worker 资格不进入 readonly 集合，两者完全分离。
    if (context.readonlySubagentNames?.has(agentName)) {
      return 'parallel_read';
    }
    if (context.workerWorkspace && agentName === context.workerWorkspace.workerAgentName) {
      // 非 Git 共享目录仍逐个独占执行；只有已核验的受管 worktree 才获得并发资格。
      return context.workerWorkspace.mode === 'managed_worktree' ? 'parallel_worker' : 'exclusive';
    }
    return 'exclusive';
  }

  return 'exclusive';
}

export {
  classifyToolCallConcurrency
};

export type {
  ToolCallConcurrency,
  ToolCallConcurrencyContext,
  WorkerWorkspaceConcurrencyContext
};

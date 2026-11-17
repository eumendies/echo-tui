import {classifyToolCallConcurrency} from '../../tools/tool-concurrency-classifier';
import {RUN_SUBAGENT_TOOL_NAME, parseRunSubagentArguments} from '../../tools/run-subagent-tool-handler';
import {AgentAbortError, throwIfAborted} from '../../types/agent';
import {executeToolCall} from './tool-call-runner';
import {createRejectedToolResult} from './shared';

import type {
  AgentCallbacks,
  SubagentToolPort,
  SubagentWorkspaceAllocation,
  SubagentWorkspaceProbe
} from '../../types/agent';
import type {ToolCall, ToolExecutionResult} from '../../types/tool';
import type {ToolCallConcurrencyContext} from '../../tools/tool-concurrency-classifier';
import type {ToolCallRuntime} from './tool-call-runner';

/**
 * 并发执行一批调用所需的运行事实。
 *
 * 在单次调用准入链之外只补充内置 Worker 的委派端口与资格名称；provider、压缩和
 * skill 预算等循环状态不在这里，避免执行器反向依赖整份运行状态。
 */
type ToolConcurrencyRuntime = ToolCallRuntime & {
  subagentPort?: SubagentToolPort; // 主运行注入的委派端口；无委派目录时缺省。
  workerAgentName?: string; // 唯一获得独立工作区并发资格的内置 Worker 名称。
};

/** 统计一次只读并发内的 run_subagent 调用数量；达到两个才作为并行分组事实下行到委派端口。 */
function countRunSubagentGroupSize(toolCalls: ToolCall[]): number | undefined {
  const count = toolCalls.filter((toolCall) => toolCall.toolName === RUN_SUBAGENT_TOOL_NAME).length;
  return count >= 2 ? count : undefined;
}

/**
 * 判断调用是否属于内置 Worker 候选。
 *
 * 候选只依赖运行启动时冻结的 Agent 目录、合法参数与当前父权限语义；真正的并发资格
 * 由工作区预检决定，这里不探测 Git 也不创建目录。
 */
function isWorkerCandidate(toolCall: ToolCall, state: ToolConcurrencyRuntime): boolean {
  if (!state.workerAgentName || !state.subagentPort?.probeWorkspace || !state.subagentPort.allocateWorkerWorkspace) {
    return false;
  }
  // plan 与 readonly 父运行不创建可写 worktree，沿用既有拒绝与只读语义。
  if (state.toolPolicy !== 'default' || state.interactionMode === 'plan') {
    return false;
  }
  // 工具被禁用或不存在时不分配资源：授权不能恢复已移除的工具。
  if (toolCall.toolName !== RUN_SUBAGENT_TOOL_NAME || !state.registry.getHandler(RUN_SUBAGENT_TOOL_NAME)) {
    return false;
  }
  // 参数不合法（含空 task）会在 handler 里被拒绝，不该先建一个工作区再丢下。
  const parsed = parseRunSubagentArguments(toolCall.argumentsText);
  return parsed !== null && parsed.agent === state.workerAgentName;
}

/**
 * 串行执行共享目录 Worker：明确非 Git 项目走这里。
 * 结果按 provider 原序返回，调用之间不重叠。
 */
async function executeWorkersSerially(
  workerCalls: ToolCall[],
  state: ToolConcurrencyRuntime,
  callbacks: AgentCallbacks
): Promise<ToolExecutionResult[]> {
  const results: ToolExecutionResult[] = [];
  for (const call of workerCalls) {
    throwIfAborted(state.abortSignal);
    state.observation.toolStarted({scope: state.observationScope, call});
    // 串行执行不是并行组：不传 groupSize，避免渲染层按并行紧凑形态隐藏完整过程栏。
    const result = await executeToolCall(call, state, callbacks, {subagentWorkspace: {kind: 'shared_cwd'}});
    state.observation.toolCompleted({scope: state.observationScope, result});
    results.push(result);
  }
  return results;
}

/**
 * 冻结快照之后的并发分类上下文。
 * 分类器只同步读取这里的事实，不执行 Git、不等待 Promise。
 */
function createWorkerConcurrencyContext(state: ToolConcurrencyRuntime, probe: SubagentWorkspaceProbe): ToolCallConcurrencyContext {
  return {
    ...(state.readonlySubagentNames ? {readonlySubagentNames: state.readonlySubagentNames} : {}),
    ...(state.workerAgentName && probe.kind !== 'error'
      ? {workerWorkspace: {mode: probe.kind === 'git' ? 'managed_worktree' as const : 'shared_cwd' as const, workerAgentName: state.workerAgentName}}
      : {})
  };
}

/**
 * 在屏障之后完成工作区预检，并按结论执行 Worker 调用。
 *
 * 只读并发、Worker 并发和独占调用之间保持屏障：本函数被调用时前一批已全部 settled，
 * 因此不会复用被前序 shell 或编辑改变过的仓库状态。结果槽位保持 provider 原始顺序。
 */
async function executeWorkersConcurrently(workerCalls: ToolCall[], state: ToolConcurrencyRuntime, callbacks: AgentCallbacks): Promise<ToolExecutionResult[]> {
  throwIfAborted(state.abortSignal);
  const port = state.subagentPort!;
  const subagentGroupSize = workerCalls.length >= 2 ? workerCalls.length : undefined;
  const probe = await port.probeWorkspace!({abortSignal: state.abortSignal});
  throwIfAborted(state.abortSignal);

  if (probe.kind === 'error') {
    state.observation.workerConcurrencyPrepared({
      scope: state.observationScope,
      candidates: workerCalls.length,
      mode: 'error',
      started: 0,
      workspacePreparationFailures: 0
    });
    // 预检失败：每个候选在原位得到配对失败结果，且不启动任何子运行或回退共享目录。
    const message = [`Worker workspace could not be prepared: ${probe.message}`, '', 'The delegation was not started, and no shared-directory fallback was used.'].join('\n');
    return workerCalls.map((call) => createRejectedToolResult(call, message));
  }

  if (probe.kind === 'non_git') {
    // 明确非 Git：维持共享 cwd 的串行执行，不允许重叠写同一目录。
    const results = await executeWorkersSerially(workerCalls, state, callbacks);
    state.observation.workerConcurrencyPrepared({
      scope: state.observationScope,
      candidates: workerCalls.length,
      mode: 'shared_cwd',
      started: workerCalls.length,
      workspacePreparationFailures: 0
    });
    return results;
  }

  // 冻结快照之后的同步分类。Worker 候选 + Git 快照必然授予 parallel_worker：
  // 候选已排除非 default 工具策略与 plan，而只读名称集合只收 readonly_investigation，
  // 内置 worker 不可能同时属于两者。
  const workerConcurrencyContext = createWorkerConcurrencyContext(state, probe);
  if (classifyToolCallConcurrency(workerCalls[0], workerConcurrencyContext) !== 'parallel_worker') {
    // 理论上不可达。真出现说明分类与预检不一致：既不能崩进程，也不能静默回退共享目录。
    const message = 'Worker workspace could not be prepared: the delegation was not classified for an isolated workspace.';
    return workerCalls.map((call) => createRejectedToolResult(call, message));
  }

  // Git：为每个调用创建独立 detached worktree；共用同一冻结基线。
  // 用 allSettled 收集，保证分配阶段取消失败时仍能结算已经建好的工作区。
  const allocationResults = await Promise.allSettled(workerCalls.map(async (call) => {
    const allocation = await port.allocateWorkerWorkspace!({abortSignal: state.abortSignal, call, probe});
    return {allocation, call};
  }));
  const allocations = allocationResults.map((entry, index) => entry.status === 'fulfilled'
    ? entry.value
    // 单个创建失败不改变已冻结的快照，也不影响兄弟调用。
    : {allocation: {kind: 'failed', message: 'Managed workspace creation failed unexpectedly.'} as SubagentWorkspaceAllocation, call: workerCalls[index]});

  const allocationFailure = allocationResults.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
  if (allocationFailure || state.abortSignal?.aborted) {
    // 取消或异常：已经分配但还没交给 Worker 的工作区必须结算，否则登记会停在 preparing。
    await releaseWorkerAllocations(port, allocations);
    if (allocationFailure) {
      throw allocationFailure.reason;
    }
    throw new AgentAbortError();
  }

  const settled = await Promise.allSettled(allocations.map(async ({allocation, call}) => {
    if (allocation.kind !== 'ok') {
      return createRejectedToolResult(call, `Worker workspace could not be created: ${allocation.message} The delegation was not started, and no shared-directory fallback was used.`);
    }
    state.observation.toolStarted({scope: state.observationScope, call});
    const result = await executeToolCall(call, state, callbacks, {
      ...(subagentGroupSize === undefined ? {} : {subagentGroupSize}),
      subagentWorkspace: {kind: 'managed_worktree', runId: allocation.runId, workspace: allocation.workspace}
    });
    state.observation.toolCompleted({scope: state.observationScope, result});
    return result;
  }));

  const rejected = settled.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
  if (rejected) {
    // 父 turn 取消除外：已分配但未运行的工作区必须标记为取消并保留现场。
    await releaseWorkerAllocations(port, allocations);
    throw rejected.reason;
  }
  throwIfAborted(state.abortSignal);

  state.observation.workerConcurrencyPrepared({
    scope: state.observationScope,
    candidates: workerCalls.length,
    mode: 'managed_worktree',
    started: allocations.filter((entry) => entry.allocation.kind === 'ok').length,
    workspacePreparationFailures: allocations.filter((entry) => entry.allocation.kind !== 'ok').length
  });
  return settled.map((entry) => (entry as PromiseFulfilledResult<ToolExecutionResult>).value);
}

/**
 * 释放已分配但未真正运行的工作区。
 * 已经通过端口完成终态结算的登记会被 finalize 的幂等检查跳过。
 */
async function releaseWorkerAllocations(
  port: SubagentToolPort,
  allocations: {allocation: SubagentWorkspaceAllocation; call: ToolCall}[]
): Promise<void> {
  for (const {allocation} of allocations) {
    if (allocation.kind !== 'ok' || !port.releaseWorkerWorkspace) {
      continue;
    }
    try {
      await port.releaseWorkerWorkspace({status: 'cancelled', workspace: allocation.workspace});
    } catch {
      // 释放失败不得掩盖原始取消原因；现场仍保留在受管目录中。
    }
  }
}

/**
 * 同时执行整批连续只读调用；结果槽位保持 provider 原始顺序，实际完成顺序不影响提交。
 */
async function executeReadOnlyConcurrently(toolCalls: ToolCall[], state: ToolConcurrencyRuntime, callbacks: AgentCallbacks): Promise<ToolExecutionResult[]> {
  throwIfAborted(state.abortSignal);
  const subagentGroupSize = countRunSubagentGroupSize(toolCalls);
  const settled = await Promise.allSettled(toolCalls.map(async (toolCall) => {
    state.observation.toolStarted({scope: state.observationScope, call: toolCall});
    const result = await executeToolCall(toolCall, state, callbacks, subagentGroupSize === undefined ? {} : {subagentGroupSize});
    state.observation.toolCompleted({scope: state.observationScope, result});
    return result;
  }));

  throwIfAborted(state.abortSignal);
  const rejected = settled.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
  if (rejected) {
    throw rejected.reason;
  }

  return settled.map((entry) => (entry as PromiseFulfilledResult<ToolExecutionResult>).value);
}
export {executeReadOnlyConcurrently, executeWorkersConcurrently, isWorkerCandidate};

export type {ToolConcurrencyRuntime};

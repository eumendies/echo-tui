import type {ReasoningEffort, SubagentActivity} from '../../types/agent';
import {formatSubagentRawName} from '../../agent/subagent/name';

import type {SubagentPendingState, SubagentsPendingState} from '../../types/render';
import type {SubagentTranscriptRecord} from '../../types/transcript';

type ActiveSubagentRun = {
  agentName: string; // 当前 rail 与 footer 展示的内置或自定义子 Agent 目录名称。
  argumentsText?: string; // 当前内部工具调用的原始参数，仅用于瞬时摘要。
  draft?: string; // 当前 reasoning 或 assistant 草稿，不写入 transcript。
  parallel: boolean; // start record 是否携带 parallelSize；决定 footer singular/plural 与主 rail 过滤。
  phase: SubagentActivity['phase']; // 当前 provider、流式、工具或审批阶段。
  runId: string; // 当前子运行身份，拒绝其他运行的迟到 callback。
  startedAt: number; // elapsed time 使用的单调墙钟锚点。
  lastActivityAt: number; // 最近一次稳定事件或瞬时活动的墙钟；singular 投影选择最近活动 run。
  model?: string; // start record 携带的子运行实际模型名；旧会话缺省。
  reasoningEffort?: ReasoningEffort; // start record 携带的实际生效推理强度。
  task: string; // 当前委派任务，只用于本地可见摘要。
  toolName?: string; // 当前内部工具名；非工具阶段缺省。
};

/** 管理单个父 turn 内多个并发子 Agent 的瞬时活动；稳定过程仍由 TranscriptContext 持有。 */
class SubagentRunContext {
  private activeRuns: Map<string, ActiveSubagentRun>;
  private cancelledRunIds: Set<string>;

  constructor() {
    this.activeRuns = new Map();
    this.cancelledRunIds = new Set();
  }

  /**
   * 接受一批同序稳定事件；start 建立身份，终态删除条目，未知 runId 的批次整体拒绝。
   * 并行运行按 runId 独立记账，交错批次中的每个事件只作用于自己的 run。
   */
  acceptRecords(records: SubagentTranscriptRecord[]): boolean {
    for (const record of records) {
      if (record.event.kind === 'start') {
        if (this.activeRuns.has(record.runId)) {
          return false;
        }
        this.activeRuns.set(record.runId, {
          agentName: record.agentName,
          ...(record.event.model === undefined ? {} : {model: record.event.model}),
          parallel: record.event.parallelSize !== undefined,
          phase: 'thinking',
          ...(record.event.reasoningEffort === undefined ? {} : {reasoningEffort: record.event.reasoningEffort}),
          runId: record.runId,
          startedAt: Date.now(),
          lastActivityAt: Date.now(),
          task: record.event.task
        });
        continue;
      }

      const active = this.activeRuns.get(record.runId);
      if (!active) {
        if (record.event.kind === 'cancelled' && this.cancelledRunIds.has(record.runId)) {
          this.cancelledRunIds.delete(record.runId);
          continue;
        }
        return false;
      }

      if (record.event.kind === 'tool_call') {
        this.activeRuns.set(record.runId, {
          ...active,
          argumentsText: record.event.argumentsText,
          lastActivityAt: Date.now(),
          phase: 'tool',
          toolName: record.event.toolName
        });
        continue;
      }

      if (record.event.kind === 'tool_result' || record.event.kind === 'reasoning_summary' || record.event.kind === 'assistant') {
        const {argumentsText: _argumentsText, draft: _draft, toolName: _toolName, ...stable} = active;
        this.activeRuns.set(record.runId, {...stable, lastActivityAt: Date.now(), phase: 'thinking'});
        continue;
      }

      if (record.event.kind === 'completed' || record.event.kind === 'failed' || record.event.kind === 'cancelled') {
        this.activeRuns.delete(record.runId);
      }
    }

    return true;
  }

  /** 更新指定 run 的 token/tool 活动；null 清空全部瞬时活动，不触碰 cancelled 接收身份。 */
  updateActivity(activity: SubagentActivity | null): boolean {
    if (!activity) {
      this.activeRuns.clear();
      return true;
    }

    const active = this.activeRuns.get(activity.runId);
    if (!active) {
      return false;
    }

    const {argumentsText: _argumentsText, draft: _draft, toolName: _toolName, ...stable} = active;
    this.activeRuns.set(activity.runId, {
      ...stable,
      agentName: activity.agentName,
      lastActivityAt: Date.now(),
      phase: activity.phase,
      task: activity.task,
      ...(activity.argumentsText === undefined ? {} : {argumentsText: activity.argumentsText}),
      ...(activity.draft === undefined ? {} : {draft: activity.draft}),
      ...(activity.toolName === undefined ? {} : {toolName: activity.toolName})
    });
    return true;
  }

  /** 父 turn 结束或取消时清理瞬时状态，不伪造稳定终态。 */
  clear(): void {
    this.activeRuns.clear();
    this.cancelledRunIds.clear();
  }

  /** 父 turn 发出 abort 后立即隐藏 footer，同时为每个已取消运行保留一次 cancelled 终态接收身份。 */
  markParentCancelled(): void {
    this.cancelledRunIds = new Set(this.activeRuns.keys());
    this.activeRuns.clear();
  }

  /** 判断审批或其他异步回调是否仍属于当前活动子运行。 */
  isCurrentRun(runId: string): boolean {
    return this.activeRuns.has(runId);
  }

  /** 返回 footer pending 投影；存在并行标记 run 时切换 plural 紧凑块，否则保持 singular。elapsed time 在读取时计算。 */
  getPending(): SubagentPendingState | SubagentsPendingState | null {
    if (this.activeRuns.size === 0) {
      return null;
    }

    // 带 parallelSize 的 run 不进主 rail；只要存在即切换 plural 紧凑块，单个并行 run 也不例外。
    if (Array.from(this.activeRuns.values()).some((run) => run.parallel)) {
      return {kind: 'subagents', runs: Array.from(this.activeRuns.values()).map((run) => createRunPendingState(run))};
    }

    const active = selectMostRecentRun(this.activeRuns);
    return active ? createRunPendingState(active) : null;
  }

  /** 返回指定 run 的瞬时活动快照；已结束或未知 run 返回 null，供会话窗口投影 phase/draft/elapsed。 */
  getActivity(runId: string): SubagentPendingState | null {
    const active = this.activeRuns.get(runId);
    return active ? createRunPendingState(active) : null;
  }

  /** 共享 activity timer 在存在活动 run 时持续触发 footer 重绘。 */
  hasTimedActivity(): boolean {
    return this.activeRuns.size > 0;
  }
}

/** 把单个活跃 run 投影为 footer pending 状态；elapsed time 在读取时计算而不写入状态。 */
function createRunPendingState(active: ActiveSubagentRun): SubagentPendingState {
  return {
    kind: 'subagent',
    agentName: formatSubagentRawName(active.agentName),
    elapsedMs: Math.max(0, Date.now() - active.startedAt),
    phase: active.phase,
    runId: active.runId,
    task: active.task,
    ...(active.argumentsText === undefined ? {} : {argumentsText: active.argumentsText}),
    ...(active.draft === undefined ? {} : {draft: active.draft}),
    // 子运行实际模型事实随 pending/activity 快照透传，供窗口状态行与回看展示。
    ...(active.model === undefined ? {} : {model: active.model}),
    ...(active.reasoningEffort === undefined ? {} : {reasoningEffort: active.reasoningEffort}),
    ...(active.toolName === undefined ? {} : {toolName: active.toolName})
  };
}

/** singular 投影选择最近活动的 run；并行 plural 形态由渲染层另行聚合全部活跃 run。 */
function selectMostRecentRun(activeRuns: Map<string, ActiveSubagentRun>): ActiveSubagentRun | null {
  let selected: ActiveSubagentRun | null = null;
  for (const run of activeRuns.values()) {
    if (!selected || run.lastActivityAt > selected.lastActivityAt) {
      selected = run;
    }
  }
  return selected;
}

export {SubagentRunContext};

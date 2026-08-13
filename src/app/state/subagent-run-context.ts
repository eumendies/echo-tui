import type {SubagentActivity} from '../../types/agent';
import {formatSubagentRawName} from '../../agent/subagent/name';

import type {SubagentPendingState} from '../../types/render';
import type {SubagentTranscriptRecord} from '../../types/transcript';

type ActiveSubagentRun = {
  agentName: string; // 当前 rail 与 footer 展示的内置或自定义子 Agent 目录名称。
  argumentsText?: string; // 当前内部工具调用的原始参数，仅用于瞬时摘要。
  draft?: string; // 当前 reasoning 或 assistant 草稿，不写入 transcript。
  phase: SubagentActivity['phase']; // 当前 provider、流式、工具或审批阶段。
  runId: string; // 当前子运行身份，拒绝其他运行的迟到 callback。
  startedAt: number; // elapsed time 使用的单调墙钟锚点。
  task: string; // 当前委派任务，只用于本地可见摘要。
  toolName?: string; // 当前内部工具名；非工具阶段缺省。
};

/** 管理单个父 turn 内的子 Agent 瞬时活动；稳定过程仍由 TranscriptContext 持有。 */
class SubagentRunContext {
  private activeRun: ActiveSubagentRun | null = null;
  private cancelledRunId: string | null = null;

  /** 接受一批同序稳定事件；start 建立身份，终态在提交后清除瞬时 footer。 */
  acceptRecords(records: SubagentTranscriptRecord[]): boolean {
    for (const record of records) {
      if (record.event.kind === 'start') {
        if (this.activeRun && this.activeRun.runId !== record.runId) {
          return false;
        }
        this.activeRun = {
          agentName: record.agentName,
          phase: 'thinking',
          runId: record.runId,
          startedAt: Date.now(),
          task: record.event.task
        };
        continue;
      }

      if (!this.activeRun || this.activeRun.runId !== record.runId) {
        if (record.event.kind === 'cancelled' && this.cancelledRunId === record.runId) {
          this.cancelledRunId = null;
          continue;
        }
        return false;
      }

      if (record.event.kind === 'tool_call') {
        this.activeRun = {
          ...this.activeRun,
          argumentsText: record.event.argumentsText,
          phase: 'tool',
          toolName: record.event.toolName
        };
        continue;
      }

      if (record.event.kind === 'tool_result' || record.event.kind === 'reasoning_summary' || record.event.kind === 'assistant') {
        const {argumentsText: _argumentsText, draft: _draft, toolName: _toolName, ...stable} = this.activeRun;
        this.activeRun = {...stable, phase: 'thinking'};
        continue;
      }

      if (record.event.kind === 'completed' || record.event.kind === 'failed' || record.event.kind === 'cancelled') {
        this.activeRun = null;
      }
    }

    return true;
  }

  /** 更新当前 run 的 token/tool 活动；null 只清理已经建立的当前运行。 */
  updateActivity(activity: SubagentActivity | null): boolean {
    if (!activity) {
      this.activeRun = null;
      return true;
    }
    if (!this.activeRun || this.activeRun.runId !== activity.runId) {
      return false;
    }

    const {argumentsText: _argumentsText, draft: _draft, toolName: _toolName, ...stable} = this.activeRun;
    this.activeRun = {
      ...stable,
      agentName: activity.agentName,
      phase: activity.phase,
      task: activity.task,
      ...(activity.argumentsText === undefined ? {} : {argumentsText: activity.argumentsText}),
      ...(activity.draft === undefined ? {} : {draft: activity.draft}),
      ...(activity.toolName === undefined ? {} : {toolName: activity.toolName})
    };
    return true;
  }

  /** 父 turn 结束或取消时清理瞬时状态，不伪造稳定终态。 */
  clear(): void {
    this.activeRun = null;
    this.cancelledRunId = null;
  }

  /** 父 turn 发出 abort 后立即隐藏 footer，同时只为权威 cancelled 终态保留一次接收身份。 */
  markParentCancelled(): void {
    this.cancelledRunId = this.activeRun?.runId || null;
    this.activeRun = null;
  }

  /** 判断审批或其他异步回调是否仍属于当前活动子运行。 */
  isCurrentRun(runId: string): boolean {
    return this.activeRun?.runId === runId;
  }

  /** 返回当前 footer 投影，elapsed time 在读取时计算而不写入状态。 */
  getPending(): SubagentPendingState | null {
    const active = this.activeRun;
    if (!active) {
      return null;
    }

    return {
      kind: 'subagent',
      agentName: formatSubagentRawName(active.agentName),
      elapsedMs: Math.max(0, Date.now() - active.startedAt),
      phase: active.phase,
      runId: active.runId,
      task: active.task,
      ...(active.argumentsText === undefined ? {} : {argumentsText: active.argumentsText}),
      ...(active.draft === undefined ? {} : {draft: active.draft}),
      ...(active.toolName === undefined ? {} : {toolName: active.toolName})
    };
  }

  /** 共享 activity timer 在存在活动 run 时持续触发 footer 重绘。 */
  hasTimedActivity(): boolean {
    return this.activeRun !== null;
  }
}

export {SubagentRunContext};

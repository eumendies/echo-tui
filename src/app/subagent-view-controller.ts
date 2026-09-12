import {INPUT_EVENTS} from '../input/event-types';
import {collapseToSingleLine} from '../render/layout';
import {renderSubagentViewIndex, type SubagentViewIndexEntry} from '../render/blocks';


import type {ReasoningEffort, SubagentActivity} from '../types/agent';
import type {InputEvent} from '../types/input';
import type {RenderState, StatusLineState, SubagentPendingState} from '../types/render';
import type {SubagentTranscriptRecord, TranscriptRecord} from '../types/transcript';

/** 窗口状态行与 draft 尾部使用的 run 活动快照；由 SubagentRunContext.getActivity 提供。 */
type SubagentRunActivity = {
  agentName: string; // 已安全格式化的子 Agent 显示名。
  draft?: string; // reasoning 或 assistant 的瞬时草稿，不写入 transcript。
  elapsedMs: number; // 读取时计算的 run 已运行毫秒数。
  model?: string; // 子运行实际使用的模型名；旧记录缺省时回退主模型显示。
  phase: SubagentActivity['phase']; // 当前 provider、流式、工具或审批阶段。
  reasoningEffort?: ReasoningEffort; // 子运行实际生效的推理强度。
  task: string; // 当前委派任务摘要。
  toolName?: string; // tool 阶段的内部工具名。
};

type SubagentViewDependencies = {
  getRecords: () => TranscriptRecord[]; // 主 transcript 只读快照，窗口按 runId 过滤投影。
  getActivity: (runId: string) => SubagentRunActivity | null; // 活跃 run 的瞬时活动；已结束或未知 run 返回 null。
  hasActiveRuns: () => boolean; // 活跃 run 注册表探测；供计时重绘判断免扫 transcript。
  repaint: () => void; // 进入、切换与 body 变化时的 destructive 全屏重绘。
};

/**
 * 管理 Ctrl+O 打开的 subagent 会话窗口：按 runId 过滤主 transcript 做只读全屏投影。
 * 打开时优先定位最近一个仍在活动的 run；↑/↓ 始终在 transcript 内全部 run（活跃与已完成）之间循环切换。
 * 窗口不持有 turn 或工具状态；Esc 只关窗口，绝不触达父 turn 的中断路径。
 */
class SubagentViewController {
  private readonly dependencies: SubagentViewDependencies;
  private activeRunId: string | null = null;

  constructor(dependencies: SubagentViewDependencies) {
    this.dependencies = dependencies;
  }

  /** 返回窗口当前是否接管 app 可见投影。 */
  isActive(): boolean {
    return this.activeRunId !== null;
  }

  /** 返回当前投影的 run 身份；窗口关闭时为 null。 */
  getActiveRunId(): string | null {
    return this.activeRunId;
  }

  /** Ctrl+O 入口：未打开时优先定位最近一个仍在活动的 run，无活跃 run 时回看最近一次委派；已打开时关闭。 */
  toggle(): void {
    if (this.activeRunId !== null) {
      this.closeAndRepaint();
      return;
    }
    const byRun = this.groupRunRecords();
    const runIds = Array.from(byRun.keys());
    const activeRunIds = runIds.filter((runId) => this.dependencies.getActivity(runId) !== null);
    const targetRunIds = activeRunIds.length > 0 ? activeRunIds : runIds;
    if (targetRunIds.length === 0) {
      return;
    }
    this.activeRunId = targetRunIds[targetRunIds.length - 1];
    this.dependencies.repaint();
  }

  /** 静默关闭窗口；exit 收尾与 /btw 打开前的互斥清理由调用方统一重绘。 */
  close(): void {
    this.activeRunId = null;
  }

  /** 窗口内输入：Esc/Ctrl+O 关闭，↑/↓ 循环切换 run；EXIT 放行退出，其余输入只读吞掉。 */
  handleEvent(event: InputEvent): boolean {
    if (this.activeRunId === null) {
      return false;
    }
    if (event.type === INPUT_EVENTS.ESCAPE || event.type === INPUT_EVENTS.OPEN_SUBAGENT_VIEW) {
      this.closeAndRepaint();
      return true;
    }
    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      this.switchRun(event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1);
      return true;
    }
    if (event.type === INPUT_EVENTS.EXIT) {
      return false;
    }
    return true;
  }

  /** 判断一批新记录是否命中当前打开的 run；命中时主循环用 destructive 重绘刷新 body。 */
  containsRunRecords(records: TranscriptRecord[]): boolean {
    return this.activeRunId !== null && records.some((record) => record.role === 'subagent' && record.runId === this.activeRunId);
  }

  /** 当前 run 的全部稳定记录，供 destructive 重绘投影窗口 body。 */
  getViewRecords(): SubagentTranscriptRecord[] {
    if (this.activeRunId === null) {
      return [];
    }
    return this.groupRunRecords().get(this.activeRunId) ?? [];
  }

  /** 单遍扫描把 subagent 稳定记录按 runId 分组；Map 的插入序即 start 顺序，避免按 run 重复全量过滤。 */
  private groupRunRecords(): Map<string, SubagentTranscriptRecord[]> {
    const byRun = new Map<string, SubagentTranscriptRecord[]>();
    for (const record of this.dependencies.getRecords()) {
      if (record.role !== 'subagent') {
        continue;
      }
      const runRecords = byRun.get(record.runId);
      if (runRecords) {
        runRecords.push(record);
      } else {
        byRun.set(record.runId, [record]);
      }
    }
    return byRun;
  }

  /** 汇总全部 run 的索引条目；顺序 = start 顺序，状态取瞬时活动或稳定终态。 */
  private buildIndexEntries(byRun: Map<string, SubagentTranscriptRecord[]>): SubagentViewIndexEntry[] {
    return Array.from(byRun.entries()).map(([runId, runRecords]) => {
      const start = runRecords.find((record) => record.event.kind === 'start');
      let terminal: SubagentTranscriptRecord | undefined;
      for (let index = runRecords.length - 1; index >= 0; index -= 1) {
        const kind = runRecords[index].event.kind;
        if (kind === 'completed' || kind === 'failed' || kind === 'cancelled') {
          terminal = runRecords[index];
          break;
        }
      }
      const activity = this.dependencies.getActivity(runId);
      const agentName = activity?.agentName ?? (start && start.event.kind === 'start' ? start.agentName : 'Subagent');
      const task = start && start.event.kind === 'start' ? start.event.task : '';

      let statusText: string;
      if (activity) {
        statusText = `${activity.phase.replace('_', ' ')}${activity.toolName ? ` · ${activity.toolName}` : ''} · ${(Math.max(0, activity.elapsedMs) / 1000).toFixed(1)}s`;
      } else if (terminal && (terminal.event.kind === 'completed' || terminal.event.kind === 'failed' || terminal.event.kind === 'cancelled')) {
        const label = terminal.event.kind === 'completed' ? '已结束' : terminal.event.kind === 'failed' ? '失败' : '已取消';
        statusText = `${label}${terminal.event.durationMs === undefined ? '' : ` · ${(Math.max(0, terminal.event.durationMs) / 1000).toFixed(1)}s`}`;
      } else {
        statusText = '意外中断';
      }

      return {runId, agentName, task, statusText, active: activity !== null};
    });
  }

  /** 共享 activity timer 钩子：窗口打开且存在活跃 run 时持续重绘；探测走活跃注册表，不扫 transcript。 */
  hasTimedActivity(): boolean {
    return this.activeRunId !== null && this.dependencies.hasActiveRuns();
  }

  /** 用窗口状态行与 draft 尾部覆盖基础 RenderState；其余主题与终端约束继续复用。 */
  createRenderState(base: RenderState): RenderState {
    if (this.activeRunId === null) {
      return base;
    }
    const byRun = this.groupRunRecords();
    const runIds = Array.from(byRun.keys());
    const position = runIds.indexOf(this.activeRunId) + 1;
    const activity = this.dependencies.getActivity(this.activeRunId);
    const startRecord = (byRun.get(this.activeRunId) ?? []).find((record) => record.event.kind === 'start');
    const task = collapseToSingleLine(activity?.task ?? (startRecord && startRecord.event.kind === 'start' ? startRecord.event.task : ''));
    const agentName = activity?.agentName ?? startRecord?.agentName ?? '';
    const startEvent = startRecord && startRecord.event.kind === 'start' ? startRecord.event : undefined;
    // 状态行模型段展示子运行实际使用的模型与 effort；旧记录缺省或无 activity 时回退主会话显示。
    const modelEffort = activity?.reasoningEffort ?? startEvent?.reasoningEffort;
    const model = {
      kind: 'default' as const,
      label: activity?.model ?? startEvent?.model ?? base.statusLine?.model.label ?? 'model unavailable',
      ...(modelEffort === undefined ? {} : {effort: modelEffort})
    };
    const phaseText = activity
      ? `${activity.phase.replace('_', ' ')}${activity.toolName ? ` · ${activity.toolName}` : ''} · ${(Math.max(0, activity.elapsedMs) / 1000).toFixed(1)}s`
      : '已结束';
    const statusLine: StatusLineState | undefined = base.commandSurface ? undefined : {
      projectName: base.statusLine?.projectName ?? '',
      model,
      mode: 'subagent_view',
      detail: `subagent ${position}/${runIds.length} · ${agentName} · ${task} · ${phaseText}`,
      keyHint: '↑/↓ 切换 · Ctrl+O/Esc 返回'
    };
    // run 索引贴在输入区下方；命令 surface 浮层激活时与状态行一致隐藏。
    const indexLines = renderSubagentViewIndex(this.buildIndexEntries(byRun), this.activeRunId, base.width, base.theme);
    const viewIndexLines = base.commandSurface || indexLines.length === 0 ? undefined : [...indexLines, ''];

    return {
      ...base,
      slashSuggestions: null,
      pendingMessage: null,
      pending: activity ? createDraftTailPending(this.activeRunId, activity) : null,
      statusLine,
      viewIndexLines
    };
  }

  private closeAndRepaint(): void {
    this.activeRunId = null;
    this.dependencies.repaint();
  }

  /** ↑/↓ 在当前循环范围内切换并重绘；范围内只有一个 run 时保持原位。 */
  private switchRun(direction: 1 | -1): void {
    if (this.activeRunId === null) {
      return;
    }
    const runIds = Array.from(this.groupRunRecords().keys());
    if (runIds.length <= 1) {
      return;
    }
    const currentIndex = runIds.indexOf(this.activeRunId);
    this.activeRunId = runIds[(currentIndex + direction + runIds.length) % runIds.length];
    this.dependencies.repaint();
  }
}

/** 把活动快照投影为 footer 的 singular subagent pending；draft 作为流式尾部继续复用既有渲染器。 */
function createDraftTailPending(runId: string, activity: SubagentRunActivity): SubagentPendingState {
  return {
    kind: 'subagent',
    agentName: activity.agentName,
    elapsedMs: activity.elapsedMs,
    phase: activity.phase,
    runId,
    task: activity.task,
    ...(activity.draft === undefined ? {} : {draft: activity.draft}),
    ...(activity.toolName === undefined ? {} : {toolName: activity.toolName})
  };
}

export {SubagentViewController};
export type {SubagentRunActivity, SubagentViewDependencies};

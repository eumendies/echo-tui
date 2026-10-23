/** 本地脚本的 rail 投影；仅缓存审计事实及外层结果的有界预览，不保留源码、中间正文或原始对象。 */
import * as ansi from '../terminal/ansi';
import {sanitizeTerminalText} from '../terminal/control-chars';
import type {TuiTheme} from '../config/theme-config';
import type {
  CodeExecutionTranscriptRecord,
  ToolResultTranscriptRecord,
  TranscriptRecord
} from '../types/transcript';
import {blockText} from './colors';
import {createCodeResultPreview, type CodeResultPreviewSection} from './code-mode-result-preview';
import {renderToolRailRows, TOOL_RESULT_MAX_DISPLAY_LINES} from './tool-message-renderers/shared';
import type {CodeExecutionProgress, PendingState} from '../types/render';

type CodeRailRow = {
  text: string; // 尚未着色的单段展示正文，可由共享 rail 按宽度换行。
  tone: 'text' | 'output' | 'error' | 'muted' | 'title'; // 标题/进度正常显示，结果用输出色，错误与辅助说明独立。
  detail?: string; // 行末可弱化的耗时信息，不从结果正文推断。
};

type ChildCall = {
  ordinal: number | null; // 仅接受本次 executionId 后的安全正整数；旧身份使用问号序号。
  order: number; // 旧记录按首次出现顺序稳定编号，不展示其原始身份。
  toolName: string; // 已限长和净化的工具名，不包含参数或响应。
  status: string | null; // null 表示尚未观察到 call_end，而非推断失败。
  duration: string; // 已校验的可选耗时展示。
};

type CallCounts = {
  total: number; // 实际观察到的不同子调用数，或无审计时的结构化 attempted。
  completed: number; // 已明确成功的调用数。
  failed: number; // 已明确失败或被拒绝的调用数。
  cancelled: number; // 已明确取消的调用数。
  unknown: number; // 有结束事件但状态无法识别的调用数。
  pending: number; // 缺少结束事件的调用数，不冒充取消数量。
};

type ExecutionRun = {
  parentId: string; // 用于将外层工具结果归属到本地执行，不展示身份本身。
  executionId: string | null; // 尚未收到审计时为空；之后升级为真实执行身份。
  ordinal: number; // 当前投影中的紧凑运行编号，便于区分交错执行。
  children: Map<string, ChildCall>; // 仅保存子调用展示事实，原始身份只作为配对键。
  sequences: Set<number>; // 防止重复审计回调重复累计数量或输出终态。
  terminal: boolean; // 已观察到执行结束或外层工具结果。
  status: string; // 归一后的执行状态，不从自由文本推断。
  duration: string; // 执行总耗时的安全展示。
  diagnostic: string; // 有界终态诊断；不解析为机器计数或状态。
  outerCounts: CallCounts | null; // 没有子审计时可用的结构化外层计数。
  emitted: boolean; // 最终完整块是否已写入历史；运行期仅更新可重绘的 footer。
  outerSeen: boolean; // 首个外层结果已被处理，重复回调不替换已展示的事实。
  preview: CodeResultPreviewSection[]; // 仅保存每节限行限长、控制字符已转义的展示文本。
};

export type CodeExecutionAppendState = {
  runs: ExecutionRun[]; // 当前驻留投影的有界展示状态；重放和前缀逐出时可丢弃。
};

export type CodeExecutionProjectionOptions = {
  state?: CodeExecutionAppendState; // 实时追加时跨批次共享；省略时执行无副作用的完整投影。
  snapshot?: boolean; // 清屏/恢复时从当前 records 重建，而不是续写旧屏幕。
  activeToolCallIds?: readonly string[]; // 当前仍由工具 pending 持有的外层调用，恢复时不标成中断。
  active?: boolean; // 单工具 pending 没有 callId 时，保护最近的未结束执行，旧残缺运行仍显示中断。
};

/** 创建与当前窗口绑定的展示状态；不会订阅运行事件或执行任何工具。 */
export function createCodeExecutionAppendState(): CodeExecutionAppendState {
  return {
    runs: []
  };
}

/** 前缀逐出时释放不再驻留的展示事实；不扫描或缓存原始结果正文。 */
export function pruneCodeExecutionAppendState(
  state: CodeExecutionAppendState,
  records: TranscriptRecord[]
): void {
  const residentIds = new Set(
    records.flatMap((record) => {
      if (
        record.role === 'code_execution' ||
        record.role === 'tool_call' ||
        record.role === 'tool_result'
      ) {
        return [record.toolCallId];
      }
      return [];
    })
  );
  state.runs = state.runs.filter((run) => residentIds.has(run.parentId));
}

/** 仅对展示来源限长、净化并折叠换行，不改动 append-only 审计事实。 */
function compact(text: string, limit = 160): string {
  return sanitizeTerminalText(text.slice(0, limit)).replace(/\s+/gu, ' ').trim();
}

/** 未知或伪造状态保留未知语义，不将去掉控制字符后的字符串升级为可信成功。 */
function statusText(status: string | undefined): string {
  switch (status) {
    case 'succeeded':
    case 'completed':
      return 'succeeded';
    case 'failed':
    case 'denied':
    case 'rejected':
    case 'cancelled':
      return status;
    default:
      return 'unknown';
  }
}

/** 耗时只接受有限非负数，避免旧记录把 NaN 或控制序列带入终端。 */
function durationText(duration: number | undefined): string {
  if (duration === undefined || !Number.isFinite(duration) || duration < 0) {
    return '';
  }
  return duration < 1000 ? `${Math.round(duration)}ms` : `${(duration / 1000).toFixed(1)}s`;
}

/** 根据原始身份配对；不净化配对键，避免不同恶意身份净化后碰撞。 */
function getRun(
  state: CodeExecutionAppendState,
  parentId: string,
  executionId?: string
): ExecutionRun {
  let run = state.runs.find(
    (candidate) => candidate.parentId === parentId && candidate.executionId === executionId
  );
  if (!run) {
    for (let index = state.runs.length - 1; index >= 0; index -= 1) {
      const candidate = state.runs[index];
      if (
        candidate.parentId === parentId &&
        (executionId === undefined || candidate.executionId === null)
      ) {
        run = candidate;
        break;
      }
    }
  }
  if (run) {
    if (executionId !== undefined && run.executionId === null) {
      run.executionId = executionId;
    }
    return run;
  }
  run = {
    parentId,
    executionId: executionId ?? null,
    ordinal: state.runs.reduce((maximum, candidate) => Math.max(maximum, candidate.ordinal), 0) + 1,
    children: new Map(),
    sequences: new Set(),
    terminal: false,
    status: 'running',
    duration: '',
    diagnostic: '',
    outerCounts: null,
    emitted: false,
    outerSeen: false,
    preview: []
  };
  state.runs.push(run);
  return run;
}

/** 校验本次执行的子序号；旧版、越界和伪造身份不进入可排序的可信序号空间。 */
function childOrdinal(record: CodeExecutionTranscriptRecord): number | null {
  const prefix = `${record.executionId}:`;
  const suffix = record.childCallId?.startsWith(prefix)
    ? record.childCallId.slice(prefix.length)
    : '';
  if (!/^[1-9][0-9]{0,5}$/u.test(suffix)) {
    return null;
  }
  return Number(suffix);
}

/** 汇入单条事件；终态后的迟到事件和重复序号不改变展示计数。 */
function acceptAudit(run: ExecutionRun, record: CodeExecutionTranscriptRecord): void {
  if (run.terminal || run.sequences.has(record.sequence)) {
    return;
  }
  run.sequences.add(record.sequence);
  if (record.event === 'end') {
    run.terminal = true;
    run.status = statusText(record.status);
    run.duration = durationText(record.durationMs);
    run.diagnostic = run.status === 'succeeded' ? '' : compact(record.text);
    return;
  }
  if (record.event !== 'call_start' && record.event !== 'call_end') {
    return;
  }
  // 没有身份的旧事件不能安全配对，只保留为独立的未知序号子项。
  const key =
    record.childCallId === undefined
      ? JSON.stringify(['event', record.sequence])
      : JSON.stringify(['call', record.childCallId]);
  let child = run.children.get(key);
  if (!child) {
    child = {
      ordinal: childOrdinal(record),
      order: run.children.size + 1,
      toolName: compact(record.toolName || 'tool', 64),
      status: null,
      duration: ''
    };
    const ordinal = child.ordinal;
    if (ordinal !== null && [...run.children.values()].some((entry) => entry.ordinal === ordinal)) {
      child.ordinal = null;
    }
    run.children.set(key, child);
  }
  if (record.event === 'call_end' && child.status === null) {
    child.status = statusText(record.status);
    child.duration = durationText(record.durationMs);
  }
}

/** 从唯一外层响应提取计数、诊断和有界预览；不缓存原始 JSON 或扩张内部审计内容。 */
function acceptOuterResult(run: ExecutionRun, record: ToolResultTranscriptRecord): void {
  if (run.outerSeen) {
    return;
  }
  run.outerSeen = true;
  run.terminal = true;
  if (record.details.kind === 'generic' && record.details.interrupted) {
    run.status = 'cancelled';
    run.diagnostic = 'interrupted by user';
    return;
  }
  if (run.status === 'running') {
    run.status = record.ok ? 'succeeded' : 'failed';
  }
  if (record.text.length > 128 * 1024) {
    return;
  }
  let value;
  try {
    value = JSON.parse(record.text);
  } catch {
    return;
  }
  if (!value || !['succeeded', 'failed', 'cancelled'].includes(value.status)) {
    return;
  }
  run.status = value.status;
  try {
    run.preview = createCodeResultPreview(value);
  } catch {
    // 旧记录的异常结构只影响本地预览，不能令 renderer 崩溃或改写 provider 响应。
    run.preview = [];
  }
  const summary = value.summary;
  if (
    summary &&
    ['attempted', 'completed', 'failed', 'cancelled'].every(
      (field) => Number.isSafeInteger(summary[field]) && summary[field] >= 0
    ) &&
    summary.completed + summary.failed + summary.cancelled <= summary.attempted
  ) {
    run.outerCounts = {
      total: summary.attempted,
      completed: summary.completed,
      failed: summary.failed,
      cancelled: summary.cancelled,
      unknown: 0,
      pending: summary.attempted - summary.completed - summary.failed - summary.cancelled
    };
    run.duration = durationText(summary.duration_ms) || run.duration;
  }
  const error = value.error;
  if (
    error &&
    ['compile', 'runtime', 'tool', 'serialize'].includes(error.phase) &&
    typeof error.code === 'string' &&
    typeof error.message === 'string'
  ) {
    const position =
      Number.isSafeInteger(error.line) && error.line > 0
        ? ` · line ${error.line}${Number.isSafeInteger(error.column) && error.column > 0 ? `:${error.column}` : ''}`
        : '';
    run.diagnostic = `${error.phase}${position} · ${compact(error.code, 64)}: ${compact(error.message)}`;
  }
}

/** 子项只从生命周期事实计数；没有子事件时才回退到外层结构化 summary。 */
function countsFor(run: ExecutionRun): CallCounts {
  if (run.children.size === 0 && run.outerCounts) {
    return run.outerCounts;
  }
  const counts = {
    total: run.children.size,
    completed: 0,
    failed: 0,
    cancelled: 0,
    unknown: 0,
    pending: 0
  };
  for (const child of run.children.values()) {
    if (child.status === null) {
      counts.pending += 1;
    } else if (child.status === 'succeeded') {
      counts.completed += 1;
    } else if (child.status === 'cancelled') {
      counts.cancelled += 1;
    } else if (['failed', 'denied', 'rejected'].includes(child.status)) {
      counts.failed += 1;
    } else {
      counts.unknown += 1;
    }
  }
  return counts;
}

/** 始终先排序可信子序号，旧记录保留首次出现顺序，不能让完成顺序主导列表。 */
function sortedChildren(run: ExecutionRun): ChildCall[] {
  return [...run.children.values()].sort(
    (left, right) =>
      (left.ordinal ?? Infinity) - (right.ordinal ?? Infinity) || left.order - right.order
  );
}

/** 布局复用 Bash rail；标题/进度正常显示，结果用输出色，辅助说明和完整耗时后缀单独弱化。 */
function renderRailRows(
  rows: CodeRailRow[],
  status: string,
  width: number,
  theme: TuiTheme,
  includeMarker: boolean,
  output = false
): string[] {
  const failed = ['failed', 'denied', 'rejected', 'cancelled'].includes(status);
  const markerStyle = failed ? 'toolError' : status === 'succeeded' ? 'toolSuccess' : 'toolOutput';
  const titleStyle = markerStyle === 'toolOutput' ? 'tool' : markerStyle;
  const railStyle = output ? (failed ? 'toolError' : 'toolOutput') : titleStyle;
  return rows.flatMap((row, index) =>
    renderToolRailRows({
      rows: [{style: row.tone, text: row.text + (row.detail ?? '')}],
      width,
      theme,
      markerStyle,
      railStyle,
      includeMarker: includeMarker && index === 0,
      /** 共享布局先完成换行，随后只对可信行语义与完整耗时后缀着色。 */
      colorizeContent(tone, text) {
        const suffix = row.detail && text.endsWith(row.detail) ? row.detail : '';
        const body = suffix ? text.slice(0, -suffix.length) : text;
        const content =
          tone === 'muted'
            ? ansi.dim(blockText(theme, 'toolOutput', body))
            : blockText(
                theme,
                tone === 'title'
                  ? titleStyle
                  : tone === 'error'
                    ? 'toolError'
                    : tone === 'output'
                      ? 'toolOutput'
                      : 'text',
                body
              );
        return content + (suffix ? ansi.dim(blockText(theme, 'toolOutput', suffix)) : '');
      }
    })
  );
}

/** footer pending 与历史执行块使用同一 rail，不展开模型提交的脚本源码。 */
export function renderRunCodeCallLines(
  width: number,
  theme: TuiTheme,
  callStatus?: boolean,
  progress?: CodeExecutionProgress
): string[] {
  const status = callStatus === undefined ? 'running' : callStatus ? 'succeeded' : 'failed';
  const rows: CodeRailRow[] = [
    {
      text: progress
        ? `Run code #${progress.ordinal} · ${progress.status}`
        : `Run code · ${status}`,
      tone: 'title'
    }
  ];
  if (progress?.summary) {
    rows.push({text: progress.summary, tone: 'text'});
  }
  return renderRailRows(rows, status, width, theme, true);
}

/** 从结构化事实生成计数；运行中 pending 与历史恢复的 unfinished 不混为取消。 */
function countSummary(run: ExecutionRun, active: boolean): string {
  const counts = countsFor(run);
  const parts = [
    `completed ${counts.completed}/${counts.total}`,
    `failed ${counts.failed}`,
    `cancelled ${counts.cancelled}`
  ];
  if (counts.pending) {
    parts.push(`${active && !run.terminal ? 'pending' : 'unfinished'} ${counts.pending}`);
  }
  if (counts.unknown) {
    parts.push(`unknown ${counts.unknown}`);
  }
  return parts.join(' · ');
}

/** 仅为身份匹配的 pending 注入瞬时进度；无调用身份时不猜测最近执行，避免跨调用污染。 */
export function projectCodeExecutionPending(
  pending: PendingState | null,
  state: CodeExecutionAppendState
): PendingState | null {
  if (!pending || !['tool_call', 'tool_calls'].includes(pending.kind)) {
    return pending;
  }
  /** 只提取有界展示事实；审计结束后等待外层响应，不提前向历史提交完成块。 */
  function progressFor(callId: string | undefined): CodeExecutionProgress | undefined {
    const run = callId
      ? state.runs.find((candidate) => candidate.parentId === callId && !candidate.outerSeen)
      : undefined;
    if (!run) {
      return undefined;
    }
    return {
      ordinal: run.ordinal,
      status: run.terminal ? 'finishing' : 'running',
      summary: countsFor(run).total > 0 ? countSummary(run, true) : ''
    };
  }
  if (pending.kind === 'tool_call' && pending.toolName === 'run_code') {
    return {...pending, codeExecution: progressFor(pending.callId)};
  }
  if (pending.kind === 'tool_calls') {
    return {
      ...pending,
      calls: pending.calls.map((call) =>
        call.toolName === 'run_code' ? {...call, codeExecution: progressFor(call.callId)} : call
      )
    };
  }
  return pending;
}

/** 外层结果到齐后唯一提交完整 rail；预览标签与正文共享节语义，非活动历史可显示残缺执行。 */
function renderRun(run: ExecutionRun, width: number, theme: TuiTheme): string {
  if (run.emitted) {
    return '';
  }
  const status = run.terminal ? run.status : 'interrupted';
  const rows: CodeRailRow[] = [{text: `Run code #${run.ordinal} · ${status}`, tone: 'title'}];
  for (const child of sortedChildren(run)) {
    const childStatus = child.status ?? (run.terminal ? 'unfinished' : 'interrupted');
    rows.push({
      text: `#${child.ordinal ?? `?${child.order}`} ${child.toolName} · ${childStatus}`,
      tone: ['failed', 'denied', 'rejected'].includes(childStatus) ? 'error' : 'text',
      detail: child.duration ? ` · ${child.duration}` : ''
    });
  }
  const summaryStatus = run.terminal ? run.status : 'interrupted before completion';
  rows.push({
    text: `${summaryStatus} · ${countSummary(run, false)}`,
    tone: run.status === 'failed' ? 'error' : 'text',
    detail: run.duration ? ` · ${run.duration}` : ''
  });
  if (run.diagnostic) {
    rows.push({text: run.diagnostic, tone: run.status === 'failed' ? 'error' : 'muted'});
  }
  const lines = renderRailRows(rows, status, width, theme, true);
  lines.push(...renderRailRows([{text: '', tone: 'muted'}], status, width, theme, false, true));
  if (run.preview.length === 0) {
    lines.push(
      ...renderRailRows(
        [
          {
            text: 'Result preview unavailable (outer response missing, interrupted or malformed).',
            tone: 'muted'
          }
        ],
        status,
        width,
        theme,
        false,
        true
      )
    );
  }
  for (const section of run.preview) {
    const sectionStatus = section.tone === 'error' ? 'failed' : 'unknown';
    lines.push(
      ...renderRailRows(
        [
          {
            text: section.heading,
            tone: section.tone
          }
        ],
        sectionStatus,
        width,
        theme,
        false,
        true
      )
    );
    if (section.text !== null) {
      const body = renderRailRows(
        [
          {
            text: section.text,
            tone: section.tone
          }
        ],
        sectionStatus,
        width,
        theme,
        false,
        true
      );
      lines.push(...body.slice(0, TOOL_RESULT_MAX_DISPLAY_LINES));
      if (section.truncated || body.length > TOOL_RESULT_MAX_DISPLAY_LINES) {
        lines.push(
          ...renderRailRows(
            [
              {
                text: '[preview truncated for display; agent response unchanged]',
                tone: 'muted'
              }
            ],
            sectionStatus,
            width,
            theme,
            false,
            true
          )
        );
      }
    }
  }
  run.emitted = true;
  return `${lines.join('\n')}\n\n`;
}

/** 将脚本审计及外层工具对替换为展示块，其余记录保持原顺序并交回普通 transcript renderer。 */
export function projectCodeExecutionRecords(
  records: TranscriptRecord[],
  width: number,
  theme: TuiTheme,
  options: CodeExecutionProjectionOptions = {}
): Array<TranscriptRecord | string> {
  const snapshot = options.snapshot ?? !options.state;
  const state = options.state ?? createCodeExecutionAppendState();
  if (snapshot) {
    state.runs = [];
  }
  const result: Array<TranscriptRecord | string> = [];
  const related = new Map<TranscriptRecord, ExecutionRun>();
  // 快照先聚合完整运行，再在首次出现的位置投影；普通消息之间的相对顺序不变。
  // 实时仅汇入当前批次，跨批次状态只含展示事实，不能从终端反推或重写 transcript。
  for (const record of records) {
    if (record.role === 'code_execution') {
      const run = getRun(state, record.toolCallId, record.executionId);
      acceptAudit(run, record);
      related.set(record, run);
    } else if (
      (record.role === 'tool_call' || record.role === 'tool_result') &&
      record.toolName === 'run_code'
    ) {
      const run = getRun(state, record.toolCallId);
      if (record.role === 'tool_result') {
        acceptOuterResult(run, record);
      }
      related.set(record, run);
    }
  }
  const rendered = new Set<ExecutionRun>();
  const awaitingOuter = state.runs.filter((run) => !run.outerSeen);
  for (const record of records) {
    const run = related.get(record);
    if (!run) {
      result.push(record);
    } else if (!rendered.has(run)) {
      const active =
        options.activeToolCallIds?.includes(run.parentId) ||
        (!!options.active && awaitingOuter.at(-1) === run);
      // 审计只更新有界事实；运行期由 footer 重绘，外层响应到齐后才写入唯一完整历史块。
      if (run.outerSeen || (snapshot && !active)) {
        result.push(renderRun(run, width, theme));
      }
      rendered.add(run);
    }
  }
  return result;
}

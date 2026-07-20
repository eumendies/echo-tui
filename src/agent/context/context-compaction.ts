import {COMPACTION_RECENT_KEEP_COUNT, COMPACTION_THRESHOLD_RATIO} from '../../config/llm-config';
import {estimateTextTokens} from './token-estimator';
import {shouldIncludeRecordInProviderContext} from '../transcript-converter-common';
import {throwIfAborted} from '../../types/agent';

import type {AgentTurnResult, ProviderAgent} from '../../types/agent';
import type {CompactionState, TranscriptRecord} from '../../types/transcript';

type TokenUsageAnchor = {
  usageInputTokens: number;
  measuredAtRecordCount: number;
};

type RunCompactionResult = {
  didCompact: boolean;
  reason: 'compacted' | 'below_threshold' | 'no_boundary';
  compaction?: CompactionState;
};

/**
 * 估算一组记录的字符 token 总量，含摘要文本。
 * 跳过不会发送给 provider 的 role（error、compaction_notice），避免高估上下文长度。
 */
function estimateRecordsTokens(records: TranscriptRecord[], summaryText = ''): number {
  let total = summaryText ? estimateTextTokens(summaryText) : 0;

  for (const record of records) {
    if (!shouldIncludeRecordInProviderContext(record)) {
      continue;
    }

    total += estimateTextTokens(record.role === 'extension' ? JSON.stringify(record.extension) : record.text);
  }

  return total;
}

/**
 * 综合预估当前上下文 token 数：有 usage 真值锚点时以其为基线叠加新增记录的字符估算增量；
 * 无锚点时退化为对全部活跃记录与摘要做纯字符估算。
 */
function estimateContextTokens(options: {
  activeRecords: TranscriptRecord[];
  summaryText?: string;
  anchor?: TokenUsageAnchor | null;
}): number {
  const {activeRecords, summaryText = '', anchor} = options;

  if (anchor && activeRecords.length >= anchor.measuredAtRecordCount) {
    const addedRecords = activeRecords.slice(anchor.measuredAtRecordCount);
    return anchor.usageInputTokens + estimateRecordsTokens(addedRecords);
  }

  return estimateRecordsTokens(activeRecords, summaryText);
}

/**
 * 判断当前预估是否超过上下文窗口阈值（窗口 * 安全比例）。
 */
function exceedsCompactionThreshold(estimatedTokens: number, contextWindow: number): boolean {
  return estimatedTokens > contextWindow * COMPACTION_THRESHOLD_RATIO;
}

/**
 * 计算压缩边界：初始为 records.length - K，并向前吸附到干净 turn 起点，
 * 确保活跃区间不以孤立 tool_result 开头、不切断 tool_call/tool_result 配对。
 * 返回 0 表示无法产生有效压缩边界（记录不足或吸附后无可压缩区间）。
 */
function computeCompactionBoundary(records: TranscriptRecord[], keepCount = COMPACTION_RECENT_KEEP_COUNT): number {
  const initial = records.length - keepCount;

  if (initial <= 0) {
    return 0;
  }

  let boundary = initial;

  // 边界落在 tool_result 上意味着会切断它前面的 tool_call，向前移动到该配对之前。
  while (boundary > 0 && records[boundary].role === 'tool_result') {
    boundary -= 1;
  }

  // 此时若 boundary 指向 tool_call，则它与其后的 tool_result 应整体落入活跃区间，继续前移。
  while (boundary > 0 && records[boundary - 1] && records[boundary - 1].role === 'tool_call') {
    boundary -= 1;
  }

  return boundary;
}

/**
 * 构造结构化摘要请求 prompt：要求模型按固定小节模板输出，最大程度保留后续对话所需信息。
 */
function createSummaryInstruction(previousSummary: string): string {
  const base = [
    'You are a conversation history compressor. Compress the history below into a structured summary to be used as background context for later requests.',
    'Output strictly using the following fixed sections; every section heading must be kept; write "None" when a section has no content:',
    '## Background and Goals',
    '## Key Decisions and Conclusions',
    '## Files and Paths Involved',
    '## To-Do Items',
    '## Important Tool Results',
    'Requirements: use concise English, list items as bullet points; drop pleasantries, repetition, and irrelevant details; do not restate the original text verbatim.'
  ].join('\n');

  if (previousSummary.trim() === '') {
    return base;
  }

  return [
    base,
    '',
    'An existing previous summary (merge the new history on top of it and output a single updated complete summary using the same section template):',
    previousSummary
  ].join('\n');
}

/**
 * 把被压缩记录投影为摘要请求可读的纯文本片段。
 */
function renderRecordsForSummary(records: TranscriptRecord[]): string {
  return records
    .filter(shouldIncludeRecordInProviderContext)
    .map((record) => `[${record.role}] ${record.text}`)
    .join('\n');
}

/**
 * 复用 provider agent 发起一次摘要请求，产出单条滚动更新摘要；忽略其工具调用。
 * 摘要是纯文本压缩任务，不需要内置助手 system prompt，仅用摘要指令一条 system。
 */
async function generateCompactionSummary(options: {
  agent: ProviderAgent;
  compactedRecords: TranscriptRecord[];
  previousSummary: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const {agent, compactedRecords, previousSummary, abortSignal} = options;
  const summaryRecords: TranscriptRecord[] = [
    {role: 'system', text: createSummaryInstruction(previousSummary)},
    {role: 'user', text: renderRecordsForSummary(compactedRecords)}
  ];

  throwIfAborted(abortSignal);
  const result: AgentTurnResult = await agent.runTurn(summaryRecords, {}, {abortSignal, isCompaction: true});
  throwIfAborted(abortSignal);

  return result.draft.trim();
}

/**
 * 构造可见压缩提示；runtime 与持久化 transcript 复用同一记录语义以保持索引平行。
 */
function createCompactionNoticeRecord(compaction: CompactionState): TranscriptRecord {
  return {
    role: 'compaction_notice',
    text: `已将较早的 ${compaction.activeStartIndex} 条历史压缩为摘要`
  };
}

/**
 * 可复用的压缩编排核心：估算（非 force）→ 阈值判定（非 force）→ 边界吸附 → 摘要生成。
 * 纯函数式：仅依据入参计算并返回结果，不修改外部状态、不触发回调。
 * force=true 时跳过阈值判定直接压缩，但仍执行边界吸附以保护工具配对。
 */
async function runCompaction(options: {
  records: TranscriptRecord[];
  compaction?: CompactionState;
  anchor?: TokenUsageAnchor | null;
  contextWindow?: number;
  force?: boolean;
  agent: ProviderAgent;
  abortSignal?: AbortSignal;
}): Promise<RunCompactionResult> {
  const {records, compaction, anchor, contextWindow, force = false, agent, abortSignal} = options;
  const activeStartIndex = compaction ? compaction.activeStartIndex : 0;

  throwIfAborted(abortSignal);

  if (!force) {
    const activeRecords = records.slice(activeStartIndex);
    const estimated = estimateContextTokens({
      activeRecords,
      summaryText: compaction ? compaction.summaryText : '',
      anchor
    });

    if (typeof contextWindow !== 'number' || !exceedsCompactionThreshold(estimated, contextWindow)) {
      return {didCompact: false, reason: 'below_threshold'};
    }
  }

  const boundary = computeCompactionBoundary(records);

  if (boundary <= activeStartIndex) {
    return {didCompact: false, reason: 'no_boundary'};
  }

  const newlyCompacted = records.slice(activeStartIndex, boundary);
  const summaryText = await generateCompactionSummary({
    agent,
    abortSignal,
    compactedRecords: newlyCompacted,
    previousSummary: compaction ? compaction.summaryText : ''
  });

  throwIfAborted(abortSignal);

  if (summaryText === '') {
    return {didCompact: false, reason: 'no_boundary'};
  }

  return {
    didCompact: true,
    reason: 'compacted',
    compaction: {
      summaryText,
      activeStartIndex: boundary,
      createdAt: new Date().toISOString()
    }
  };
}

export {
  computeCompactionBoundary,
  createCompactionNoticeRecord,
  estimateContextTokens,
  estimateRecordsTokens,
  estimateTextTokens,
  exceedsCompactionThreshold,
  generateCompactionSummary,
  runCompaction
};

export type {RunCompactionResult, TokenUsageAnchor};

import {COMPACTION_RECENT_KEEP_COUNT, COMPACTION_THRESHOLD_RATIO} from '../../config/llm-config';
import {estimateTextTokens} from './token-estimator';
import {shouldIncludeRecordInProviderContext} from '../transcript-converter-common';
import {throwIfAborted} from '../../types/agent';

import type {AgentTurnResult, ProviderAgent, ProviderUsage} from '../../types/agent';
import type {CompactionState, TranscriptRecord} from '../../types/transcript';

type TokenUsageAnchor = {
  usageInputTokens: number;
  measuredAtRecordCount: number;
};

type RunCompactionResult = {
  didCompact: boolean;
  reason: 'compacted' | 'below_threshold' | 'no_boundary';
  compaction?: CompactionState;
  usage?: ProviderUsage; // 摘要 provider turn 的 usage;未发起摘要请求时缺省。
  usageInputTokens?: number; // 摘要 provider turn 的输入 token 真值;未发起摘要请求时缺省。
};

type CompactionSummaryResult = {
  summaryText: string; // 已 trim 的摘要文本;空字符串表示模型未产出可用摘要。
  usage?: ProviderUsage; // 摘要 provider turn 的 usage。
  usageInputTokens?: number; // 摘要 provider turn 的输入 token 真值。
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
function exceedsCompactionThreshold(estimatedTokens: number, contextWindow: number, thresholdRatio = COMPACTION_THRESHOLD_RATIO): boolean {
  return estimatedTokens > contextWindow * thresholdRatio;
}

/**
 * 计算压缩边界：按 provider-facing records 保留最近 K 条并映射回物理索引，再向前吸附到干净 turn 起点，
 * 确保活跃区间不以孤立 tool_result 开头、不切断 tool_call/tool_result 配对，
 * 且被压缩区间不以孤立 extension（provider reasoning 回传）记录结尾。
 * 返回 0 表示无法产生有效压缩边界（记录不足或吸附后无可压缩区间）。
 */
function computeCompactionBoundary(records: TranscriptRecord[], keepCount = COMPACTION_RECENT_KEEP_COUNT): number {
  const providerRecordIndices = records
    .map((record, index) => shouldIncludeRecordInProviderContext(record) ? index : -1)
    .filter((index) => index >= 0);
  const normalizedKeepCount = Math.max(0, Math.floor(keepCount));
  const initial = normalizedKeepCount === 0
    ? records.length
    : providerRecordIndices.length > normalizedKeepCount
      ? providerRecordIndices[providerRecordIndices.length - normalizedKeepCount]
      : 0;

  if (initial <= 0) {
    return 0;
  }

  let boundary = initial;

  // 三条吸附规则都只向前移动一步：边界落在 tool_result 上会切断它前面的 tool_call；
  // 被压缩区间以 tool_call 结尾会把它与其后的 tool_result 切开；以 extension 结尾会把 reasoning 回传与其后续记录切开。
  // 迭代到不再变化，保证与既有 tool 配对保护共同收敛到稳定边界。
  while (boundary > 0) {
    const currentRecord = records[boundary];
    const previousRecord = records[boundary - 1];

    if (currentRecord?.role === 'tool_result' || previousRecord?.role === 'tool_call' || previousRecord?.role === 'extension') {
      boundary -= 1;
      continue;
    }

    break;
  }

  return boundary;
}

/**
 * 构造结构化摘要请求 prompt：要求模型按固定小节模板输出，最大程度保留后续对话所需信息。
 * 摘要指令位于请求末尾，因此引用的是「上方的历史与既有摘要」；存在旧摘要时只要求滚动合并，不重复嵌入其正文。
 */
function createSummaryInstruction(previousSummary: string): string {
  const base = [
    'You are a conversation history compressor. Compress the earlier messages of this conversation into a structured summary to be used as background context for later requests.',
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
    'The conversation above already opens with an existing summary of the earlier messages. Merge the newly compacted messages into it and output a single updated complete summary using the same section template; do not repeat the existing summary text.'
  ].join('\n');
}

/**
 * 复用 provider agent 发起一次摘要请求，产出单条滚动更新摘要；忽略其工具调用。
 * 输入形态与普通请求对齐：共享前导 → 被压缩记录原生 provider 投影 → 尾部摘要指令 user 消息，
 * 让压缩请求与普通请求共享最长 token 前缀，并把指令放在贴近生成点的位置；extension 记录随原生投影进入，不额外过滤。
 * 摘要请求同时按 `includeToolDefinitions` 携带与普通 turn 同源的工具定义，使工具定义段也进入共享前缀。
 */
async function generateCompactionSummary(options: {
  agent: ProviderAgent;
  prefixRecords: TranscriptRecord[]; // 与同一会话普通请求同源构造的请求前导记录。
  compactedRecords: TranscriptRecord[];
  previousSummary: string;
  sessionId?: string; // 会话稳定身份;透传给 provider 以复用同一缓存路由。
  abortSignal?: AbortSignal;
}): Promise<CompactionSummaryResult> {
  const {agent, prefixRecords, compactedRecords, previousSummary, sessionId, abortSignal} = options;
  const summaryRecords: TranscriptRecord[] = [
    ...prefixRecords,
    ...compactedRecords.filter(shouldIncludeRecordInProviderContext),
    {role: 'user', text: createSummaryInstruction(previousSummary)}
  ];

  throwIfAborted(abortSignal);
  const result: AgentTurnResult = await agent.runTurn(summaryRecords, {}, {
    abortSignal,
    isCompaction: true,
    includeToolDefinitions: true,
    ...(sessionId ? {sessionId} : {})
  });
  throwIfAborted(abortSignal);

  return {
    summaryText: result.draft.trim(),
    ...(result.usage ? {usage: result.usage} : {}),
    ...(typeof result.usageInputTokens === 'number' ? {usageInputTokens: result.usageInputTokens} : {})
  };
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
 * 只要发起过摘要 provider 请求，usage 与 usageInputTokens 就随结果返回（含摘要为空未被采纳的路径）。
 */
async function runCompaction(options: {
  records: TranscriptRecord[];
  compaction?: CompactionState;
  anchor?: TokenUsageAnchor | null;
  contextWindow?: number;
  thresholdRatio?: number;
  force?: boolean;
  agent: ProviderAgent;
  promptPrefix: TranscriptRecord[]; // 与同一会话普通请求同源构造的请求前导记录;摘要请求的 token 0 前缀。
  sessionId?: string; // 会话稳定身份;透传给摘要请求以复用同一缓存路由。
  abortSignal?: AbortSignal;
}): Promise<RunCompactionResult> {
  const {records, compaction, anchor, contextWindow, thresholdRatio = COMPACTION_THRESHOLD_RATIO, force = false, agent, promptPrefix, sessionId, abortSignal} = options;
  const activeStartIndex = compaction ? compaction.activeStartIndex : 0;

  throwIfAborted(abortSignal);

  if (!force) {
    const activeRecords = records.slice(activeStartIndex);
    const estimated = estimateContextTokens({
      activeRecords,
      summaryText: compaction ? compaction.summaryText : '',
      anchor
    });

    if (typeof contextWindow !== 'number' || !exceedsCompactionThreshold(estimated, contextWindow, thresholdRatio)) {
      return {didCompact: false, reason: 'below_threshold'};
    }
  }

  const boundary = computeCompactionBoundary(records);

  if (boundary <= activeStartIndex) {
    return {didCompact: false, reason: 'no_boundary'};
  }

  const newlyCompacted = records.slice(activeStartIndex, boundary);
  const summary = await generateCompactionSummary({
    agent,
    prefixRecords: promptPrefix,
    abortSignal,
    ...(sessionId ? {sessionId} : {}),
    compactedRecords: newlyCompacted,
    previousSummary: compaction ? compaction.summaryText : ''
  });

  throwIfAborted(abortSignal);

  const summaryUsage = {
    ...(summary.usage ? {usage: summary.usage} : {}),
    ...(typeof summary.usageInputTokens === 'number' ? {usageInputTokens: summary.usageInputTokens} : {})
  };

  if (summary.summaryText === '') {
    return {didCompact: false, reason: 'no_boundary', ...summaryUsage};
  }

  return {
    didCompact: true,
    reason: 'compacted',
    compaction: {
      summaryText: summary.summaryText,
      activeStartIndex: boundary,
      createdAt: new Date().toISOString()
    },
    ...summaryUsage
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

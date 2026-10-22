import {COMPACTION_RECENT_KEEP_COUNT, COMPACTION_THRESHOLD_RATIO} from '../../config/llm-config';
import {estimateTextTokens} from './token-estimator';
import {boundConversationImages, DEFAULT_CONVERSATION_IMAGE_BYTES, estimateRecordImageTokens, getConversationImageBytes} from './conversation-image-budget';
import {shouldIncludeRecordInProviderContext} from '../transcript-converter-common';
import {throwIfAborted} from '../../types/agent';

import type {AgentTurnResult, ProviderAgent, ProviderUsage} from '../../types/agent';
import type {CompactionState, TranscriptRecord} from '../../types/transcript';

type TokenUsageAnchor = {
  usageInputTokens: number; // provider 测得的当前请求输入 token 真值。
  measuredAtRecordCount: number; // 测量时的活跃记录数量，不是完整历史位置。
};

type RunCompactionResult = {
  didCompact: boolean; // 是否产出可被调用方采纳的非空摘要及新边界。
  reason: 'compacted' | 'below_threshold' | 'no_boundary'; // 未压缩时区分预算充足与无可用边界。
  compaction?: CompactionState; // 新摘要及完整历史坐标，调用方持久化成功后才采纳。
  usage?: ProviderUsage; // 摘要 provider turn 的 usage;未发起摘要请求时缺省。
  usageInputTokens?: number; // 摘要 provider turn 的输入 token 真值;未发起摘要请求时缺省。
};

type CompactionSummaryResult = {
  summaryText: string; // 已 trim 的摘要文本;空字符串表示模型未产出可用摘要。
  usage?: ProviderUsage; // 摘要 provider turn 的 usage。
  usageInputTokens?: number; // 摘要 provider turn 的输入 token 真值。
};

/**
 * 估算一组记录的文本与模型可见图片 token 总量，含摘要文本。
 * 跳过不会发送给 provider 的 role（error、compaction_notice），避免高估上下文长度。
 */
function estimateRecordsTokens(records: TranscriptRecord[], summaryText = ''): number {
  let total = summaryText ? estimateTextTokens(summaryText) : 0;

  for (const record of records) {
    if (!shouldIncludeRecordInProviderContext(record)) {
      continue;
    }

    total += estimateTextTokens(record.role === 'extension' ? JSON.stringify(record.extension) : record.text);
    total += estimateRecordImageTokens(record);
  }

  return total;
}

/**
 * 综合预估当前上下文 token 数：有适用 usage 锚点时叠加新增记录的文本及图片估算；
 * 无锚点时估算全部活跃文本及图片。
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
  const result: AgentTurnResult = await agent.runTurn(boundConversationImages(summaryRecords).records, {}, {
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
/** 成功压缩提示的文案模板；判定函数复用同一模板，消费方不得自行拼接或匹配本文案。 */
function createCompactionSummaryNoticeText(compactedCount: number): string {
  return `已将较早的 ${compactedCount} 条历史压缩为摘要`;
}

/** 判定一条记录是否为成功压缩提示：反解计数后用同一模板重新生成，避免两处格式定义漂移。 */
function isCompactionSummaryNotice(record: TranscriptRecord): boolean {
  if (record.role !== 'compaction_notice') {
    return false;
  }

  const compactedCount = /^已将较早的 (\d+) 条历史压缩为摘要$/.exec(record.text)?.[1];
  return compactedCount !== undefined && createCompactionSummaryNoticeText(Number(compactedCount)) === record.text;
}

function createCompactionNoticeRecord(compaction: CompactionState): TranscriptRecord {
  return {
    role: 'compaction_notice',
    text: createCompactionSummaryNoticeText(compaction.activeStartIndex)
  };
}

/**
 * 可复用的压缩编排核心：估算（非 force）→ 阈值判定（非 force）→ 边界吸附 → 摘要生成。
 * 纯函数式：仅依据入参计算并返回结果，不修改外部状态、不触发回调。
 * force=true 时跳过阈值判定直接压缩，但仍执行边界吸附以保护工具配对。
 * records 可为完整快照或驻留后缀；baseRecordIndex 只参与局部下标与完整边界转换。
 * 只要发起过摘要 provider 请求，usage 与 usageInputTokens 就随结果返回（含摘要为空未被采纳的路径）。
 */
async function runCompaction(options: {
  records: TranscriptRecord[]; // 连续驻留记录或尚未裁剪的完整快照；本函数不修改它。
  baseRecordIndex?: number; // 驻留数组第一条的完整历史位置，完整快照缺省为 0。
  compaction?: CompactionState; // 旧摘要及完整历史中的活跃起点。
  anchor?: TokenUsageAnchor | null; // 当前活跃区间的 usage 真值锚点。
  contextWindow?: number; // 非强制压缩时采用的模型窗口。
  thresholdRatio?: number; // 自动压缩触发比例，不改变图片预算。
  force?: boolean; // 只跳过阈值检查，不跳过工具配对保护。
  agent: ProviderAgent; // 执行原生摘要请求的 provider。
  promptPrefix: TranscriptRecord[]; // 与同一会话普通请求同源构造的请求前导记录;摘要请求的 token 0 前缀。
  sessionId?: string; // 会话稳定身份;透传给摘要请求以复用同一缓存路由。
  abortSignal?: AbortSignal; // 采纳之前取消时不返回新摘要。
}): Promise<RunCompactionResult> {
  const {records, baseRecordIndex = 0, compaction, anchor, contextWindow, thresholdRatio = COMPACTION_THRESHOLD_RATIO, force = false, agent, promptPrefix, sessionId, abortSignal} = options;
  const activeStartIndex = Math.max(0, (compaction?.activeStartIndex ?? baseRecordIndex) - baseRecordIndex);

  throwIfAborted(abortSignal);

  if (!force) {
    const activeRecords = records.slice(activeStartIndex);
    const estimated = estimateContextTokens({
      activeRecords,
      summaryText: compaction ? compaction.summaryText : '',
      anchor
    });

    if ((typeof contextWindow !== 'number' || !exceedsCompactionThreshold(estimated, contextWindow, thresholdRatio)) &&
        getConversationImageBytes(activeRecords) <= DEFAULT_CONVERSATION_IMAGE_BYTES) {
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
      activeStartIndex: baseRecordIndex + boundary,
      createdAt: new Date().toISOString()
    },
    ...summaryUsage
  };
}

export {
  computeCompactionBoundary,
  createCompactionNoticeRecord,
  createCompactionSummaryNoticeText,
  estimateContextTokens,
  estimateRecordsTokens,
  estimateTextTokens,
  exceedsCompactionThreshold,
  generateCompactionSummary,
  isCompactionSummaryNotice,
  runCompaction
};

export type {RunCompactionResult, TokenUsageAnchor};

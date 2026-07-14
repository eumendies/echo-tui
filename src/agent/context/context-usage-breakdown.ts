import {estimateJsonTokens, estimateTextTokens} from './token-estimator';
import {formatShellRecordForProvider, shouldIncludeRecordInProviderContext} from '../transcript-converter-common';

import type {ContextUsageSegment, ContextUsageSegmentCategory} from '../../types/agent';
import type {ToolDefinition} from '../../types/tool';
import {ANTHROPIC_THINKING_TRANSCRIPT_ROLE, OPENAI_CHAT_REASONING_TRANSCRIPT_ROLE, OPENAI_REASONING_TRANSCRIPT_ROLE, type TranscriptRecord} from '../../types/transcript';

type EstimatedContextUsageSegment = {
  category: ContextUsageSegmentCategory;
  estimatedTokens: number;
};

const CONTEXT_USAGE_SEGMENT_ORDER: ContextUsageSegmentCategory[] = [
  'system',
  'memory',
  'skills',
  'tools',
  'messages',
  'reasoning'
];

/**
 * 基于 provider request 快照估算各类上下文占用；分类保持固定顺序，便于渲染和测试。
 */
function estimateContextUsageSegments(records: TranscriptRecord[], toolDefinitions: ToolDefinition[] = [], skillCatalogTokens = 0, memoryTokens = 0): EstimatedContextUsageSegment[] {
  const totals = new Map<ContextUsageSegmentCategory, number>(CONTEXT_USAGE_SEGMENT_ORDER.map((category) => [category, 0]));
  let countedSkills = false;

  if (toolDefinitions.length > 0) {
    addTokens(totals, 'tools', estimateJsonTokens(toolDefinitions));
  }

  for (const record of records) {
    const category = getRecordContextUsageCategory(record);

    if (!category) {
      continue;
    }

    const tokens = estimateRecordContextTokens(record, category);

    if (category === 'system' && !countedSkills && (skillCatalogTokens > 0 || memoryTokens > 0)) {
      addTokens(totals, 'system', Math.max(0, tokens - skillCatalogTokens - memoryTokens));
      addTokens(totals, 'memory', memoryTokens);
      addTokens(totals, 'skills', skillCatalogTokens);
      countedSkills = true;
      continue;
    }

    addTokens(totals, category, tokens);
  }

  return CONTEXT_USAGE_SEGMENT_ORDER.map((category) => ({
    category,
    estimatedTokens: totals.get(category) || 0
  }));
}

/**
 * 将本地估算分布校准到 provider 返回的真实总量，保证 UI 展示口径一致。
 */
function calibrateContextUsageSegments(segments: EstimatedContextUsageSegment[], usedTokens: number): ContextUsageSegment[] {
  const targetTotal = Math.max(0, Math.floor(usedTokens));
  const estimatedTotal = segments.reduce((sum, segment) => sum + Math.max(0, segment.estimatedTokens), 0);

  if (targetTotal === 0 || estimatedTotal <= 0) {
    return segments.map((segment) => ({category: segment.category, tokens: 0}));
  }

  const raw = segments.map((segment) => {
    const value = Math.max(0, segment.estimatedTokens) / estimatedTotal * targetTotal;
    return {
      segment,
      value,
      floor: Math.floor(value)
    };
  });
  const leftover = targetTotal - raw.reduce((sum, item) => sum + item.floor, 0);
  const increments = new Map<ContextUsageSegmentCategory, number>();

  for (const item of [...raw].sort((left, right) => (right.value - right.floor) - (left.value - left.floor)).slice(0, leftover)) {
    increments.set(item.segment.category, (increments.get(item.segment.category) || 0) + 1);
  }

  return raw.map((item) => ({
    category: item.segment.category,
    tokens: item.floor + (increments.get(item.segment.category) || 0)
  }));
}

function addTokens(totals: Map<ContextUsageSegmentCategory, number>, category: ContextUsageSegmentCategory, tokens: number): void {
  totals.set(category, (totals.get(category) || 0) + tokens);
}

function getRecordContextUsageCategory(record: TranscriptRecord): ContextUsageSegmentCategory | null {
  if (record.role === OPENAI_REASONING_TRANSCRIPT_ROLE) {
    return 'reasoning';
  }

  if (record.role === OPENAI_CHAT_REASONING_TRANSCRIPT_ROLE) {
    return 'reasoning';
  }

  if (record.role === ANTHROPIC_THINKING_TRANSCRIPT_ROLE) {
    return 'reasoning';
  }

  if (!shouldIncludeRecordInProviderContext(record)) {
    return null;
  }

  if (record.role === 'system') {
    return 'system';
  }

  if (record.role === 'tool_call' || record.role === 'tool_result') {
    return 'tools';
  }

  if (record.role === 'user' || record.role === 'assistant' || record.role === 'shell') {
    return 'messages';
  }

  return null;
}

function estimateRecordContextTokens(record: TranscriptRecord, category: ContextUsageSegmentCategory): number {
  if (record.role === 'tool_call') {
    return estimateJsonTokens({name: record.toolName, arguments: record.argumentsText});
  }

  if (record.role === 'shell' && category === 'messages') {
    return estimateTextTokens(formatShellRecordForProvider(record));
  }

  if (record.role === OPENAI_REASONING_TRANSCRIPT_ROLE) {
    return estimateJsonTokens(record.item || record.text);
  }

  if (record.role === OPENAI_CHAT_REASONING_TRANSCRIPT_ROLE) {
    return estimateTextTokens(typeof record.reasoningContent === 'string' ? record.reasoningContent : record.text);
  }

  if (record.role === ANTHROPIC_THINKING_TRANSCRIPT_ROLE) {
    return estimateJsonTokens(record.block || record.text);
  }

  return estimateTextTokens(record.text);
}

export {
  CONTEXT_USAGE_SEGMENT_ORDER,
  calibrateContextUsageSegments,
  estimateContextUsageSegments
};

export type {
  EstimatedContextUsageSegment
};

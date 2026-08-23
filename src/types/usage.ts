import type {AgentType, InteractionMode} from './agent';

export type UsageEventInput = {
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  contextWindow?: number;
  cwdHash: string;
  inputTokens?: number;
  interactionMode?: InteractionMode;
  model: string;
  outputTokens?: number;
  providerType: AgentType;
  timestamp?: string;
};

export type UsageEvent = {
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  contextWindow?: number;
  cwdHash: string;
  id: string;
  inputTokens: number;
  interactionMode?: InteractionMode;
  localDay: string;
  model: string;
  outputTokens: number;
  providerType: AgentType;
  schemaVersion: 1;
  timestamp: string;
  totalTokens: number;
  uncachedInputTokens: number;
};

export type UsageDailyAggregate = {
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  eventCount: number;
  hitRate: number;
  inputTokens: number;
  localDay: string;
  outputTokens: number;
  totalTokens: number;
  uncachedInputTokens: number;
};

export type UsageQueryOptions = {
  cwdHash?: string;
  fromDay?: string;
  limitDays?: number;
  toDay?: string;
};

export type UsageStore = {
  appendEvent(event: UsageEventInput): UsageEvent | null;
  listDailyUsage(options?: UsageQueryOptions): UsageDailyAggregate[];
};

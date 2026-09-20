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
  providerId?: string; // 解析后配置 provider 的非敏感 ID；缺省时由读取端回退 providerType。
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
  providerId?: string; // 新账本行使用的配置 provider ID；历史行可合法缺失。
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

export type UsageModelAggregate = {
  cacheCreationInputTokens: number; // 该 provider/模型组合的缓存创建输入 token 合计。
  cacheReadInputTokens: number; // 该 provider/模型组合的缓存命中输入 token 合计。
  eventCount: number; // 纳入该聚合项的 provider usage event 数量。
  hitRate: number; // 缓存命中输入 token 占输入 token 的比例；无输入时为 0。
  inputTokens: number; // 该 provider/模型组合的输入 token 合计。
  model: string; // provider 返回并持久化的模型标识，不在聚合层改写。
  outputTokens: number; // 该 provider/模型组合的输出 token 合计。
  providerId: string; // 用于展示与聚合的 provider 身份；新 event 来自配置 ID，历史 event 回退 providerType。
  providerType: AgentType; // 模型所属 provider 适配器类型；保留为历史 event 回退和诊断事实。
  share: number; // 该项总 token 占同一查询范围全部模型总 token 的比例；无总量时为 0。
  totalTokens: number; // 该 provider/模型组合的输入与输出 token 总计。
  uncachedInputTokens: number; // 该 provider/模型组合的未命中输入 token 合计。
};

export type UsageQueryOptions = {
  cwdHash?: string;
  fromDay?: string;
  limitDays?: number;
  model?: string;
  providerId?: string;
  providerType?: AgentType;
  toDay?: string;
};

export type UsageStore = {
  appendEvent(event: UsageEventInput): UsageEvent | null;
  listDailyUsage(options?: UsageQueryOptions): UsageDailyAggregate[];
  listModelUsage(options?: UsageQueryOptions): UsageModelAggregate[];
};

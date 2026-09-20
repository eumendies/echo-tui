import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {UsageDailyAggregate, UsageEvent, UsageEventInput, UsageModelAggregate, UsageQueryOptions, UsageStore} from '../types/usage';

const USAGE_SCHEMA_VERSION = 1;

function createUsageCwdHash(cwd: string): string {
  return crypto.createHash('sha1').update(String(cwd)).digest('hex');
}

type UsageStoreOptions = {
  cryptoImpl?: Pick<typeof crypto, 'randomBytes'>;
  fsImpl?: Pick<typeof fs, 'appendFileSync' | 'existsSync' | 'mkdirSync' | 'readFileSync' | 'readdirSync'>;
  now?: () => Date;
  osImpl?: Pick<typeof os, 'homedir'>;
  rootDir?: string;
};

/**
 * 创建 token usage 账本；事件按本地日期分月追加到 JSONL，读取时可聚合每日或单日模型用量。
 */
function createUsageStore(options: UsageStoreOptions = {}): UsageStore {
  const fsImpl = options.fsImpl || fs;
  const cryptoImpl = options.cryptoImpl || crypto;
  const osImpl = options.osImpl || os;
  const now = options.now || (() => new Date());
  const rootDir = options.rootDir || path.join(osImpl.homedir(), '.echo', 'echo_tui', 'usage');

  /**
   * 追加一条 provider usage event；没有任何 token 事实时不写入。
   */
  function appendEvent(input: UsageEventInput): UsageEvent | null {
    const timestamp = normalizeTimestamp(input.timestamp, now);
    const event = createUsageEvent(input, timestamp, createEventId(timestamp, cryptoImpl));

    if (!event) {
      return null;
    }

    const filePath = getMonthFilePath(rootDir, event.localDay);

    fsImpl.mkdirSync(path.dirname(filePath), {recursive: true});
    fsImpl.appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf8');
    return event;
  }

  /**
   * 读取账本并按本地日期聚合；调用方可限制项目、日期范围和返回天数。
   */
  function listDailyUsage(query: UsageQueryOptions = {}): UsageDailyAggregate[] {
    const daily = new Map<string, UsageDailyAggregate>();

    for (const event of queryUsageEvents(rootDir, fsImpl, query)) {
      const current = daily.get(event.localDay) || createEmptyDailyAggregate(event.localDay);
      current.eventCount += 1;
      current.inputTokens += event.inputTokens;
      current.cacheReadInputTokens += event.cacheReadInputTokens;
      current.cacheCreationInputTokens += event.cacheCreationInputTokens;
      current.uncachedInputTokens += event.uncachedInputTokens;
      current.outputTokens += event.outputTokens;
      current.totalTokens += event.totalTokens;
      daily.set(event.localDay, current);
    }

    const result = Array.from(daily.values())
      .sort((left, right) => left.localDay.localeCompare(right.localDay))
      .map((entry) => ({
        ...entry,
        hitRate: entry.inputTokens > 0 ? entry.cacheReadInputTokens / entry.inputTokens : 0
      }));

    return result;
  }

  /**
   * 读取账本并按 provider 类型和模型标识聚合；同名模型在不同 provider 中保持独立。
   */
  function listModelUsage(query: UsageQueryOptions = {}): UsageModelAggregate[] {
    const models = new Map<string, UsageModelAggregate>();

    for (const event of queryUsageEvents(rootDir, fsImpl, query)) {
      const providerId = resolveEventProviderId(event);
      const key = createModelKey(providerId, event.model);
      const current = models.get(key) || createEmptyModelAggregate(event.providerType, providerId, event.model);
      current.eventCount += 1;
      current.inputTokens += event.inputTokens;
      current.cacheReadInputTokens += event.cacheReadInputTokens;
      current.cacheCreationInputTokens += event.cacheCreationInputTokens;
      current.uncachedInputTokens += event.uncachedInputTokens;
      current.outputTokens += event.outputTokens;
      current.totalTokens += event.totalTokens;
      models.set(key, current);
    }

    const totalTokens = Array.from(models.values()).reduce((total, entry) => total + entry.totalTokens, 0);

    return Array.from(models.values())
      .map((entry) => ({
        ...entry,
        hitRate: entry.inputTokens > 0 ? entry.cacheReadInputTokens / entry.inputTokens : 0,
        share: totalTokens > 0 ? entry.totalTokens / totalTokens : 0
      }))
      .sort(compareModelUsage);
  }

  return {appendEvent, listDailyUsage, listModelUsage};
}

function createUsageEvent(input: UsageEventInput, timestamp: string, id: string): UsageEvent | null {
  const inputTokens = normalizeTokenCount(input.inputTokens);
  const cacheReadInputTokens = normalizeTokenCount(input.cacheReadInputTokens);
  const cacheCreationInputTokens = normalizeTokenCount(input.cacheCreationInputTokens);
  const outputTokens = normalizeTokenCount(input.outputTokens);
  const providerId = normalizeProviderId(input.providerId);

  if (inputTokens === 0 && cacheReadInputTokens === 0 && cacheCreationInputTokens === 0 && outputTokens === 0) {
    return null;
  }

  const totalInputTokens = Math.max(inputTokens, cacheReadInputTokens + cacheCreationInputTokens);
  const uncachedInputTokens = Math.max(0, totalInputTokens - cacheReadInputTokens);

  return {
    schemaVersion: USAGE_SCHEMA_VERSION,
    id,
    timestamp,
    localDay: formatLocalDay(new Date(timestamp)),
    cwdHash: String(input.cwdHash),
    providerType: input.providerType,
    ...(providerId ? {providerId} : {}),
    model: String(input.model),
    ...(input.interactionMode ? {interactionMode: input.interactionMode} : {}),
    inputTokens: totalInputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    uncachedInputTokens,
    outputTokens,
    totalTokens: totalInputTokens + outputTokens,
    ...(typeof input.contextWindow === 'number' && Number.isFinite(input.contextWindow) ? {contextWindow: Math.max(0, Math.floor(input.contextWindow))} : {})
  };
}

function readUsageEvents(rootDir: string, fsImpl: NonNullable<UsageStoreOptions['fsImpl']>): UsageEvent[] {
  if (!fsImpl.existsSync(rootDir)) {
    return [];
  }

  return fsImpl.readdirSync(rootDir)
    .filter((fileName) => /^\d{4}-\d{2}\.jsonl$/.test(fileName))
    .sort()
    .flatMap((fileName) => readUsageEventFile(path.join(rootDir, fileName), fsImpl));
}

function queryUsageEvents(rootDir: string, fsImpl: NonNullable<UsageStoreOptions['fsImpl']>, query: UsageQueryOptions): UsageEvent[] {
  const events = readUsageEvents(rootDir, fsImpl).filter((event) => matchesQuery(event, query));

  const limitDays = typeof query.limitDays === 'number' && Number.isFinite(query.limitDays)
    ? Math.floor(query.limitDays)
    : 0;

  if (limitDays <= 0) {
    return events;
  }

  const days = Array.from(new Set(events.map((event) => event.localDay))).sort();
  const firstIncludedDay = days[Math.max(0, days.length - limitDays)];

  return firstIncludedDay ? events.filter((event) => event.localDay >= firstIncludedDay) : [];
}

function readUsageEventFile(filePath: string, fsImpl: NonNullable<UsageStoreOptions['fsImpl']>): UsageEvent[] {
  try {
    return fsImpl.readFileSync(filePath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map(parseUsageEventLine)
      .filter((event): event is UsageEvent => event !== null);
  } catch (_error: unknown) {
    return [];
  }
}

function parseUsageEventLine(line: string): UsageEvent | null {
  try {
    const parsed = JSON.parse(line) as unknown;

    if (!isUsageEventShape(parsed)) {
      return null;
    }

    return parsed;
  } catch (_error: unknown) {
    return null;
  }
}

function isUsageEventShape(value: unknown): value is UsageEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const event = value as Partial<UsageEvent>;

  return (
    event.schemaVersion === USAGE_SCHEMA_VERSION &&
    typeof event.id === 'string' &&
    typeof event.timestamp === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(event.localDay || '')) &&
    typeof event.cwdHash === 'string' &&
    typeof event.model === 'string' &&
    typeof event.providerType === 'string' &&
    (event.interactionMode === undefined || typeof event.interactionMode === 'string') &&
    (event.providerId === undefined || (typeof event.providerId === 'string' && event.providerId.trim() !== '')) &&
    isNonNegativeNumber(event.inputTokens) &&
    isNonNegativeNumber(event.cacheReadInputTokens) &&
    isNonNegativeNumber(event.cacheCreationInputTokens) &&
    isNonNegativeNumber(event.uncachedInputTokens) &&
    isNonNegativeNumber(event.outputTokens) &&
    isNonNegativeNumber(event.totalTokens)
  );
}

function matchesQuery(event: UsageEvent, query: UsageQueryOptions): boolean {
  if (query.cwdHash && event.cwdHash !== query.cwdHash) {
    return false;
  }

  if (query.providerType && event.providerType !== query.providerType) {
    return false;
  }

  if (query.providerId && resolveEventProviderId(event) !== query.providerId) {
    return false;
  }

  if (query.model && event.model !== query.model) {
    return false;
  }

  if (query.fromDay && event.localDay < query.fromDay) {
    return false;
  }

  return !(query.toDay && event.localDay > query.toDay);
}

function createEmptyDailyAggregate(localDay: string): UsageDailyAggregate {
  return {
    localDay,
    inputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    hitRate: 0,
    eventCount: 0
  };
}

function createEmptyModelAggregate(providerType: UsageEvent['providerType'], providerId: string, model: string): UsageModelAggregate {
  return {
    providerType,
    providerId,
    model,
    inputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    hitRate: 0,
    eventCount: 0,
    share: 0
  };
}

function createModelKey(providerId: string, model: string): string {
  return `${providerId}\u0000${model}`;
}

function compareModelUsage(left: UsageModelAggregate, right: UsageModelAggregate): number {
  if (left.totalTokens !== right.totalTokens) {
    return right.totalTokens - left.totalTokens;
  }

  if (left.providerId !== right.providerId) {
    return left.providerId < right.providerId ? -1 : 1;
  }

  if (left.model === right.model) {
    return 0;
  }

  return left.model < right.model ? -1 : 1;
}

function resolveEventProviderId(event: Pick<UsageEvent, 'providerId' | 'providerType'>): string {
  return normalizeProviderId(event.providerId) || event.providerType;
}

function normalizeProviderId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function normalizeTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeTimestamp(value: unknown, now: () => Date): string {
  if (typeof value === 'string') {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return now().toISOString();
}

function createEventId(timestamp: string, cryptoImpl: Pick<typeof crypto, 'randomBytes'>): string {
  return `${timestamp.replace(/[:.]/g, '-')}-${cryptoImpl.randomBytes(3).toString('hex')}`;
}

function getMonthFilePath(rootDir: string, localDay: string): string {
  return path.join(rootDir, `${localDay.slice(0, 7)}.jsonl`);
}

function formatLocalDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export {
  createUsageCwdHash,
  createUsageEvent,
  createUsageStore,
  formatLocalDay
};

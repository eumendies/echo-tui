import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {UsageDailyAggregate, UsageEvent, UsageEventInput, UsageQueryOptions, UsageStore} from '../types/usage';

const USAGE_SCHEMA_VERSION = 1;

type UsageStoreOptions = {
  cryptoImpl?: Pick<typeof crypto, 'randomBytes'>;
  fsImpl?: Pick<typeof fs, 'appendFileSync' | 'existsSync' | 'mkdirSync' | 'readFileSync' | 'readdirSync'>;
  now?: () => Date;
  osImpl?: Pick<typeof os, 'homedir'>;
  rootDir?: string;
};

/**
 * 创建 token usage 账本；事件按本地日期分月追加到 JSONL，读取时聚合为每日用量。
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

    for (const event of readUsageEvents(rootDir, fsImpl)) {
      if (!matchesQuery(event, query)) {
        continue;
      }

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

    return typeof query.limitDays === 'number' && query.limitDays > 0 ? result.slice(-Math.floor(query.limitDays)) : result;
  }

  return {appendEvent, listDailyUsage};
}

function createUsageEvent(input: UsageEventInput, timestamp: string, id: string): UsageEvent | null {
  const inputTokens = normalizeTokenCount(input.inputTokens);
  const cacheReadInputTokens = normalizeTokenCount(input.cacheReadInputTokens);
  const cacheCreationInputTokens = normalizeTokenCount(input.cacheCreationInputTokens);
  const outputTokens = normalizeTokenCount(input.outputTokens);

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
    model: String(input.model),
    interactionMode: input.interactionMode,
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
    typeof event.interactionMode === 'string' &&
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
  createUsageEvent,
  createUsageStore,
  formatLocalDay
};

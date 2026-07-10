import fs from 'node:fs';
import path from 'node:path';

import {getDefaultUserConfigPath, readOptionalUserConfig} from '../config/user-config';
import {LIFECYCLE_HOOK_EVENTS} from '../types/hooks';

import type {ReadUserConfigOptions, UserConfigSource} from '../config/user-config';
import type {
  LifecycleHookConfig,
  LifecycleHookConfigDiagnostic,
  LifecycleHookConfigDraft,
  LifecycleHookDraftEntry,
  LifecycleHookEventName
} from '../types/hooks';

const DEFAULT_HOOK_TIMEOUT_MS = 5_000;
const MIN_HOOK_TIMEOUT_MS = 100;
const MAX_HOOK_TIMEOUT_MS = 30_000;

const EVENT_SET = new Set<string>(LIFECYCLE_HOOK_EVENTS);

type LifecycleHookConfigDraftOptions = ReadUserConfigOptions & {
  createTempPath?: (targetPath: string) => string;
  mkdir?: typeof fs.mkdirSync;
  rename?: typeof fs.renameSync;
  writeFile?: typeof fs.writeFileSync;
};
type HookDraftEntryParseResult =
  | {entry: LifecycleHookDraftEntry; ok: true}
  | {message: string; ok: false};
type LifecycleHookCommandValidation =
  | {ok: true; value: string}
  | {message: string; ok: false};
type LifecycleHookFieldValidation =
  | {ok: true}
  | {message: string; ok: false};
type LifecycleHookTimeoutParseResult =
  | {ok: true; value: number}
  | {message: string; ok: false};

/**
 * 读取用户级 hooks 配置；hooks 是可选增强能力，配置错误只会让对应 entry 失效。
 */
function readLifecycleHookConfig(options: ReadUserConfigOptions = {}): LifecycleHookConfig {
  return parseLifecycleHookConfig(readOptionalUserConfig(options));
}

function parseLifecycleHookConfig(rootConfig: UserConfigSource): LifecycleHookConfig {
  return createLifecycleHookRuntimeConfigFromDraft(parseLifecycleHookConfigDraftRoot(rootConfig, ''));
}

/**
 * 读取 hooks 管理草稿；与 runtime parser 不同，这里保留 disabled entries 和诊断摘要。
 */
function readLifecycleHookConfigDraft(options: ReadUserConfigOptions = {}): LifecycleHookConfigDraft {
  const configPath = options.configPath || getDefaultLifecycleHookConfigPath();
  return parseLifecycleHookConfigDraftRoot(readOptionalUserConfig(options), configPath);
}

function parseLifecycleHookConfigDraftRoot(rootConfig: UserConfigSource, configPath: string): LifecycleHookConfigDraft {
  const diagnostics: LifecycleHookConfigDiagnostic[] = [];
  const events = LIFECYCLE_HOOK_EVENTS.map((event) => ({event, entries: [] as LifecycleHookDraftEntry[]}));
  const eventDraftByName = new Map(events.map((eventDraft) => [eventDraft.event, eventDraft]));
  const hooks = rootConfig.hooks;

  if (hooks === undefined || hooks === null) {
    return {configPath, diagnostics, events};
  }

  if (!isPlainObject(hooks)) {
    diagnostics.push({message: 'hooks 配置必须是对象，已忽略'});
    return {configPath, diagnostics, events};
  }

  for (const [eventName, rawEntries] of Object.entries(hooks)) {
    if (!isLifecycleHookEventName(eventName)) {
      diagnostics.push({event: eventName, message: '未知 hook event，已忽略'});
      continue;
    }

    if (!Array.isArray(rawEntries)) {
      diagnostics.push({event: eventName, message: 'hook entries 必须是数组，已忽略'});
      continue;
    }

    const eventDraft = eventDraftByName.get(eventName);

    for (const [index, rawEntry] of rawEntries.entries()) {
      const result = parseHookDraftEntry(rawEntry);

      if (result.ok) {
        eventDraft?.entries.push(result.entry);
        continue;
      }

      diagnostics.push({event: eventName, index, message: result.message});
    }
  }

  return {configPath, diagnostics, events};
}

/**
 * 保存 hooks 管理草稿；只替换 root hooks 节点，避免改写其它用户配置。
 */
function saveLifecycleHookConfigDraft(draft: LifecycleHookConfigDraft, options: LifecycleHookConfigDraftOptions = {}): void {
  const validation = validateLifecycleHookConfigDraft(draft);

  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const targetPath = options.configPath || draft.configPath || getDefaultLifecycleHookConfigPath();
  const readFile = options.readFile || fs.readFileSync;
  const mkdir = options.mkdir || fs.mkdirSync;
  const writeFile = options.writeFile || fs.writeFileSync;
  const rename = options.rename || fs.renameSync;
  const createTempPath = options.createTempPath || ((pathName: string) => `${pathName}.tmp-${process.pid}-${Date.now()}`);
  const rootConfig = readUserConfigForSave({configPath: targetPath, readFile});
  const hooks = createLifecycleHookConfigNodeFromDraft(draft);

  if (Object.keys(hooks).length > 0) {
    rootConfig.hooks = hooks;
  } else {
    delete rootConfig.hooks;
  }

  const tempPath = createTempPath(targetPath);
  mkdir(path.dirname(targetPath), {recursive: true});
  writeFile(tempPath, `${JSON.stringify(rootConfig, null, 2)}\n`);
  rename(tempPath, targetPath);
}

function createLifecycleHookRuntimeConfigFromDraft(draft: LifecycleHookConfigDraft): LifecycleHookConfig {
  const config: LifecycleHookConfig = {};

  for (const eventDraft of draft.events) {
    const entries = eventDraft.entries
      .filter((entry) => entry.enabled)
      .map((entry) => ({command: entry.command.trim(), timeoutMs: entry.timeoutMs}));

    if (entries.length > 0) {
      config[eventDraft.event] = entries;
    }
  }

  return config;
}

function createLifecycleHookConfigNodeFromDraft(draft: LifecycleHookConfigDraft): Record<string, Array<{command: string; enabled?: boolean; timeoutMs: number}>> {
  const hooks: Record<string, Array<{command: string; enabled?: boolean; timeoutMs: number}>> = {};

  for (const eventDraft of draft.events) {
    if (!isLifecycleHookEventName(eventDraft.event)) {
      continue;
    }

    const entries = eventDraft.entries.map((entry) => ({
      command: entry.command.trim(),
      timeoutMs: entry.timeoutMs,
      ...(entry.enabled ? {} : {enabled: false})
    }));

    if (entries.length > 0) {
      hooks[eventDraft.event] = entries;
    }
  }

  return hooks;
}

function getDefaultLifecycleHookConfigPath(): string {
  return getDefaultUserConfigPath();
}

function validateLifecycleHookConfigDraft(draft: LifecycleHookConfigDraft): {error: string; ok: false} | {ok: true} {
  for (const eventDraft of draft.events) {
    if (!isLifecycleHookEventName(eventDraft.event)) {
      return {ok: false, error: `未知 hook event: ${eventDraft.event}`};
    }

    for (const [index, entry] of eventDraft.entries.entries()) {
      const commandValidation = validateLifecycleHookCommand(entry.command);

      if (!commandValidation.ok) {
        return {ok: false, error: `${eventDraft.event} #${index + 1} ${commandValidation.message}`};
      }

      const timeoutValidation = validateLifecycleHookTimeoutMs(entry.timeoutMs);

      if (!timeoutValidation.ok) {
        return {ok: false, error: `${eventDraft.event} #${index + 1} ${timeoutValidation.message}`};
      }
    }
  }

  return {ok: true};
}

function isLifecycleHookEventName(value: string): value is LifecycleHookEventName {
  return EVENT_SET.has(value);
}

function parseHookDraftEntry(rawEntry: unknown): HookDraftEntryParseResult {
  if (typeof rawEntry === 'string') {
    return createHookDraftEntry(rawEntry, undefined, true);
  }

  if (!isPlainObject(rawEntry)) {
    return {ok: false, message: 'hook entry 必须是字符串或对象'};
  }

  const enabled = readOptionalBoolean(rawEntry.enabled);

  if (!enabled.ok) {
    return {ok: false, message: 'enabled 必须是 boolean'};
  }

  return createHookDraftEntry(rawEntry.command, rawEntry.timeoutMs, enabled.value);
}

function createHookDraftEntry(command: unknown, timeoutMs: unknown, enabled: boolean): HookDraftEntryParseResult {
  const commandValidation = validateLifecycleHookCommand(command);

  if (!commandValidation.ok) {
    return commandValidation;
  }

  const parsedTimeoutMs = readOptionalLifecycleHookTimeoutMs(timeoutMs);

  if (!parsedTimeoutMs.ok) {
    return parsedTimeoutMs;
  }

  return {
    ok: true,
    entry: {
      command: commandValidation.value,
      enabled,
      timeoutMs: parsedTimeoutMs.value
    }
  };
}

function validateLifecycleHookCommand(command: unknown): LifecycleHookCommandValidation {
  if (typeof command !== 'string' || command.trim() === '') {
    return {ok: false, message: 'command 不能为空'};
  }

  return {ok: true, value: command.trim()};
}

function validateLifecycleHookTimeoutMs(timeoutMs: unknown): LifecycleHookFieldValidation {
  if (!isIntegerInRange(timeoutMs, MIN_HOOK_TIMEOUT_MS, MAX_HOOK_TIMEOUT_MS)) {
    return {ok: false, message: `timeoutMs 必须在 ${MIN_HOOK_TIMEOUT_MS}-${MAX_HOOK_TIMEOUT_MS} 之间`};
  }

  return {ok: true};
}

function readOptionalLifecycleHookTimeoutMs(value: unknown): LifecycleHookTimeoutParseResult {
  if (value === undefined || value === null || value === '') {
    return {ok: true, value: DEFAULT_HOOK_TIMEOUT_MS};
  }

  const validation = validateLifecycleHookTimeoutMs(value);

  if (!validation.ok) {
    return validation;
  }

  return {ok: true, value: value as number};
}

function readOptionalBoolean(value: unknown): {ok: true; value: boolean} | {ok: false} {
  if (value === undefined || value === null) {
    return {ok: true, value: true};
  }

  return typeof value === 'boolean' ? {ok: true, value} : {ok: false};
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function readUserConfigForSave(options: ReadUserConfigOptions = {}): UserConfigSource {
  const configPath = options.configPath || getDefaultLifecycleHookConfigPath();
  const readFile = options.readFile || fs.readFileSync;
  let rawConfig: string;

  try {
    rawConfig = readFile(configPath, 'utf8');
  } catch (error: unknown) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? (error as {code?: unknown}).code : undefined;

    if (code === 'ENOENT') {
      return {};
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法读取 hooks 配置文件：${message}`);
  }

  try {
    const parsed: unknown = JSON.parse(rawConfig);

    if (isPlainObject(parsed)) {
      return {...parsed};
    }
  } catch {
    throw new Error(`hooks 配置文件不是有效 JSON：${configPath}`);
  }

  throw new Error(`hooks 配置文件根节点必须是对象：${configPath}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export {
  DEFAULT_HOOK_TIMEOUT_MS,
  createLifecycleHookRuntimeConfigFromDraft,
  getDefaultLifecycleHookConfigPath,
  MAX_HOOK_TIMEOUT_MS,
  MIN_HOOK_TIMEOUT_MS,
  parseLifecycleHookConfig,
  readLifecycleHookConfig,
  readLifecycleHookConfigDraft,
  saveLifecycleHookConfigDraft,
  validateLifecycleHookCommand,
  validateLifecycleHookConfigDraft,
  validateLifecycleHookTimeoutMs
};

export type {
  LifecycleHookConfigDraftOptions
};

import {LIFECYCLE_HOOK_EVENTS} from '../types/hooks';

import type {UserConfigSource} from '../config/user-config';
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

function parseLifecycleHookConfig(rootConfig: UserConfigSource): LifecycleHookConfig {
  return createLifecycleHookRuntimeConfigFromDraft(parseLifecycleHookConfigDraft(rootConfig, ''));
}

function parseLifecycleHookConfigDraft(rootConfig: UserConfigSource, configPath: string): LifecycleHookConfigDraft {
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

/** 将 hooks 草稿替换到最新根对象；空草稿移除 hooks 节点。 */
function applyLifecycleHookConfigDraft(rootConfig: UserConfigSource, draft: LifecycleHookConfigDraft): void {
  const validation = validateLifecycleHookConfigDraft(draft);

  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const hooks = createLifecycleHookConfigNodeFromDraft(draft);
  if (Object.keys(hooks).length > 0) {
    rootConfig.hooks = hooks;
  } else {
    delete rootConfig.hooks;
  }
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export {
  DEFAULT_HOOK_TIMEOUT_MS,
  applyLifecycleHookConfigDraft,
  createLifecycleHookRuntimeConfigFromDraft,
  MAX_HOOK_TIMEOUT_MS,
  MIN_HOOK_TIMEOUT_MS,
  parseLifecycleHookConfig,
  parseLifecycleHookConfigDraft,
  validateLifecycleHookCommand,
  validateLifecycleHookConfigDraft,
  validateLifecycleHookTimeoutMs
};

import {createAgentLoopRuntime} from '../agent/agent-loop-runtime';
import {redactSensitiveText} from '../agent/agent-errors';
import {createDebugContext} from '../debug/debug-context';
import {readLifecycleHookConfig} from '../hooks/config';
import {createLifecycleHookDispatcher} from '../hooks/dispatcher';
import {McpManager} from '../mcp/manager';
import {createUsageStore} from '../persistence/usage-store';
import {isAbortError} from '../types/agent';

import type {RunAgent} from '../types/agent';
import type {DebugContext} from '../debug/debug-context';
import type {LifecycleHookDispatcher} from '../types/hooks';
import type {UsageStore} from '../types/usage';
import type {McpManager as McpManagerType} from '../mcp/manager';

type HeadlessOutput = Pick<NodeJS.WriteStream, 'write'>;

type HeadlessSignalSource = Pick<NodeJS.Process, 'once' | 'removeListener'>;

type RunOnceOptions = {
  abortSignal?: AbortSignal;
  cwd?: string;
  debug?: DebugContext;
  fullAccess?: boolean;
  hooks?: LifecycleHookDispatcher;
  mcpManager?: McpManagerType;
  process?: HeadlessSignalSource;
  runAgent?: RunAgent;
  stdout?: HeadlessOutput;
  usageStore?: UsageStore;
  prompt: string;
};

/**
 * 执行一次不依赖 TTY 的 agent turn；只在成功且资源清理完成后写入最终文本。
 */
async function runOnce(options: RunOnceOptions): Promise<void> {
  const prompt = options.prompt;

  if (prompt.trim() === '') {
    throw new Error('--once requires a non-empty prompt');
  }

  const cwd = options.cwd || process.cwd();
  const stdout = options.stdout || process.stdout;
  const mcpManager = options.mcpManager || new McpManager();
  const debug = options.debug || createDebugContext({cwd});
  const hooks = options.hooks || createLifecycleHookDispatcher({
    config: readLifecycleHookConfig(),
    cwd
  });
  const usageStore = options.usageStore || createUsageStore();
  const runAgent = options.runAgent || createAgentLoopRuntime(cwd, mcpManager, hooks, debug, usageStore);
  const abortController = new AbortController();
  const signalSource = options.process || process;
  const onSignal = () => abortController.abort();
  const onExternalAbort = () => abortController.abort();
  let primaryError: unknown;
  let finalText: string | null = null;
  let turnStarted = false;

  signalSource.once('SIGINT', onSignal);
  signalSource.once('SIGTERM', onSignal);

  if (options.abortSignal) {
    if (options.abortSignal.aborted) {
      abortController.abort();
    } else {
      options.abortSignal.addEventListener('abort', onExternalAbort, {once: true});
    }
  }

  try {
    await mcpManager.bootstrap();
    hooks.emit('assistant_turn_start', {
      interactionMode: 'normal',
      status: 'started'
    });
    turnStarted = true;
    const result = await runAgent({
      abortSignal: abortController.signal,
      executionMode: {
        kind: 'headless',
        approvalPolicy: options.fullAccess ? 'full-access' : 'deny'
      },
      interactionMode: 'normal',
      records: [{role: 'user', text: prompt}]
    });

    if (typeof result !== 'string') {
      throw new Error('Agent did not return final assistant text');
    }

    finalText = result;
    hooks.emit('assistant_turn_end', {
      interactionMode: 'normal',
      status: 'completed'
    });
  } catch (error: unknown) {
    primaryError = error;
    emitHeadlessTurnFailure(hooks, abortController.signal, error, turnStarted);
    throw createHeadlessError(error);
  } finally {
    if (options.abortSignal) {
      options.abortSignal.removeEventListener('abort', onExternalAbort);
    }

    signalSource.removeListener('SIGINT', onSignal);
    signalSource.removeListener('SIGTERM', onSignal);
    const cleanupError = await cleanupHeadlessResources(mcpManager, debug);

    if (!primaryError && cleanupError) {
      throw createHeadlessError(cleanupError);
    }
  }

  if (finalText === null) {
    throw new Error('Agent did not return final assistant text');
  }

  stdout.write(`${stripAnsiControlSequences(finalText)}\n`);
}

/**
 * 关闭单轮运行创建的可关闭资源；hook dispatcher 是旁路队列，不阻塞最终输出。
 */
async function cleanupHeadlessResources(mcpManager: McpManager, debug: DebugContext): Promise<unknown | null> {
  let firstError: unknown = null;

  try {
    await mcpManager.close();
  } catch (error: unknown) {
    firstError ||= error;
  }

  try {
    debug.close();
  } catch (error: unknown) {
    firstError ||= error;
  }

  return firstError;
}

/**
 * 将单轮失败映射为与 TUI 相同的 assistant lifecycle hook，避免旁路观察丢失结束事实。
 */
function emitHeadlessTurnFailure(hooks: LifecycleHookDispatcher, abortSignal: AbortSignal, error: unknown, turnStarted: boolean): void {
  if (!turnStarted) {
    return;
  }

  if (isAbortError(error) || abortSignal.aborted) {
    hooks.emit('assistant_turn_cancelled', {
      interactionMode: 'normal',
      status: 'cancelled'
    });
    return;
  }

  hooks.emit('assistant_turn_error', {
    interactionMode: 'normal',
    status: 'error',
    errorName: error instanceof Error ? error.name : undefined,
    errorMessage: error instanceof Error ? error.message : String(error)
  });
}

function createHeadlessError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(redactSensitiveText(message));
}

function stripAnsiControlSequences(text: string): string {
  return text
    .replace(/\u001B\][\s\S]*?(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

export {
  runOnce,
  stripAnsiControlSequences
};

export type {
  HeadlessOutput,
  RunOnceOptions
};

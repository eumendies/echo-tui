import {spawn} from 'node:child_process';

import type {
  LifecycleHookExecutorInput,
  LifecycleHookPayload,
  LifecycleHookSyntheticPayloadOptions,
  LifecycleHookTestResult
} from '../types/hooks';
import type {ChildProcess} from 'node:child_process';

const HOOK_TEST_OUTPUT_LIMIT_BYTES = 4096;

/**
 * 为 /hooks 测试构造稳定 payload；该函数不派发真实 lifecycle event。
 */
function createLifecycleHookSyntheticPayload(options: LifecycleHookSyntheticPayloadOptions): LifecycleHookPayload {
  const timestamp = (options.now || (() => new Date()))().toISOString();
  const interactionMode = options.interactionMode || 'normal';
  const base = {
    event: options.event,
    timestamp,
    cwd: options.cwd
  };

  switch (options.event) {
    case 'assistant_turn_start':
      return {...base, interactionMode, status: 'started'};
    case 'assistant_turn_end':
      return {...base, interactionMode, status: 'completed'};
    case 'assistant_turn_error':
      return {...base, interactionMode, status: 'error', errorName: 'HookTestError', errorMessage: 'synthetic hook test error'};
    case 'assistant_turn_cancelled':
      return {...base, interactionMode, status: 'cancelled'};
    case 'tool_call_start':
      return {...base, toolCallId: 'hook-test-call', toolName: 'hook_test', argumentsText: '{}'};
    case 'tool_call_end':
      return {...base, toolCallId: 'hook-test-call', toolName: 'hook_test', ok: true};
    case 'compaction_end':
      return {...base, activeStartIndex: 0, createdAt: timestamp};
  }
}

/**
 * 执行单条 hook 的 synthetic test；复用 runtime 的 cwd/env/stdin/timeout 契约，但捕获有界输出。
 */
function executeLifecycleHookSyntheticTest(input: LifecycleHookExecutorInput): Promise<LifecycleHookTestResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const stdout = createBoundedOutputCollector(HOOK_TEST_OUTPUT_LIMIT_BYTES);
    const stderr = createBoundedOutputCollector(HOOK_TEST_OUTPUT_LIMIT_BYTES);
    const payloadText = JSON.stringify(input.payload);
    let settled = false;
    let timedOut = false;
    let child: ChildProcess;
    let timeout: NodeJS.Timeout | undefined;

    function finish(result: Omit<LifecycleHookTestResult, 'durationMs' | 'stderr' | 'stderrTruncated' | 'stdout' | 'stdoutTruncated'>): void {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }

      resolve({
        ...result,
        durationMs: Math.max(0, Date.now() - startTime),
        stderr: stderr.text(),
        stderrTruncated: stderr.truncated(),
        stdout: stdout.text(),
        stdoutTruncated: stdout.truncated()
      });
    }

    try {
      child = spawn(input.entry.command, {
        cwd: input.cwd,
        env: {
          ...process.env,
          ECHO_HOOK_EVENT: input.payload.event,
          ECHO_HOOK_CWD: input.cwd
        },
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error: unknown) {
      finish({ok: false, error: normalizeErrorMessage(error)});
      return;
    }

    timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.entry.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer | string) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer | string) => stderr.push(chunk));
    child.on('error', (error: Error) => {
      finish({ok: false, error: normalizeErrorMessage(error)});
    });
    child.on('close', (exitCode: number | null) => {
      finish({
        ok: !timedOut && exitCode === 0,
        exitCode,
        ...(timedOut ? {timedOut} : {})
      });
    });

    child.stdin?.end(payloadText);
  });
}

function createBoundedOutputCollector(limitBytes: number): {push(chunk: Buffer | string): void; text(): string; truncated(): boolean} {
  const chunks: Buffer[] = [];
  let collected = 0;
  let didTruncate = false;

  return {
    push(chunk: Buffer | string): void {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, limitBytes - collected);

      if (buffer.length > remaining) {
        didTruncate = true;
        if (remaining > 0) {
          chunks.push(buffer.subarray(0, remaining));
          collected += remaining;
        }
        return;
      }

      chunks.push(buffer);
      collected += buffer.length;
    },
    text(): string {
      return Buffer.concat(chunks).toString('utf8');
    },
    truncated(): boolean {
      return didTruncate;
    }
  };
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : 'Hook test failed';
}

export {
  HOOK_TEST_OUTPUT_LIMIT_BYTES,
  createLifecycleHookSyntheticPayload,
  executeLifecycleHookSyntheticTest
};

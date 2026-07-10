import {spawn} from 'node:child_process';

import type {LifecycleHookExecutor, LifecycleHookExecutorInput, LifecycleHookExecutorResult} from '../types/hooks';
import type {ChildProcess} from 'node:child_process';

const createSubprocessLifecycleHookExecutor = (): LifecycleHookExecutor => executeLifecycleHookSubprocess;

/**
 * 以非交互子进程执行 hook；输出被忽略，避免污染 TUI、transcript 或模型上下文。
 */
function executeLifecycleHookSubprocess(input: LifecycleHookExecutorInput): Promise<LifecycleHookExecutorResult> {
  return new Promise((resolve) => {
    const payloadText = JSON.stringify(input.payload);
    let settled = false;
    let timedOut = false;
    let child: ChildProcess;
    let timeout: NodeJS.Timeout | undefined;

    function finish(result: LifecycleHookExecutorResult): void {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve(result);
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
        stdio: ['pipe', 'ignore', 'ignore']
      });
    } catch (error: unknown) {
      finish({ok: false, error: normalizeErrorMessage(error)});
      return;
    }

    timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.entry.timeoutMs);

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

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : 'Hook execution failed';
}

export {
  createSubprocessLifecycleHookExecutor,
  executeLifecycleHookSubprocess
};

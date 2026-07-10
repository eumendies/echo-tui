import {createSubprocessLifecycleHookExecutor} from './executor';

import type {
  LifecycleHookConfig,
  LifecycleHookDispatcher,
  LifecycleHookEventName,
  LifecycleHookExecutor,
  LifecycleHookPayload,
  LifecycleHookPayloadData
} from '../types/hooks';

type CreateLifecycleHookDispatcherOptions = {
  config?: LifecycleHookConfig;
  cwd: string | (() => string);
  executor?: LifecycleHookExecutor;
  now?: () => Date;
};

/**
 * 创建旁路 hook dispatcher；emit 只排队后台任务，主流程不等待 hook 结果。
 */
function createLifecycleHookDispatcher(options: CreateLifecycleHookDispatcherOptions): LifecycleHookDispatcher {
  let config = cloneLifecycleHookConfig(options.config || {});
  const executor = options.executor || createSubprocessLifecycleHookExecutor();
  const now = options.now || (() => new Date());
  let tail: Promise<unknown> = Promise.resolve();

  function resolveCwd(): string {
    return typeof options.cwd === 'function' ? options.cwd() : options.cwd;
  }

  function emit(event: LifecycleHookEventName, data: LifecycleHookPayloadData = {}): void {
    const entries = (config[event] || []).map((entry) => ({...entry}));

    if (!entries || entries.length === 0) {
      return;
    }

    const cwd = resolveCwd();
    const payload: LifecycleHookPayload = {
      event,
      timestamp: now().toISOString(),
      cwd,
      ...data
    };

    for (const entry of entries) {
      tail = tail
        .then(() => executor({entry, payload, cwd}))
        .catch(() => ({ok: false}));
    }
  }

  return {
    emit,
    flush() {
      return tail.then(() => undefined);
    },
    updateConfig(nextConfig: LifecycleHookConfig) {
      // reload 只替换后续 emit 的配置快照，不触碰已经排队的子进程任务。
      config = cloneLifecycleHookConfig(nextConfig);
    }
  };
}

function cloneLifecycleHookConfig(config: LifecycleHookConfig): LifecycleHookConfig {
  const next: LifecycleHookConfig = {};

  for (const [eventName, entries] of Object.entries(config)) {
    if (!entries || entries.length === 0) {
      continue;
    }

    next[eventName as LifecycleHookEventName] = entries.map((entry) => ({...entry}));
  }

  return next;
}

export {
  createLifecycleHookDispatcher
};

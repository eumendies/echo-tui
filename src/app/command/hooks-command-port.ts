import {createLifecycleHookRuntimeConfigFromDraft, readLifecycleHookConfigDraft, saveLifecycleHookConfigDraft} from '../../hooks/config';
import {createLifecycleHookSyntheticPayload, executeLifecycleHookSyntheticTest} from '../../hooks/synthetic-test';

import type {LifecycleHookDispatcher} from '../../types/hooks';
import type {InteractionMode} from '../../types/agent';
import type {CommandHostApp} from '../../types/command';

type HooksCommandPortOptions = {
  cwd: () => string;
  getInteractionMode: () => InteractionMode;
  hooks?: LifecycleHookDispatcher;
};

/**
 * 创建 lifecycle hook 配置和合成测试端口。
 */
function createHooksCommandPort(options: HooksCommandPortOptions): CommandHostApp['hooks'] {
  return {
    readDraft() {
      return readLifecycleHookConfigDraft();
    },
    saveDraft(draft) {
      try {
        const nextConfig = createLifecycleHookRuntimeConfigFromDraft(draft);
        saveLifecycleHookConfigDraft(draft);
        options.hooks?.updateConfig(nextConfig);
        return {ok: true};
      } catch (error: unknown) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },
    testEntry(event, entry) {
      const payload = createLifecycleHookSyntheticPayload({
        cwd: options.cwd(),
        event,
        interactionMode: options.getInteractionMode()
      });
      return executeLifecycleHookSyntheticTest({
        cwd: options.cwd(),
        entry,
        payload
      });
    }
  };
}

export {
  createHooksCommandPort
};

export type {
  HooksCommandPortOptions
};

import {createLifecycleHookSyntheticPayload, executeLifecycleHookSyntheticTest} from '../../hooks/synthetic-test';
import type {UserConfigContext} from '../../config/user-config-context';
import type {LifecycleHookDispatcher} from '../../types/hooks';
import type {InteractionMode} from '../../types/agent';
import type {CommandHostApp} from '../../types/command';

type HooksCommandPortOptions = {
  cwd: () => string;
  getInteractionMode: () => InteractionMode;
  hooks: LifecycleHookDispatcher;
  userConfigContext: UserConfigContext;
};

/**
 * 创建 lifecycle hook 配置和合成测试端口。
 */
function createHooksCommandPort(options: HooksCommandPortOptions): CommandHostApp['hooks'] {
  const userConfigContext = options.userConfigContext;
  return {
    readDraft() {
      return userConfigContext.capture().getLifecycleHookConfigDraft();
    },
    saveDraft(draft) {
      try {
        const saved = userConfigContext.saveLifecycleHookConfigDraft(draft);
        options.hooks.updateConfig(saved.snapshot.getLifecycleHookConfig());
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

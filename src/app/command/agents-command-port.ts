import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {findProjectRoot} from '../../agent/agent-instructions';
import {createAgentManagementStore} from '../../agent/subagent/management-store';
import {BUILTIN_SUBAGENT_DEFINITIONS} from '../../agent/subagent/definition';
import {
  deleteBuiltinSubagentOverride,
  readAgentsSettingsScope,
  selectBuiltinSubagentOverride,
  writeBuiltinSubagentOverride
} from '../../agent/subagent/settings';

import type {AgentUserConfigSnapshot} from '../../types/agent';
import type {CommandAgentBuiltinInfo, CommandHostApp} from '../../types/command';
import type {AgentsSettingsScopeReadResult, BuiltinSubagentName} from '../../agent/subagent/settings';

type AgentsCommandPortOptions = {
  captureUserConfigSnapshot: () => AgentUserConfigSnapshot; // 每次管理操作捕获当前用户配置 revision。
  cwd: () => string; // 当前 app 工作目录，用于重新发现项目根。
  homedir?: () => string; // 用户 agents 根目录的测试替换缝。
  stat?: (filePath: string) => fs.Stats; // 项目 marker 检查的测试替换缝。
};

/**
 * 创建 Agent 管理受控端口；文件路径只由当前 cwd、项目根、scope 与合法名称构造。
 */
function createAgentsCommandPort(options: AgentsCommandPortOptions): CommandHostApp['agents'] {
  const homedir = options.homedir || os.homedir;
  const stat = options.stat || fs.statSync;

  /** 为单次端口调用捕获一致的 cwd、项目根与用户配置 snapshot。 */
  function createOperationContext() {
    const currentHome = path.resolve(homedir());
    const currentCwd = path.resolve(options.cwd());
    const projectRoot = path.resolve(findProjectRoot(currentCwd, currentHome, stat) || currentCwd);
    const configSnapshot = options.captureUserConfigSnapshot();
    const storeOptions = {configSnapshot, homedir: currentHome, projectRoot};
    return {
      configSnapshot,
      store: createAgentManagementStore(storeOptions),
      storeOptions
    };
  }

  /** 按共享 fail-closed 选择规则投影内置定义，并同时报告失效模型引用。 */
  function createBuiltinProjection(
    overrides: readonly Readonly<AgentsSettingsScopeReadResult>[],
    modelProfileIds: ReadonlySet<string>
  ): {builtins: CommandAgentBuiltinInfo[]; diagnostics: Array<{code: string; message: string}>} {
    const diagnostics: Array<{code: string; message: string}> = [];
    const builtins = BUILTIN_SUBAGENT_DEFINITIONS.map((definition): CommandAgentBuiltinInfo => {
      const name = definition.name as BuiltinSubagentName;
      let selected = selectBuiltinSubagentOverride(name, overrides);
      if (selected?.override.modelProfileId && !modelProfileIds.has(selected.override.modelProfileId)) {
        diagnostics.push({
          code: 'builtin_model_profile_not_found',
          message: `Built-in Agent ${name} references missing model profile "${selected.override.modelProfileId}" and will inherit the parent policy.`
        });
        selected = undefined;
      }

      return {
        capability: definition.executionPolicy === 'readonly_investigation' ? 'readonly' : 'general',
        description: definition.description,
        effort: selected?.override.effort || 'inherit',
        includeMcpTools: definition.includeMcpTools,
        localToolNames: [...definition.localToolNames],
        ...(selected?.override.modelProfileId ? {modelProfileId: selected.override.modelProfileId} : {}),
        name
      };
    });
    return {builtins, diagnostics};
  }

  return {
    list() {
      const context = createOperationContext();
      const management = context.store.list();
      const models = (() => {
        try {
          return context.configSnapshot.getLlmModelConfigInfo().models.map((profile) => ({id: profile.id}));
        } catch {
          return [];
        }
      })();
      const overrides = Object.freeze([
        readAgentsSettingsScope('user', context.storeOptions),
        readAgentsSettingsScope('project', context.storeOptions)
      ]);
      const builtinProjection = createBuiltinProjection(overrides, new Set(models.map((model) => model.id)));
      const diagnostics = [
        ...management.diagnostics,
        ...overrides.flatMap((source) => source.status === 'invalid' && source.error ? [source.error] : []),
        ...builtinProjection.diagnostics
      ];
      return {
        builtins: builtinProjection.builtins,
        diagnostics,
        items: [...management.items],
        models,
        overrides
      };
    },
    validate(scope, name, draft) {
      return createOperationContext().store.validate(scope, name, draft);
    },
    create(scope, name, draft) {
      return createOperationContext().store.create(scope, name, draft);
    },
    update(scope, name, draft, expectedFingerprint) {
      return createOperationContext().store.update(scope, name, draft, expectedFingerprint);
    },
    delete(scope, name, expectedFingerprint) {
      return createOperationContext().store.remove(scope, name, expectedFingerprint);
    },
    writeBuiltinOverride(scope, name, override, expectedFingerprint) {
      const context = createOperationContext();
      return writeBuiltinSubagentOverride(scope, name, override, expectedFingerprint, context.storeOptions);
    },
    deleteBuiltinOverride(scope, name, expectedFingerprint) {
      const context = createOperationContext();
      return deleteBuiltinSubagentOverride(scope, name, expectedFingerprint, context.storeOptions);
    }
  };
}

export {createAgentsCommandPort};
export type {AgentsCommandPortOptions};

import path from 'node:path';

import {createSkillRegistry, getDefaultUserSkillsDir} from './skill-registry';
import {SKILL_STATE_SCHEMA_VERSION, createSkillStateStore} from './skill-state';

import type {SkillListItem, SkillLoadResult, SkillManager} from '../types/skill';
import type {SkillRegistryOptions} from './skill-registry';
import type {SkillStateFile, SkillStateStoreOptions} from './skill-state';

type SkillManagerOptions = SkillRegistryOptions & SkillStateStoreOptions;

/**
 * 组合原始 skill discovery 与 root 状态，向 provider、tool 和 slash command 暴露一致的生效视图。
 */
function createSkillManager(options: SkillManagerOptions = {}): SkillManager {
  const registry = createSkillRegistry(options);
  const stateStore = createSkillStateStore(options);
  const stateByRoot = new Map<string, SkillStateFile>();
  const userSkillsRoot = options.userSkillsDir || getDefaultUserSkillsDir();

  function getState(rootDir: string): SkillStateFile {
    const cached = stateByRoot.get(rootDir);

    if (cached) {
      return cached;
    }

    const state = stateStore.readState(rootDir);
    stateByRoot.set(rootDir, state);
    return state;
  }

  function listSkills(): SkillListItem[] {
    return registry.listCatalog().map((entry) => {
      const state = getState(getSkillStateRoot(entry.sourceKind, entry.sourcePath, userSkillsRoot));

      return {
        ...entry,
        enabled: !state.disabled.includes(entry.name),
        modelProfileId: state.modelOverrides[entry.name],
        reasoningEffortOverride: state.effortOverrides[entry.name]
      };
    });
  }

  function listEnabledCatalog() {
    return listSkills()
      .filter((skill) => skill.enabled)
      .map(({enabled: _enabled, modelProfileId: _modelProfileId, reasoningEffortOverride: _reasoningEffortOverride, ...entry}) => entry);
  }

  function loadSkill(name: string): SkillLoadResult {
    const normalizedName = name.trim();
    const skill = listSkills().find((entry) => entry.name === normalizedName);

    if (skill && !skill.enabled) {
      return {
        ok: false,
        reason: 'disabled',
        message: `Skill "${normalizedName}" is disabled. Enable it with /skills.`,
        availableSkills: listEnabledCatalog()
      };
    }

    const result = registry.loadSkill(normalizedName);

    if (!result.ok) {
      return {...result, availableSkills: listEnabledCatalog()};
    }

    return {
      ...result,
      ...(skill?.modelProfileId ? {modelProfileId: skill.modelProfileId} : {}),
      ...(skill?.reasoningEffortOverride ? {reasoningEffortOverride: skill.reasoningEffortOverride} : {})
    };
  }

  return {
    listCatalog: listEnabledCatalog,
    listSkills,
    loadSkill,
    saveSkillStates(skills: SkillListItem[]): void {
      const nextStateByRoot = new Map<string, Pick<SkillStateFile, 'disabled' | 'effortOverrides' | 'modelOverrides'>>();

      for (const skill of skills) {
        const rootDir = getSkillStateRoot(skill.sourceKind, skill.sourcePath, userSkillsRoot);

        if (!nextStateByRoot.has(rootDir)) {
          nextStateByRoot.set(rootDir, {disabled: [], effortOverrides: {}, modelOverrides: {}});
        }

        const state = nextStateByRoot.get(rootDir);

        if (!skill.enabled) {
          state?.disabled.push(skill.name);
        }

        if (skill.modelProfileId) {
          state!.modelOverrides[skill.name] = skill.modelProfileId;
        }

        if (skill.reasoningEffortOverride) {
          state!.effortOverrides[skill.name] = skill.reasoningEffortOverride;
        }
      }

      for (const [rootDir, state] of nextStateByRoot) {
        stateStore.writeState(rootDir, state);
        stateByRoot.set(rootDir, {
          schemaVersion: SKILL_STATE_SCHEMA_VERSION,
          disabled: [...state.disabled],
          effortOverrides: {...state.effortOverrides},
          modelOverrides: {...state.modelOverrides}
        });
      }
    }
  };
}

function getSkillStateRoot(sourceKind: SkillListItem['sourceKind'], sourcePath: string, userSkillsRoot: string): string {
  return sourceKind === 'builtin' ? userSkillsRoot : getSkillRootFromSourcePath(sourcePath);
}

function getSkillRootFromSourcePath(sourcePath: string): string {
  return path.dirname(path.dirname(sourcePath));
}

export {
  createSkillManager,
  getSkillRootFromSourcePath,
  getSkillStateRoot
};

export type {SkillManagerOptions};

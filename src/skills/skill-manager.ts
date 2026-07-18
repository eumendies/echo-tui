import path from 'node:path';

import {createSkillRegistry} from './skill-registry';
import {createSkillStateStore} from './skill-state';

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
      const state = getState(getSkillRootFromSourcePath(entry.sourcePath));

      return {
        ...entry,
        enabled: !state.disabled.includes(entry.name),
        modelProfileId: state.modelOverrides[entry.name]
      };
    });
  }

  function listEnabledCatalog() {
    return listSkills()
      .filter((skill) => skill.enabled)
      .map(({enabled: _enabled, modelProfileId: _modelProfileId, ...entry}) => entry);
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

    return {...result, modelProfileId: skill?.modelProfileId};
  }

  return {
    listCatalog: listEnabledCatalog,
    listSkills,
    loadSkill,
    saveSkillStates(skills: SkillListItem[]): void {
      const nextStateByRoot = new Map<string, Pick<SkillStateFile, 'disabled' | 'modelOverrides'>>();

      for (const skill of skills) {
        const rootDir = getSkillRootFromSourcePath(skill.sourcePath);

        if (!nextStateByRoot.has(rootDir)) {
          nextStateByRoot.set(rootDir, {disabled: [], modelOverrides: {}});
        }

        const state = nextStateByRoot.get(rootDir);

        if (!skill.enabled) {
          state?.disabled.push(skill.name);
        }

        if (skill.modelProfileId) {
          state!.modelOverrides[skill.name] = skill.modelProfileId;
        }
      }

      for (const [rootDir, state] of nextStateByRoot) {
        stateStore.writeState(rootDir, state);
        stateByRoot.set(rootDir, {
          schemaVersion: 2,
          disabled: [...state.disabled],
          modelOverrides: {...state.modelOverrides}
        });
      }
    }
  };
}

function getSkillRootFromSourcePath(sourcePath: string): string {
  return path.dirname(path.dirname(sourcePath));
}

export {
  createSkillManager,
  getSkillRootFromSourcePath
};

export type {SkillManagerOptions};

import path from 'node:path';

import {createSkillRegistry} from './skill-registry';
import {createSkillStateStore} from './skill-state';

import type {SkillListItem, SkillLoadResult, SkillManager} from '../types/skill';
import type {SkillRegistryOptions} from './skill-registry';
import type {SkillStateStoreOptions} from './skill-state';

type SkillManagerOptions = SkillRegistryOptions & SkillStateStoreOptions;

/**
 * 组合原始 skill discovery 与启用状态，向 provider、tool 和 slash command 暴露一致的 enabled 视图。
 */
function createSkillManager(options: SkillManagerOptions = {}): SkillManager {
  const registry = createSkillRegistry(options);
  const stateStore = createSkillStateStore(options);
  const disabledByRoot = new Map<string, Set<string>>();

  function getDisabled(rootDir: string): Set<string> {
    const cached = disabledByRoot.get(rootDir);

    if (cached) {
      return cached;
    }

    const disabled = stateStore.readDisabled(rootDir);
    disabledByRoot.set(rootDir, disabled);
    return disabled;
  }

  function listSkills(): SkillListItem[] {
    return registry.listCatalog().map((entry) => ({
      ...entry,
      enabled: !getDisabled(getSkillRootFromSourcePath(entry.sourcePath)).has(entry.name)
    }));
  }

  function listEnabledCatalog() {
    return listSkills()
      .filter((skill) => skill.enabled)
      .map(({enabled: _enabled, ...entry}) => entry);
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

    return result;
  }

  return {
    listCatalog: listEnabledCatalog,
    listSkills,
    loadSkill,
    saveSkillStates(skills: SkillListItem[]): void {
      const disabledNamesByRoot = new Map<string, string[]>();

      for (const skill of skills) {
        const rootDir = getSkillRootFromSourcePath(skill.sourcePath);

        if (!disabledNamesByRoot.has(rootDir)) {
          disabledNamesByRoot.set(rootDir, []);
        }

        if (!skill.enabled) {
          disabledNamesByRoot.get(rootDir)?.push(skill.name);
        }
      }

      for (const [rootDir, disabledNames] of disabledNamesByRoot) {
        stateStore.writeDisabled(rootDir, disabledNames);
        disabledByRoot.set(rootDir, new Set(disabledNames));
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

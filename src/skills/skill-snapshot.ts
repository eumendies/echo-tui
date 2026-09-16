import type {SkillCatalogEntry, SkillDefinition, SkillLoadResult, SkillManager, SkillRegistry} from '../types/skill';

// primary run 冻结的 Skill 视图；结构与 SkillRegistry 相同，类型名表达“捕获时刻快照”的领域语义。
type SkillSnapshot = SkillRegistry;

/**
 * 在 primary run 初始化时物化不可变 Skill 快照：catalog、正文、资源和 enabled 状态都固定为当前值。
 * 运行中执行 /skills、修改 SKILL.md 或替换资源只影响下一次 primary run，不改变已捕获快照。
 */
function captureSkillSnapshot(manager: SkillManager): SkillSnapshot {
  const items = manager.listSkills().map((item) => Object.freeze({...item}));
  const itemsByName = new Map(items.map((item) => [item.name, item]));
  const definitionsByName = new Map<string, SkillDefinition>();
  for (const item of items) {
    if (!item.enabled) {
      continue;
    }
    const loaded = manager.loadSkill(item.name);
    if (loaded.ok) {
      definitionsByName.set(item.name, {...loaded.skill, resources: [...loaded.skill.resources]});
    }
  }
  const enabledCatalog: readonly SkillCatalogEntry[] = Object.freeze(
    Array.from(definitionsByName.values())
      .map(({name, description, sourceKind, sourcePath}) => Object.freeze({name, description, sourceKind, sourcePath}))
      .sort((left, right) => left.name.localeCompare(right.name))
  );
  const cloneCatalog = (): SkillCatalogEntry[] => enabledCatalog.map((entry) => ({...entry}));

  return {
    listCatalog: cloneCatalog,
    loadSkill(name: string): SkillLoadResult {
      const normalizedName = name.trim();
      const item = itemsByName.get(normalizedName);
      if (!item) {
        return {ok: false, reason: 'missing', message: `Unknown skill: ${normalizedName}`, availableSkills: cloneCatalog()};
      }
      if (!item.enabled) {
        return {ok: false, reason: 'disabled', message: `Skill "${normalizedName}" is disabled. Enable it with /skills.`, availableSkills: cloneCatalog()};
      }
      const definition = definitionsByName.get(normalizedName)!;
      return {
        ok: true,
        skill: {...definition, resources: [...definition.resources]},
        ...(item.modelProfileId ? {modelProfileId: item.modelProfileId} : {}),
        ...(item.reasoningEffortOverride ? {reasoningEffortOverride: item.reasoningEffortOverride} : {})
      };
    }
  };
}

/**
 * 按冻结定义的三态 Skill 策略从同一父快照派生只读 scoped registry。
 * undefined 暴露快照中全部 enabled 条目；空数组恒为空；非空数组只保留名称交集。
 */
function createScopedSkillRegistry(snapshot: SkillSnapshot, skillNames: readonly string[] | undefined): SkillRegistry {
  const enabledCatalog = snapshot.listCatalog();
  const allowedNames = skillNames === undefined
    ? new Set(enabledCatalog.map((entry) => entry.name))
    : new Set(skillNames.filter((name) => enabledCatalog.some((entry) => entry.name === name)));
  const scopedCatalog = enabledCatalog.filter((entry) => allowedNames.has(entry.name));
  const cloneCatalog = (): SkillCatalogEntry[] => scopedCatalog.map((entry) => ({...entry}));

  return {
    listCatalog: cloneCatalog,
    loadSkill(name: string): SkillLoadResult {
      const normalizedName = name.trim();
      if (!allowedNames.has(normalizedName)) {
        // 不可用名称与缺失名称统一按 unknown 处理，避免通过失败消息泄露 scope 外目录。
        return {ok: false, reason: 'missing', message: `Skill "${normalizedName}" is not available for this agent.`, availableSkills: cloneCatalog()};
      }
      return snapshot.loadSkill(normalizedName);
    }
  };
}

export {
  captureSkillSnapshot,
  createScopedSkillRegistry
};

export type {SkillSnapshot};

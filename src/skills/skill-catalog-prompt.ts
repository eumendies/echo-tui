import type {SkillCatalogEntry} from '../types/skill';

/**
 * 把 skill catalog 渲染为短 system prompt 片段；这里只放路由元数据，不放 SKILL.md 正文。
 */
function formatSkillCatalogPrompt(catalog: SkillCatalogEntry[] = []): string {
  if (catalog.length === 0) {
    return '';
  }

  const lines = catalog.map((skill) => `- ${skill.name}: ${skill.description}`);

  return `Available Skills:
When the user's request clearly matches the description of a skill, call the \`use_skill\` tool to load that skill's full instructions; do not load all skills unconditionally.
${lines.join('\n')}`;
}

export {formatSkillCatalogPrompt};

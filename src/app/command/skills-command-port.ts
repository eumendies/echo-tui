import {createSkillManager} from '../../skills/skill-manager';

import type {CommandHostApp} from '../../types/command';

type SkillsCommandPortOptions = {
  clearContextUsage: () => void;
  cwd: () => string;
};

/**
 * 创建 skill 发现、启用状态和直接调用端口。
 */
function createSkillsCommandPort(options: SkillsCommandPortOptions): CommandHostApp['skills'] {
  const skillManager = createSkillManager({cwd: options.cwd});

  return {
    createSkillInvocation(skillName: string, argumentsText?: string) {
      const result = skillManager.loadSkill(skillName);

      if (!result.ok) {
        return {
          ok: false as const,
          reason: result.reason === 'disabled' ? 'disabled' as const : 'missing' as const,
          message: result.message
        };
      }

      const userRequestText = argumentsText && argumentsText.trim() !== '' ? argumentsText.trim() : undefined;
      const lines = [
        '[Skill Invocation]',
        `skill: ${result.skill.name}`,
        `source: ${result.skill.sourceKind}`,
        `source_path: ${result.skill.sourcePath}`,
        '',
        '[Skill Instructions]',
        result.skill.content
      ];

      if (result.skill.resources.length > 0) {
        lines.push('', '[Skill Resources]', ...result.skill.resources.map((resourcePath) => `- ${resourcePath}`));
      }

      if (userRequestText) {
        lines.push('', '[User Request]', userRequestText);
      }

      return {
        ok: true as const,
        text: lines.join('\n'),
        ...(result.modelProfileId ? {modelProfileId: result.modelProfileId} : {}),
        metadata: {
          skillInvocation: {
            source: 'slash',
            skillName: result.skill.name,
            argumentsText: userRequestText,
            userRequestText,
            sourceKind: result.skill.sourceKind,
            sourcePath: result.skill.sourcePath
          }
        }
      };
    },
    listSkills() {
      return skillManager.listSkills();
    },
    listEnabledSkillDescriptors() {
      return skillManager.listCatalog().map((skill) => ({
        name: skill.name,
        description: `Skill: ${skill.description}`
      }));
    },
    saveSkillStates(skills) {
      skillManager.saveSkillStates(skills);
      options.clearContextUsage();
    }
  };
}

export {
  createSkillsCommandPort
};

export type {
  SkillsCommandPortOptions
};

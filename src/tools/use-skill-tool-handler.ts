import type {SkillRegistry} from '../types/skill';
import type {ToolCall, ToolHandler, UseSkillToolExecutionResult} from '../types/tool';

const USE_SKILL_TOOL_NAME = 'use_skill';

/**
 * 创建 skill 加载工具；模型先看短 catalog，再通过该工具取回单个 SKILL.md 正文。
 */
function createUseSkillToolHandler(registry: SkillRegistry): ToolHandler {
  return {
    definition: {
      name: USE_SKILL_TOOL_NAME,
      description: 'Load the full instructions for a named skill when the current user request clearly matches that skill. Use the catalog in the system prompt to choose the skill name. Omit arguments when there is no extra invocation context.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: {
            type: 'string'
          },
          arguments: {
            type: 'string'
          }
        }
      }
    },
    execute(args: Record<string, unknown>, call: ToolCall): UseSkillToolExecutionResult {
      const normalized = normalizeUseSkillArgs(args);

      if (!normalized.ok) {
        return createUseSkillFailureResult(call, normalized.message);
      }

      const result = registry.loadSkill(normalized.name);

      if (!result.ok) {
        return createUseSkillFailureResult(call, formatLoadFailure(result.message, result.availableSkills.map((skill) => skill.name)));
      }

      return {
        callId: call.callId,
        toolName: USE_SKILL_TOOL_NAME,
        ok: true,
        details: {kind: 'generic'},
        text: formatSkillResult({
          name: result.skill.name,
          sourcePath: result.skill.sourcePath,
          argumentsText: normalized.argumentsText,
          content: result.skill.content,
          resources: result.skill.resources
        })
      };
    }
  };
}

function normalizeUseSkillArgs(args: Record<string, unknown>): {ok: true; name: string; argumentsText?: string} | {ok: false; message: string} {
  const name = args.name;

  if (typeof name !== 'string' || name.trim() === '') {
    return {ok: false, message: 'name must be a non-empty string'};
  }

  const argumentsValue = args.arguments;

  if (argumentsValue !== undefined && argumentsValue !== null && typeof argumentsValue !== 'string') {
    return {ok: false, message: 'arguments must be a string or null'};
  }

  return {
    ok: true,
    name: name.trim(),
    argumentsText: typeof argumentsValue === 'string' && argumentsValue.trim() !== '' ? argumentsValue.trim() : undefined
  };
}

function formatSkillResult(input: {argumentsText?: string; content: string; name: string; resources: string[]; sourcePath: string}): string {
  const lines = [
    `skill: ${input.name}`,
    `source: ${input.sourcePath}`
  ];

  if (input.argumentsText) {
    lines.push(`arguments: ${input.argumentsText}`);
  }

  lines.push('', input.content);

  if (input.resources.length > 0) {
    lines.push('', '[Skill Resources]', ...input.resources.map((resourcePath) => `- ${resourcePath}`));
  }

  return lines.join('\n');
}

function formatLoadFailure(message: string, availableSkillNames: string[]): string {
  if (availableSkillNames.length === 0) {
    return `${message}\navailable_skills: none`;
  }

  return `${message}\navailable_skills:\n${availableSkillNames.map((name) => `- ${name}`).join('\n')}`;
}

function createUseSkillFailureResult(call: ToolCall, message: string): UseSkillToolExecutionResult {
  return {
    callId: call.callId,
    toolName: USE_SKILL_TOOL_NAME,
    ok: false,
    details: {kind: 'generic'},
    text: message
  };
}

export {
  USE_SKILL_TOOL_NAME,
  createUseSkillToolHandler,
  normalizeUseSkillArgs
};

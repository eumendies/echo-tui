import type {SkillRegistry} from '../types/skill';
import {DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES, capUtf8Text} from './tool-handler-utils';

import type {ToolCall, ToolHandler, UseSkillToolExecutionResult} from '../types/tool';

const USE_SKILL_TOOL_NAME = 'use_skill';
const MAX_USE_SKILL_ARGUMENTS_BYTES = 8_192;
const MAX_USE_SKILL_RESOURCES_BYTES = 16_384;

type UseSkillToolHandlerOptions = {
  maxArgumentsBytes?: number; // 单次调用附加上下文的独立字节预算。
  maxOutputBytes?: number; // 元数据、正文和资源列表组成的完整 envelope 预算。
  maxResourcesBytes?: number; // 格式化资源列表的独立字节预算。
};

/**
 * 创建 skill 加载工具；模型先看短 catalog，再通过该工具取回单个 SKILL.md 正文。
 */
function createUseSkillToolHandler(registry: SkillRegistry, options: UseSkillToolHandlerOptions = {}): ToolHandler {
  const maxArgumentsBytes = options.maxArgumentsBytes || MAX_USE_SKILL_ARGUMENTS_BYTES;
  const maxOutputBytes = options.maxOutputBytes || DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES;
  const maxResourcesBytes = options.maxResourcesBytes || MAX_USE_SKILL_RESOURCES_BYTES;
  return {
    definition: {
      name: USE_SKILL_TOOL_NAME,
      // 拒绝与拆分指引由超限时的失败结果承担（formatOversizedSkillFailure），不占常态 schema 上下文。
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
      const normalized = normalizeUseSkillArgs(args, maxArgumentsBytes);

      if (!normalized.ok) {
        return createUseSkillFailureResult(call, normalized.message, maxOutputBytes);
      }

      let result;
      try {
        result = registry.loadSkill(normalized.name);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return createUseSkillFailureResult(call, `Failed to load skill: ${message}`, maxOutputBytes);
      }

      if (!result.ok) {
        return createUseSkillFailureResult(call, formatLoadFailure(result.message, result.availableSkills.map((skill) => skill.name)), maxOutputBytes);
      }

      const resourcesText = formatSkillResources(result.skill.resources);
      if (Buffer.byteLength(resourcesText, 'utf8') > maxResourcesBytes) {
        return createUseSkillFailureResult(call, formatOversizedSkillFailure(result.skill.sourcePath, 'resource list'), maxOutputBytes);
      }

      const text = formatSkillResult({
        name: result.skill.name,
        sourcePath: result.skill.sourcePath,
        argumentsText: normalized.argumentsText,
        content: result.skill.content,
        resources: result.skill.resources
      });
      if (Buffer.byteLength(text, 'utf8') > maxOutputBytes) {
        return createUseSkillFailureResult(call, formatOversizedSkillFailure(result.skill.sourcePath, 'full content'), maxOutputBytes);
      }

      return {
        callId: call.callId,
        toolName: USE_SKILL_TOOL_NAME,
        ok: true,
        details: {kind: 'generic'},
        text
      };
    }
  };
}

function normalizeUseSkillArgs(args: Record<string, unknown>, maxArgumentsBytes = MAX_USE_SKILL_ARGUMENTS_BYTES): {ok: true; name: string; argumentsText?: string} | {ok: false; message: string} {
  const name = args.name;

  if (typeof name !== 'string' || name.trim() === '') {
    return {ok: false, message: 'name must be a non-empty string'};
  }

  const argumentsValue = args.arguments;

  if (argumentsValue !== undefined && argumentsValue !== null && typeof argumentsValue !== 'string') {
    return {ok: false, message: 'arguments must be a string or null'};
  }

  const argumentsText = typeof argumentsValue === 'string' && argumentsValue.trim() !== '' ? argumentsValue.trim() : undefined;
  if (argumentsText && Buffer.byteLength(argumentsText, 'utf8') > maxArgumentsBytes) {
    return {ok: false, message: `arguments exceed ${maxArgumentsBytes} bytes; pass only concise invocation context`};
  }

  return {
    ok: true,
    name: name.trim(),
    argumentsText
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
    lines.push('', formatSkillResources(input.resources));
  }

  return lines.join('\n');
}

function formatSkillResources(resources: string[]): string {
  return resources.length === 0 ? '' : ['[Skill Resources]', ...resources.map((resourcePath) => `- ${resourcePath}`)].join('\n');
}

function formatOversizedSkillFailure(sourcePath: string, field: string): string {
  const boundedSource = capUtf8Text(sourcePath, 2_048).text;
  return [
    `Skill was not loaded because its ${field} exceeds the ${DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES}-byte result limit.`,
    `source: ${boundedSource}`,
    'The full instructions did not fit in one use_skill load. Read the source file above with read_files using offset/limit when you need the complete skill.'
  ].join('\n');
}

function formatLoadFailure(message: string, availableSkillNames: string[]): string {
  if (availableSkillNames.length === 0) {
    return `${message}\navailable_skills: none`;
  }

  return `${message}\navailable_skills:\n${availableSkillNames.map((name) => `- ${name}`).join('\n')}`;
}

function createUseSkillFailureResult(call: ToolCall, message: string, maxOutputBytes = DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES): UseSkillToolExecutionResult {
  return {
    callId: call.callId,
    toolName: USE_SKILL_TOOL_NAME,
    ok: false,
    details: {kind: 'generic'},
    text: capUtf8Text(message, maxOutputBytes).text
  };
}

export {
  USE_SKILL_TOOL_NAME,
  MAX_USE_SKILL_ARGUMENTS_BYTES,
  MAX_USE_SKILL_RESOURCES_BYTES,
  createUseSkillToolHandler,
  normalizeUseSkillArgs
};

import {USE_SKILL_TOOL_NAME} from '../tools/use-skill-tool-handler';

import type {SkillUseRecord} from '../types/skill';
import type {TranscriptRecord} from '../types/transcript';

/**
 * 从 transcript 中提取 use_skill 调用记录；只识别真实 tool_call，不把其它工具误判为 skill。
 */
function listSkillUseRecords(records: TranscriptRecord[]): SkillUseRecord[] {
  const uses: SkillUseRecord[] = [];

  for (const record of records) {
    if (record.role !== 'tool_call' || record.toolName !== USE_SKILL_TOOL_NAME) {
      continue;
    }

    if (typeof record.toolCallId !== 'string' || typeof record.argumentsText !== 'string') {
      continue;
    }

    const parsed = parseUseSkillArguments(record.argumentsText);

    if (!parsed) {
      continue;
    }

    uses.push({
      source: 'tool',
      skillName: parsed.name,
      argumentsText: parsed.arguments,
      toolCallId: record.toolCallId,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined
    });
  }

  for (const record of records) {
    if (record.role !== 'user') {
      continue;
    }

    const invocation = record.metadata?.skillInvocation;

    if (!invocation || invocation.skillName.trim() === '') {
      continue;
    }

    const argumentsText = invocation.userRequestText || invocation.argumentsText;

    uses.push({
      source: 'slash',
      skillName: invocation.skillName.trim(),
      argumentsText: typeof argumentsText === 'string' && argumentsText.trim() !== '' ? argumentsText.trim() : undefined,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined
    });
  }

  return uses;
}

function parseUseSkillArguments(argumentsText: string): {arguments?: string; name: string} | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const args = parsed as Record<string, unknown>;

  if (typeof args.name !== 'string' || args.name.trim() === '') {
    return null;
  }

  return {
    name: args.name.trim(),
    arguments: typeof args.arguments === 'string' && args.arguments.trim() !== '' ? args.arguments.trim() : undefined
  };
}

export {listSkillUseRecords};

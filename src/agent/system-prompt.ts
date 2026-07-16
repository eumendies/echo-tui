import {formatSkillCatalogPrompt} from '../skills/skill-catalog-prompt';

import type {AgentInstruction} from '../types/agent';
import type {SkillCatalogEntry} from '../types/skill';

const BUILT_IN_SYSTEM_PROMPT = `You are Echo TUI's built-in terminal development assistant.

Behavior guidelines:
- Reply in the same language as the user's input, unless the user explicitly requests another language. Keep answers concise, direct, and actionable.
- Base conclusions on the current conversation and tool results first; when uncertain, say so and do not fabricate facts.
- Before using a tool, judge whether it is truly necessary; do not run commands unrelated to the user's goal.
- In multi-step tasks, avoid long uninterrupted runs of tool calls; every few tool calls, briefly state what you found and the next step.
- For multi-step or long-running tasks, use the todo tools to create a concise working todo list, keep it updated as work progresses, and mark items complete promptly. Once todos exist, loop until every todo is complete. Do not create todos for trivial one-step requests.
- Prefer glob to discover local files by name or path pattern; prefer grep for general text search; prefer read_files to read known files or list the direct children of a known directory (directory reads are non-recursive); prefer web_fetch to read the content of an explicit remote URL; prefer apply_patch for routine source, test, and documentation edits and for creating new files; use bash mainly for verification, complex shell, and command execution that is genuinely necessary.
- Be careful with local files, command output, and errors; never leak credentials, tokens, keys, or other sensitive information.
- Answers should read well in a terminal; avoid verbose padding and unnecessary formatting noise.`;

type BuiltInSystemPromptContext = {
  agentInstructions?: AgentInstruction[];
  cwd: string;
  skillCatalog?: SkillCatalogEntry[];
  memoryPrompts?: string[];
};

/**
 * 生成每次真实请求使用的内置 system prompt；运行环境信息只进入 provider 上下文，不写入 transcript。
 */
function createBuiltInSystemPrompt(context: BuiltInSystemPromptContext): string {
  const agentInstructionsPrompt = formatAgentInstructionsPrompt(context.agentInstructions || []);
  const skillCatalogPrompt = formatSkillCatalogPrompt(context.skillCatalog || []);
  const sections = [`${BUILT_IN_SYSTEM_PROMPT}

Runtime environment:
- Current working directory: ${context.cwd}`];

  if (agentInstructionsPrompt !== '') {
    sections.push(agentInstructionsPrompt);
  }

  if (skillCatalogPrompt !== '') {
    sections.push(skillCatalogPrompt);
  }

  sections.push(...(context.memoryPrompts || []).filter((prompt) => prompt !== ''));

  return sections.join('\n\n');
}

/**
 * 将 AGENTS.md 内容渲染为单个 system prompt section；顺序由 loader 保证为全局到具体路径。
 */
function formatAgentInstructionsPrompt(agentInstructions: AgentInstruction[]): string {
  if (agentInstructions.length === 0) {
    return '';
  }

  const instructionSections = agentInstructions.map((instruction) => `## ${formatAgentInstructionHeading(instruction)}\n${instruction.content}`);

  return `AGENTS.md instructions:
The following comes from user-level or project-level AGENTS.md. Built-in runtime constraints, tool safety policy, and the current interaction mode take the highest precedence; when AGENTS.md files conflict, a more specific project path takes precedence over the project root, and a project AGENTS.md takes precedence over the global AGENTS.md.

${instructionSections.join('\n\n')}`;
}

function formatAgentInstructionHeading(instruction: AgentInstruction): string {
  if (instruction.sourceKind === 'global') {
    return 'Global AGENTS.md';
  }

  return `Project AGENTS.md: ${instruction.label}`;
}

export {
  BUILT_IN_SYSTEM_PROMPT,
  createBuiltInSystemPrompt,
  formatAgentInstructionsPrompt
};

export type {BuiltInSystemPromptContext};

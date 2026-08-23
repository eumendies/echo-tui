import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {formatSkillCatalogPrompt} from '../../skills/skill-catalog-prompt';
import {findProjectRoot} from '../agent-instructions';

import type {AgentInstruction} from '../../types/agent';
import type {SkillCatalogEntry} from '../../types/skill';

const BUILT_IN_SYSTEM_PROMPT = `You are Echo TUI's built-in terminal development assistant.

Guidelines:
- Match the user's language unless asked otherwise. Be concise, direct, actionable, and terminal-friendly.
- Ground answers in the conversation and tool results; state uncertainty and never invent facts.
- For non-trivial multi-step work, maintain todos to completion and periodically summarize findings and next steps; skip todos for trivial tasks.`;
const SYSTEM_FILE_NAME = 'SYSTEM.md';

type SystemPromptSourceKind = 'global' | 'project';

type SystemPromptOverride = {
  content: string;
  filePath: string;
  sourceKind: SystemPromptSourceKind;
};

type SystemPromptLoadOptions = {
  cwd?: string;
  homedir?: string;
  readFile?: (filePath: string, encoding: BufferEncoding) => string;
  stat?: (filePath: string) => fs.Stats;
};

type BuiltInSystemPromptContext = {
  agentInstructions?: AgentInstruction[]; // 当前 cwd 适用且已按层级排序的项目指令。
  basePrompt?: string; // 用户 system prompt override；缺省使用内置主 prompt。
  cwd: string; // 进入每次 provider 请求的运行工作目录。
  skillCatalog?: SkillCatalogEntry[]; // 当前 revision 的有界 enabled skill目录。
  memoryPrompts?: string[]; // 当前请求动态解析的 user/agent memory sections。
  rolePrompt?: string; // 子 Agent等隔离运行追加的明确角色边界 section。
};

/**
 * 生成每次真实请求使用的 system prompt；基础文本可覆盖，动态上下文只进入 provider 请求。
 */
function createBuiltInSystemPrompt(context: BuiltInSystemPromptContext): string {
  const agentInstructionsPrompt = formatAgentInstructionsPrompt(context.agentInstructions || []);
  const skillCatalogPrompt = formatSkillCatalogPrompt(context.skillCatalog || []);
  const sections = [`${context.basePrompt || BUILT_IN_SYSTEM_PROMPT}

Runtime environment:
- Current working directory: ${context.cwd}`];

  if (agentInstructionsPrompt !== '') {
    sections.push(agentInstructionsPrompt);
  }

  if (context.rolePrompt?.trim()) {
    sections.push(context.rolePrompt.trim());
  }

  if (skillCatalogPrompt !== '') {
    sections.push(skillCatalogPrompt);
  }

  sections.push(...(context.memoryPrompts || []).filter((prompt) => prompt !== ''));

  return sections.join('\n\n');
}

/**
 * 按项目级、用户级顺序读取基础 system prompt 覆盖；无有效文件时返回 null。
 */
function loadSystemPromptOverride(options: SystemPromptLoadOptions = {}): SystemPromptOverride | null {
  const cwd = path.resolve(options.cwd || process.cwd());
  const homedir = path.resolve(options.homedir || os.homedir());
  const stat = options.stat || fs.statSync;
  const readFile = options.readFile || fs.readFileSync;
  const projectRoot = findProjectRoot(cwd, homedir, stat) || cwd;
  const candidates = [
    {filePath: path.join(projectRoot, SYSTEM_FILE_NAME), sourceKind: 'project' as const},
    {filePath: getDefaultGlobalSystemPromptPath(homedir), sourceKind: 'global' as const}
  ];
  const seenPaths = new Set<string>();

  for (const candidate of candidates) {
    const filePath = path.resolve(candidate.filePath);

    if (seenPaths.has(filePath)) {
      continue;
    }

    seenPaths.add(filePath);
    const content = readSystemPromptFile(filePath, {readFile, stat});

    if (content !== null) {
      return {...candidate, filePath, content};
    }
  }

  return null;
}

function getDefaultGlobalSystemPromptPath(homedir = os.homedir()): string {
  return path.join(homedir, '.echo', SYSTEM_FILE_NAME);
}

function readSystemPromptFile(filePath: string, options: {
  readFile: (filePath: string, encoding: BufferEncoding) => string;
  stat: (filePath: string) => fs.Stats;
}): string | null {
  try {
    if (!options.stat(filePath).isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  let rawContent: string;

  try {
    rawContent = options.readFile(filePath, 'utf8');
  } catch {
    return null;
  }

  const normalized = rawContent.replace(/\r\n?/g, '\n').trim();
  return normalized === '' ? null : normalized;
}

/**
 * 将项目指令文件渲染为单个 system prompt section；顺序由 loader 保证为全局到具体路径。
 */
function formatAgentInstructionsPrompt(agentInstructions: AgentInstruction[]): string {
  if (agentInstructions.length === 0) {
    return '';
  }

  const fileName = path.basename(agentInstructions[0].filePath);
  const instructionSections = agentInstructions.map((instruction) => `## ${formatAgentInstructionHeading(instruction, fileName)}\n${instruction.content}`);

  return `${fileName} instructions:
The following comes from user-level or project-level ${fileName}. Built-in runtime constraints, tool safety policy, and the current interaction mode take the highest precedence; when ${fileName} files conflict, a more specific project path takes precedence over the project root, and a project ${fileName} takes precedence over the global ${fileName}.

${instructionSections.join('\n\n')}`;
}

function formatAgentInstructionHeading(instruction: AgentInstruction, fileName: string): string {
  if (instruction.sourceKind === 'global') {
    return `Global ${fileName}`;
  }

  return `Project ${fileName}: ${instruction.label}`;
}

export {
  BUILT_IN_SYSTEM_PROMPT,
  SYSTEM_FILE_NAME,
  createBuiltInSystemPrompt,
  formatAgentInstructionsPrompt,
  getDefaultGlobalSystemPromptPath,
  loadSystemPromptOverride
};

export type {
  BuiltInSystemPromptContext,
  SystemPromptLoadOptions,
  SystemPromptOverride,
  SystemPromptSourceKind
};

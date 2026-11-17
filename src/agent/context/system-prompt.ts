import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {formatSkillCatalogPrompt} from '../../skills/skill-catalog-prompt';
import {findProjectRoot} from '../agent-instructions';

import type {AgentInstruction, SystemPromptFileFact, SystemPromptSnapshot, SystemPromptSourceKind, SystemPromptTarget} from '../../types/agent';
import type {SkillCatalogEntry} from '../../types/skill';

const BUILT_IN_SYSTEM_PROMPT = `You are Echo TUI's built-in terminal development assistant.

Guidelines:
- Match the user's language unless asked otherwise. Be concise, direct, actionable, and terminal-friendly.
- Ground answers in the conversation and tool results; state uncertainty and never invent facts.`;
const SYSTEM_FILE_NAME = 'SYSTEM.md';

// 覆盖文件只有项目级与用户级两种来源；生效来源集合另含内置默认。
type SystemPromptOverrideSourceKind = 'global' | 'project';

type SystemPromptOverride = {
  content: string;
  filePath: string;
  sourceKind: SystemPromptOverrideSourceKind;
};

type SystemPromptLoadOptions = {
  cwd?: string;
  homedir?: string;
  readFile?: (filePath: string, encoding: BufferEncoding) => string;
  stat?: (filePath: string) => fs.Stats;
};

// 文件读写边界集中在一个对象里；缺省项回落到 node:fs，测试只覆盖关心的少数几个。
type SystemPromptFsOptions = {
  createTempPath?: (targetPath: string) => string; // 同目录临时文件名生成。
  mkdir?: (dirPath: string, options: {recursive: boolean}) => unknown; // 父目录递归创建。
  readFile?: (filePath: string, encoding: BufferEncoding) => string; // 内容读取。
  rename?: (oldPath: string, newPath: string) => unknown; // 原子替换。
  stat?: (filePath: string) => fs.Stats; // 存在性与类型判定。
  unlink?: (filePath: string) => unknown; // 删除目标与失败后的临时文件清理。
  writeFile?: (filePath: string, data: string) => unknown; // 临时文件写入。
};

type SystemPromptFileOptions = {
  cwd?: string; // 解析项目根时的工作目录；缺省取进程 cwd。
  fs?: SystemPromptFsOptions; // 可注入文件边界；缺省使用 node:fs。
  homedir?: string; // 解析用户级目标时的 home 目录；缺省取 os.homedir()。
};

type SystemPromptWriteResult =
  | {
      ok: true; // 表示内容已落盘，或与现有内容一致而无需落盘。
      filePath: string; // 实际目标绝对路径。
      overwritten: boolean; // 写入前目标是否已存在。
      unchanged: boolean; // 为真时没有发生写盘。
    }
  | {
      ok: false; // 表示拒绝写入或磁盘写入失败。
      error: string; // 可直接展示的中文原因。
      filePath: string; // 目标绝对路径，便于用户核对。
      reason: 'empty' | 'write_failed'; // 区分内容为空与磁盘错误。
    };

type SystemPromptDeleteResult =
  | {
      ok: true; // 表示删除完成或目标本就不存在。
      filePath: string; // 实际目标路径。
      removed: boolean; // 为真时确实删除了文件；ENOENT 时为假。
    }
  | {ok: false; error: string; filePath: string}; // 删除失败且文件可能仍然存在。

type BuiltInSystemPromptContext = {
  agentInstructions?: AgentInstruction[]; // 当前 cwd 适用且已按层级排序的项目指令。
  basePrompt?: string; // 用户 system prompt override；缺省使用内置主 prompt。
  cwd: string; // 进入每次 provider 请求的运行工作目录。
  sandboxNote?: string; // bash 沙箱生效时的边界说明;缺省表示本次运行未包装沙箱。
  skillCatalog?: SkillCatalogEntry[]; // 当前 revision 的有界 enabled skill目录。
  memoryPrompts?: string[]; // 当前请求动态解析的 user/agent memory sections。
  rolePrompt?: string; // 子 Agent等隔离运行追加的明确角色边界 section。
  workspaceNote?: string; // 受管 worktree 的运行边界说明；缺省表示按父目录执行。
};

/**
 * 生成每次真实请求使用的 system prompt；基础文本可覆盖，动态上下文只进入 provider 请求。
 */
function createBuiltInSystemPrompt(context: BuiltInSystemPromptContext): string {
  const agentInstructionsPrompt = formatAgentInstructionsPrompt(context.agentInstructions || []);
  const skillCatalogPrompt = formatSkillCatalogPrompt(context.skillCatalog || []);
  const sections = [`${context.basePrompt || BUILT_IN_SYSTEM_PROMPT}

${formatRuntimeEnvironmentPrompt(context)}`];

  if (agentInstructionsPrompt !== '') {
    sections.push(agentInstructionsPrompt);
  }

  if (context.rolePrompt?.trim()) {
    sections.push(context.rolePrompt.trim());
  }

  if (context.workspaceNote?.trim()) {
    sections.push(context.workspaceNote.trim());
  }

  if (skillCatalogPrompt !== '') {
    sections.push(skillCatalogPrompt);
  }

  sections.push(...(context.memoryPrompts || []).filter((prompt) => prompt !== ''));

  return sections.join('\n\n');
}

/**
 * 渲染 runtime environment 段；面板的动态段摘要复用同一文案，避免两处各写一份。
 */
function formatRuntimeEnvironmentPrompt(context: {cwd: string; sandboxNote?: string}): string {
  return [
    'Runtime environment:',
    `- Current working directory: ${context.cwd}`,
    ...(context.sandboxNote ? [`- Bash sandbox: ${context.sandboxNote}`] : [])
  ].join('\n');
}

/**
 * 按项目级、用户级顺序读取基础 system prompt 覆盖；无有效文件时返回 null。
 */
function loadSystemPromptOverride(options: SystemPromptLoadOptions = {}): SystemPromptOverride | null {
  const cwd = path.resolve(options.cwd || process.cwd());
  const homedir = path.resolve(options.homedir || os.homedir());
  const io = {readFile: options.readFile || fs.readFileSync, stat: options.stat || fs.statSync};
  const candidates = [
    {filePath: resolveSystemPromptTargetPath('project', {cwd, fs: io, homedir}), sourceKind: 'project' as const},
    {filePath: resolveSystemPromptTargetPath('global', {cwd, homedir}), sourceKind: 'global' as const}
  ];
  const seenPaths = new Set<string>();

  for (const candidate of candidates) {
    const {filePath} = candidate;

    if (seenPaths.has(filePath)) {
      continue;
    }

    seenPaths.add(filePath);
    const fact = readSystemPromptTarget(filePath, io);

    if (fact.exists && typeof fact.content === 'string') {
      return {...candidate, content: fact.content};
    }
  }

  return null;
}

function getDefaultGlobalSystemPromptPath(homedir = os.homedir()): string {
  return path.join(homedir, '.echo', SYSTEM_FILE_NAME);
}

/**
 * 归一化 system prompt 文本：行尾统一为 LF 并去除首尾空白。
 * 读取与写入共用该口径，避免 UI 落盘的内容与 loader 视角不一致。
 */
function normalizeSystemPromptContent(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

/**
 * 解析 system prompt 目标的绝对路径；项目目标沿用 AGENTS.md 的项目根判定口径。
 */
function resolveSystemPromptTargetPath(target: SystemPromptTarget, options: SystemPromptFileOptions = {}): string {
  const homedir = path.resolve(options.homedir || os.homedir());
  if (target === 'global') {
    return getDefaultGlobalSystemPromptPath(homedir);
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const stat = options.fs?.stat || fs.statSync;
  return path.join(findProjectRoot(cwd, homedir, stat) || cwd, SYSTEM_FILE_NAME);
}

/**
 * 读取单个目标文件事实；不可读只降级该目标，返回结构化原因而不是抛错。
 */
function readSystemPromptTarget(filePath: string, options: Required<Pick<SystemPromptFsOptions, 'readFile' | 'stat'>>): SystemPromptFileFact {
  let isFile = false;

  try {
    isFile = options.stat(filePath).isFile();
  } catch {
    return {exists: false, filePath, lines: 0};
  }

  if (!isFile) {
    return {exists: false, filePath, lines: 0};
  }

  let rawContent: string;

  try {
    rawContent = options.readFile(filePath, 'utf8');
  } catch {
    return {exists: false, filePath, lines: 0, unavailableReason: '读取失败（权限或编码问题）'};
  }

  const content = normalizeSystemPromptContent(rawContent);

  // 空文件与 loader 一样视为“未覆盖”，避免 UI 把它汇报成生效来源。
  if (content === '') {
    return {exists: false, filePath, lines: 0};
  }

  return {
    content,
    exists: true,
    filePath,
    lines: content.split('\n').length
  };
}

/**
 * 构建两个写入目标与当前生效来源的快照；只读，不修改任何文件。
 */
function resolveSystemPromptSnapshot(options: SystemPromptFileOptions = {}): SystemPromptSnapshot {
  const cwd = path.resolve(options.cwd || process.cwd());
  const homedir = path.resolve(options.homedir || os.homedir());
  const io = {readFile: options.fs?.readFile || fs.readFileSync, stat: options.fs?.stat || fs.statSync};
  const projectPath = resolveSystemPromptTargetPath('project', {cwd, fs: io, homedir});
  const globalPath = resolveSystemPromptTargetPath('global', {cwd, fs: io, homedir});
  const project = readSystemPromptTarget(projectPath, io);
  // 项目根恰好是 home 时两个目标落到同一文件，复用同一份读取结果避免重复 IO。
  const global = globalPath === projectPath ? project : readSystemPromptTarget(globalPath, io);
  const sourceKind: SystemPromptSourceKind = project.exists ? 'project' : global.exists ? 'global' : 'builtin';
  const baseContent = sourceKind === 'project'
    ? project.content!
    : sourceKind === 'global'
      ? global.content!
      : BUILT_IN_SYSTEM_PROMPT;

  return {baseContent, global, project, sourceKind};
}

/**
 * 原子写入 system prompt 覆盖文件：归一化、按需建目录、临时文件后 rename。
 * 内容为空时拒绝写入，因为空文件在 loader 视角等价于“未覆盖”。
 */
function writeSystemPromptOverride(options: SystemPromptFileOptions & {content: string; target: SystemPromptTarget}): SystemPromptWriteResult {
  const io = options.fs || {};
  const stat = io.stat || fs.statSync;
  const readFile = io.readFile || fs.readFileSync;
  const writeFile = io.writeFile || fs.writeFileSync;
  const mkdir = io.mkdir || fs.mkdirSync;
  const rename = io.rename || fs.renameSync;
  const unlink = io.unlink || fs.unlinkSync;
  const createTempPath = io.createTempPath || ((targetPath: string) => `${targetPath}.tmp-${process.pid}-${Date.now()}`);
  const filePath = resolveSystemPromptTargetPath(options.target, options);
  const content = normalizeSystemPromptContent(options.content);

  if (content === '') {
    return {
      ok: false,
      error: '内容为空：空文件等价于不使用覆盖，请改用删除动作',
      filePath,
      reason: 'empty'
    };
  }

  const existing = readSystemPromptTarget(filePath, {readFile, stat});

  if (existing.exists && existing.content === content) {
    return {filePath, ok: true, overwritten: true, unchanged: true};
  }

  const tempPath = createTempPath(filePath);

  let step = '创建目录';

  try {
    mkdir(path.dirname(filePath), {recursive: true});
    step = '写入临时文件';
    writeFile(tempPath, content);
    step = '替换目标文件';
    rename(tempPath, filePath);
  } catch (error: unknown) {
    // 失败时尽力清掉临时文件，避免在用户目录里留下半成品。
    try {
      unlink(tempPath);
    } catch {
      // 清理失败不改变主错误。
    }

    return {
      ok: false,
      error: `写入失败（${step}）：${error instanceof Error ? error.message : String(error)}`,
      filePath,
      reason: 'write_failed'
    };
  }

  return {filePath, ok: true, overwritten: existing.exists, unchanged: false};
}

/**
 * 删除目标覆盖文件；ENOENT 视为已完成，保证重复删除不报错。
 */
function deleteSystemPromptOverride(options: SystemPromptFileOptions & {target: SystemPromptTarget}): SystemPromptDeleteResult {
  const unlink = options.fs?.unlink || fs.unlinkSync;
  const filePath = resolveSystemPromptTargetPath(options.target, options);

  try {
    unlink(filePath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return {filePath, ok: true, removed: false};
    }

    return {error: `删除失败：${error instanceof Error ? error.message : String(error)}`, filePath, ok: false};
  }

  return {filePath, ok: true, removed: true};
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
  deleteSystemPromptOverride,
  formatAgentInstructionsPrompt,
  formatRuntimeEnvironmentPrompt,
  getDefaultGlobalSystemPromptPath,
  loadSystemPromptOverride,
  resolveSystemPromptSnapshot,
  writeSystemPromptOverride
};

export type {
  BuiltInSystemPromptContext,
  SystemPromptDeleteResult,
  SystemPromptFileOptions,
  SystemPromptFsOptions,
  SystemPromptLoadOptions,
  SystemPromptOverride,
  SystemPromptOverrideSourceKind,
  SystemPromptWriteResult
};

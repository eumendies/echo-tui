import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type {AgentInstruction, AgentInstructionFileName, AgentInstructionSourceKind} from '../types/agent';

const AGENTS_FILE_NAME = 'AGENTS.md';
const DEFAULT_MAX_AGENT_INSTRUCTION_FILE_BYTES = 64 * 1024;
const DEFAULT_MAX_AGENT_INSTRUCTIONS_TOTAL_BYTES = 128 * 1024;
const TRUNCATED_MARKER = '\n\n[truncated]';

type AgentInstructionCandidate = {
  filePath: string;
  label: string;
  sourceKind: AgentInstructionSourceKind;
};

type AgentInstructionLoadOptions = {
  cwd?: string;
  fileName?: AgentInstructionFileName;
  homedir?: string;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  readFile?: (filePath: string, encoding: BufferEncoding) => string;
  stat?: (filePath: string) => fs.Stats;
};

/**
 * 读取本次 provider 请求适用的项目指令文件；缺失或不可读文件会被跳过。
 */
function loadAgentInstructions(options: AgentInstructionLoadOptions = {}): AgentInstruction[] {
  const cwd = path.resolve(options.cwd || process.cwd());
  const homedir = path.resolve(options.homedir || os.homedir());
  const fileName = options.fileName || AGENTS_FILE_NAME;
  const readFile = options.readFile || fs.readFileSync;
  const stat = options.stat || fs.statSync;
  const maxFileBytes = normalizePositiveInteger(options.maxFileBytes, DEFAULT_MAX_AGENT_INSTRUCTION_FILE_BYTES);
  const maxTotalBytes = normalizePositiveInteger(options.maxTotalBytes, DEFAULT_MAX_AGENT_INSTRUCTIONS_TOTAL_BYTES);
  const candidates = [
    {
      filePath: getDefaultGlobalAgentInstructionsPath(fileName, homedir),
      label: fileName,
      sourceKind: 'global' as const
    },
    ...collectProjectAgentInstructionCandidates(cwd, homedir, stat, fileName)
  ];
  const instructions: AgentInstruction[] = [];
  const seenPaths = new Set<string>();
  let usedBytes = 0;

  for (const candidate of candidates) {
    const normalizedPath = path.resolve(candidate.filePath);

    if (seenPaths.has(normalizedPath) || usedBytes >= maxTotalBytes) {
      continue;
    }

    seenPaths.add(normalizedPath);
    const remainingBytes = maxTotalBytes - usedBytes;
    const instruction = readAgentInstructionFile(candidate, {maxFileBytes, readFile, remainingBytes, stat});

    if (!instruction) {
      continue;
    }

    usedBytes += Buffer.byteLength(instruction.content, 'utf8');
    instructions.push(instruction);
  }

  return instructions;
}

function getDefaultGlobalAgentsPath(homedir = os.homedir()): string {
  return getDefaultGlobalAgentInstructionsPath(AGENTS_FILE_NAME, homedir);
}

function getDefaultGlobalAgentInstructionsPath(fileName: AgentInstructionFileName, homedir = os.homedir()): string {
  return path.join(homedir, '.echo', fileName);
}

function collectProjectAgentInstructionCandidates(cwd: string, homedir: string, stat: (filePath: string) => fs.Stats, fileName: AgentInstructionFileName = AGENTS_FILE_NAME): AgentInstructionCandidate[] {
  const projectRoot = findProjectRoot(cwd, homedir, stat);
  const dirs = projectRoot ? listDirectoriesFromRootToCwd(projectRoot, cwd) : [cwd];

  return dirs.map((dirPath) => ({
    filePath: path.join(dirPath, fileName),
    label: projectRoot ? normalizeProjectRelativePath(path.relative(projectRoot, path.join(dirPath, fileName)), fileName) : fileName,
    sourceKind: 'project' as const
  }));
}

function findProjectRoot(cwd: string, homedir: string, stat: (filePath: string) => fs.Stats): string | null {
  let current = path.resolve(cwd);
  const normalizedHome = path.resolve(homedir);

  while (true) {
    if (hasGitMarker(current, stat) || (current !== normalizedHome && hasProjectEchoMarker(current, stat))) {
      return current;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

function hasGitMarker(dirPath: string, stat: (filePath: string) => fs.Stats): boolean {
  try {
    const stats = stat(path.join(dirPath, '.git'));
    return stats.isDirectory() || stats.isFile();
  } catch {
    return false;
  }
}

function hasProjectEchoMarker(dirPath: string, stat: (filePath: string) => fs.Stats): boolean {
  try {
    return stat(path.join(dirPath, '.echo')).isDirectory();
  } catch {
    return false;
  }
}

function listDirectoriesFromRootToCwd(root: string, cwd: string): string[] {
  const normalizedRoot = path.resolve(root);
  let current = path.resolve(cwd);
  const dirs: string[] = [];

  while (true) {
    dirs.unshift(current);

    if (current === normalizedRoot) {
      return dirs;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return [normalizedRoot];
    }

    current = parent;
  }
}

function normalizeProjectRelativePath(relativePath: string, fileName: AgentInstructionFileName): string {
  return relativePath === '' ? fileName : relativePath.split(path.sep).join(path.posix.sep);
}

function readAgentInstructionFile(candidate: AgentInstructionCandidate, options: {
  maxFileBytes: number;
  readFile: (filePath: string, encoding: BufferEncoding) => string;
  remainingBytes: number;
  stat: (filePath: string) => fs.Stats;
}): AgentInstruction | null {
  try {
    if (!options.stat(candidate.filePath).isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  let rawContent: string;

  try {
    rawContent = options.readFile(candidate.filePath, 'utf8');
  } catch {
    return null;
  }

  const normalized = rawContent.replace(/\r\n?/g, '\n').trim();

  if (normalized === '' || options.remainingBytes <= 0) {
    return null;
  }

  const budget = Math.min(options.maxFileBytes, options.remainingBytes);
  const truncated = Buffer.byteLength(normalized, 'utf8') > budget;
  const content = truncated ? truncateTextWithMarker(normalized, budget) : normalized;

  return {
    ...candidate,
    content
  };
}

function truncateTextWithMarker(text: string, maxBytes: number): string {
  const markerBytes = Buffer.byteLength(TRUNCATED_MARKER, 'utf8');

  if (maxBytes <= markerBytes) {
    return '[truncated]';
  }

  return `${truncateUtf8Text(text, maxBytes - markerBytes)}${TRUNCATED_MARKER}`;
}

function truncateUtf8Text(text: string, maxBytes: number): string {
  let bytes = 0;
  let result = '';

  for (const char of text) {
    const charBytes = Buffer.byteLength(char, 'utf8');

    if (bytes + charBytes > maxBytes) {
      break;
    }

    result += char;
    bytes += charBytes;
  }

  return result;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

export {
  AGENTS_FILE_NAME,
  DEFAULT_MAX_AGENT_INSTRUCTION_FILE_BYTES,
  DEFAULT_MAX_AGENT_INSTRUCTIONS_TOTAL_BYTES,
  collectProjectAgentInstructionCandidates,
  findProjectRoot,
  getDefaultGlobalAgentInstructionsPath,
  getDefaultGlobalAgentsPath,
  loadAgentInstructions
};

export type {AgentInstructionLoadOptions};

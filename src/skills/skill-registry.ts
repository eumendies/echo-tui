import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {SkillCatalogEntry, SkillDefinition, SkillLoadResult, SkillRegistry, SkillSourceKind} from '../types/skill';

type SkillRegistryOptions = {
  builtinSkillsDir?: string; // 应用包内最低优先级的 skill 根目录。
  cwd?: string | (() => string); // 项目级 skill 解析所依据的当前工作目录。
  projectSkillsDir?: string; // 测试或嵌入场景覆盖的项目级 skill 根目录。
  readDir?: (dirPath: string) => fs.Dirent[]; // skill 与资源目录发现所使用的读取边界。
  readFile?: (filePath: string, encoding: BufferEncoding) => string; // SKILL.md 内容读取边界。
  userSkillsDir?: string; // 测试或嵌入场景覆盖的用户级 skill 根目录。
};

type ParsedSkillFile =
  | {ok: true; content: string; description: string; name: string}
  | {ok: false; reason: string};

const SKILL_FILE_NAME = 'SKILL.md';
const SKILL_RESOURCE_DIR_NAMES = ['reference', 'scripts'];

/**
 * 创建 skill registry：按 builtin、用户级、项目级顺序扫描，后写的高优先级来源覆盖同名 skill。
 */
function createSkillRegistry(options: SkillRegistryOptions = {}): SkillRegistry {
  const readFile = options.readFile || fs.readFileSync;
  const readDir = options.readDir || ((dirPath: string) => fs.readdirSync(dirPath, {withFileTypes: true}));
  const builtinRoot = options.builtinSkillsDir || getDefaultBuiltinSkillsDir();
  const userRoot = options.userSkillsDir || getDefaultUserSkillsDir();
  const projectRoot = options.projectSkillsDir || getDefaultProjectSkillsDir(resolveCwd(options.cwd));
  const skills = new Map<string, SkillDefinition>();
  const invalidByFolderName = new Map<string, string>();

  scanSkillRoot(builtinRoot, 'builtin');
  scanSkillRoot(userRoot, 'user');
  scanSkillRoot(projectRoot, 'project');

  function scanSkillRoot(rootDir: string, sourceKind: SkillSourceKind): void {
    let entries: fs.Dirent[];

    try {
      entries = readDir(rootDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillDir = path.join(rootDir, entry.name);
      const skillFilePath = path.join(skillDir, SKILL_FILE_NAME);
      const parsed = readSkillFile(skillFilePath, readFile);

      if (!parsed.ok) {
        invalidByFolderName.set(entry.name, parsed.reason);
        continue;
      }

      skills.set(parsed.name, {
        name: parsed.name,
        description: parsed.description,
        sourceKind,
        sourcePath: skillFilePath,
        content: parsed.content,
        resources: listSkillResources(skillDir, readDir)
      });
    }
  }

  return {
    listCatalog() {
      return listCatalog(skills);
    },
    loadSkill(name: string): SkillLoadResult {
      const normalizedName = name.trim();
      const skill = skills.get(normalizedName);

      if (skill) {
        return {ok: true, skill: {...skill, resources: [...skill.resources]}};
      }

      const invalidReason = invalidByFolderName.get(normalizedName);
      const availableSkills = listCatalog(skills);

      return {
        ok: false,
        reason: invalidReason ? 'invalid' : 'missing',
        message: invalidReason ? `Skill "${normalizedName}" is invalid: ${invalidReason}` : `Unknown skill: ${normalizedName}`,
        availableSkills
      };
    }
  };
}

function listCatalog(skills: Map<string, SkillDefinition>): SkillCatalogEntry[] {
  return Array.from(skills.values())
    .map(({name, description, sourceKind, sourcePath}) => ({name, description, sourceKind, sourcePath}))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function readSkillFile(filePath: string, readFile: (filePath: string, encoding: BufferEncoding) => string): ParsedSkillFile {
  let rawContent: string;

  try {
    rawContent = readFile(filePath, 'utf8');
  } catch {
    return {ok: false, reason: `${SKILL_FILE_NAME} is not readable`};
  }

  return parseSkillFile(rawContent);
}

function listSkillResources(skillDir: string, readDir: (dirPath: string) => fs.Dirent[]): string[] {
  const resources: string[] = [];

  for (const resourceDirName of SKILL_RESOURCE_DIR_NAMES) {
    collectResourceFiles(skillDir, path.join(skillDir, resourceDirName), readDir, resources);
  }

  return resources.sort((left, right) => left.localeCompare(right));
}

function collectResourceFiles(skillDir: string, currentDir: string, readDir: (dirPath: string) => fs.Dirent[], resources: string[]): void {
  let entries: fs.Dirent[];

  try {
    entries = readDir(currentDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      collectResourceFiles(skillDir, entryPath, readDir, resources);
      continue;
    }

    if (entry.isFile()) {
      resources.push(normalizeResourcePath(path.relative(skillDir, entryPath)));
    }
  }
}

function normalizeResourcePath(resourcePath: string): string {
  return resourcePath.split(path.sep).join(path.posix.sep);
}

/**
 * 解析 SKILL.md 顶层 frontmatter；name 支持简单字符串，description 额外支持 YAML block scalar。
 */
function parseSkillFile(rawContent: string): ParsedSkillFile {
  const normalized = rawContent.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  if (lines[0]?.trim() !== '---') {
    return {ok: false, reason: 'frontmatter is required'};
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');

  if (closingIndex < 0) {
    return {ok: false, reason: 'frontmatter must be closed'};
  }

  const fields = parseFrontmatterFields(lines.slice(1, closingIndex));
  const name = fields.get('name') || '';
  const description = fields.get('description') || '';

  if (name === '') {
    return {ok: false, reason: 'name is required'};
  }

  if (description === '') {
    return {ok: false, reason: 'description is required'};
  }

  return {
    ok: true,
    name,
    description,
    content: lines.slice(closingIndex + 1).join('\n').trim()
  };
}

function parseFrontmatterFields(lines: string[]): Map<string, string> {
  const fields = new Map<string, string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^\s/u.test(line)) {
      continue;
    }

    const separatorIndex = line.indexOf(':');

    if (separatorIndex < 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    let value = normalizeFrontmatterValue(rawValue);

    // 处理 block scalar 值
    if (/^[|>][+-]?$/u.test(rawValue)) {
      const blockLines: string[] = [];

      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1];

        if (nextLine !== '' && !/^\s/u.test(nextLine)) {
          break;
        }

        blockLines.push(nextLine);
        index += 1;
      }

      value = blockLines.map((blockLine) => blockLine.trim()).filter(Boolean).join(' ');
    }

    if (key !== '') {
      fields.set(key, value);
    }
  }

  return fields;
}

function normalizeFrontmatterValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith('\'') && value.endsWith('\''))
  ) {
    return value.slice(1, -1).trim();
  }

  return value.trim();
}

function resolveCwd(cwd: string | (() => string) | undefined): string {
  return typeof cwd === 'function' ? cwd() : cwd || process.cwd();
}

function getDefaultProjectSkillsDir(cwd: string): string {
  return path.join(cwd, '.echo', 'skills');
}

function getDefaultBuiltinSkillsDir(): string {
  return path.join(__dirname, 'builtin');
}

function getDefaultUserSkillsDir(): string {
  return path.join(os.homedir(), '.echo', 'skills');
}

export {
  SKILL_FILE_NAME,
  createSkillRegistry,
  getDefaultBuiltinSkillsDir,
  getDefaultProjectSkillsDir,
  getDefaultUserSkillsDir,
  parseSkillFile
};

export type {ParsedSkillFile, SkillRegistryOptions};

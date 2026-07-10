import * as fs from 'node:fs';
import path from 'node:path';

const SKILL_STATE_FILE_NAME = 'skills.json';
const SKILL_STATE_SCHEMA_VERSION = 1;

type SkillStateFile = {
  schemaVersion: number;
  disabled: string[];
};

type SkillStateStoreOptions = {
  createTempPath?: (targetPath: string) => string;
  mkdir?: (dirPath: string, options: {recursive: boolean}) => unknown;
  readFile?: (filePath: string, encoding: BufferEncoding) => string;
  rename?: (oldPath: string, newPath: string) => unknown;
  writeFile?: (filePath: string, data: string) => unknown;
};

type SkillStateStore = {
  readDisabled: (rootDir: string) => Set<string>;
  writeDisabled: (rootDir: string, disabled: string[]) => void;
};

/**
 * 读写 skill root 下的启用状态文件；读取失败按空状态降级，避免配置损坏阻断主流程。
 */
function createSkillStateStore(options: SkillStateStoreOptions = {}): SkillStateStore {
  const readFile = options.readFile || fs.readFileSync;
  const mkdir = options.mkdir || fs.mkdirSync;
  const writeFile = options.writeFile || fs.writeFileSync;
  const rename = options.rename || fs.renameSync;
  const createTempPath = options.createTempPath || ((targetPath: string) => `${targetPath}.tmp-${process.pid}-${Date.now()}`);

  return {
    readDisabled(rootDir: string): Set<string> {
      const state = readSkillStateFile(path.join(rootDir, SKILL_STATE_FILE_NAME), readFile);
      return new Set(state.disabled);
    },
    writeDisabled(rootDir: string, disabled: string[]): void {
      const targetPath = path.join(rootDir, SKILL_STATE_FILE_NAME);
      const tempPath = createTempPath(targetPath);
      const state: SkillStateFile = {
        schemaVersion: SKILL_STATE_SCHEMA_VERSION,
        disabled: [...new Set(disabled)].sort((left, right) => left.localeCompare(right))
      };

      mkdir(rootDir, {recursive: true});
      writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      rename(tempPath, targetPath);
    }
  };
}

function readSkillStateFile(filePath: string, readFile: (filePath: string, encoding: BufferEncoding) => string): SkillStateFile {
  let rawContent: string;

  try {
    rawContent = readFile(filePath, 'utf8');
  } catch {
    return createEmptySkillState();
  }

  try {
    const parsed: unknown = JSON.parse(rawContent);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return createEmptySkillState();
    }

    const disabled = (parsed as Record<string, unknown>).disabled;

    if (!Array.isArray(disabled) || !disabled.every((item) => typeof item === 'string')) {
      return createEmptySkillState();
    }

    return {
      schemaVersion: SKILL_STATE_SCHEMA_VERSION,
      disabled: disabled.map((item) => item.trim()).filter((item) => item !== '')
    };
  } catch {
    return createEmptySkillState();
  }
}

function createEmptySkillState(): SkillStateFile {
  return {schemaVersion: SKILL_STATE_SCHEMA_VERSION, disabled: []};
}

export {
  SKILL_STATE_FILE_NAME,
  SKILL_STATE_SCHEMA_VERSION,
  createSkillStateStore,
  readSkillStateFile
};

export type {SkillStateFile, SkillStateStore, SkillStateStoreOptions};

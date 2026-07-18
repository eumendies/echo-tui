import * as fs from 'node:fs';
import path from 'node:path';

const SKILL_STATE_FILE_NAME = 'skills.json';
const SKILL_STATE_SCHEMA_VERSION = 2;

type SkillStateFile = {
  schemaVersion: number;
  disabled: string[];
  modelOverrides: Record<string, string>;
};

type SkillStateStoreOptions = {
  createTempPath?: (targetPath: string) => string;
  mkdir?: (dirPath: string, options: {recursive: boolean}) => unknown;
  readFile?: (filePath: string, encoding: BufferEncoding) => string;
  rename?: (oldPath: string, newPath: string) => unknown;
  writeFile?: (filePath: string, data: string) => unknown;
};

type SkillStateStore = {
  readState: (rootDir: string) => SkillStateFile;
  writeState: (rootDir: string, state: Pick<SkillStateFile, 'disabled' | 'modelOverrides'>) => void;
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
    readState(rootDir: string): SkillStateFile {
      return readSkillStateFile(path.join(rootDir, SKILL_STATE_FILE_NAME), readFile);
    },
    writeState(rootDir: string, input: Pick<SkillStateFile, 'disabled' | 'modelOverrides'>): void {
      const targetPath = path.join(rootDir, SKILL_STATE_FILE_NAME);
      const tempPath = createTempPath(targetPath);
      const state: SkillStateFile = {
        schemaVersion: SKILL_STATE_SCHEMA_VERSION,
        disabled: [...new Set(input.disabled)].sort((left, right) => left.localeCompare(right)),
        modelOverrides: Object.fromEntries(
          Object.entries(input.modelOverrides).sort(([left], [right]) => left.localeCompare(right))
        )
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

    const record = parsed as Record<string, unknown>;
    const disabled = normalizeDisabled(record.disabled);
    const modelOverrides = normalizeModelOverrides(record.modelOverrides);

    return {
      schemaVersion: SKILL_STATE_SCHEMA_VERSION,
      disabled,
      modelOverrides
    };
  } catch {
    return createEmptySkillState();
  }
}

function createEmptySkillState(): SkillStateFile {
  return {schemaVersion: SKILL_STATE_SCHEMA_VERSION, disabled: [], modelOverrides: {}};
}

function normalizeDisabled(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return [];
  }

  return value.map((item) => item.trim()).filter((item) => item !== '');
}

function normalizeModelOverrides(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const entries: Array<[string, string]> = [];

  for (const [skillName, profileId] of Object.entries(value)) {
    if (typeof profileId !== 'string') {
      continue;
    }

    const normalizedSkillName = skillName.trim();
    const normalizedProfileId = profileId.trim();

    if (normalizedSkillName && normalizedProfileId) {
      entries.push([normalizedSkillName, normalizedProfileId]);
    }
  }

  return Object.fromEntries(entries);
}

export {
  SKILL_STATE_FILE_NAME,
  SKILL_STATE_SCHEMA_VERSION,
  createSkillStateStore,
  readSkillStateFile
};

export type {SkillStateFile, SkillStateStore, SkillStateStoreOptions};

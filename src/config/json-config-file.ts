import fs from 'node:fs';
import path from 'node:path';

type JsonConfigObject = Record<string, unknown>;

type JsonConfigFileOptions = {
  createTempPath?: (targetPath: string) => string;
  mkdir?: (dirPath: string, options: {recursive: boolean}) => unknown;
  readFile?: (filePath: string, encoding: BufferEncoding) => string;
  rename?: (oldPath: string, newPath: string) => unknown;
  writeFile?: (filePath: string, data: string) => unknown;
};

type JsonConfigFileErrorKind = 'invalid_json' | 'invalid_root' | 'missing' | 'read';

class JsonConfigFileError extends Error {
  readonly filePath: string;
  readonly kind: JsonConfigFileErrorKind;

  constructor(kind: JsonConfigFileErrorKind, filePath: string) {
    super(createJsonConfigFileErrorMessage(kind, filePath));
    this.name = 'JsonConfigFileError';
    this.filePath = filePath;
    this.kind = kind;
  }
}

/**
 * 管理单个 JSON object 配置文件的读取和原子替换；领域模块负责节点校验与变换。
 */
class JsonConfigFile {
  private readonly createTempPath: (targetPath: string) => string;
  private readonly filePath: string;
  private readonly mkdir: (dirPath: string, options: {recursive: boolean}) => unknown;
  private readonly readFile: (filePath: string, encoding: BufferEncoding) => string;
  private readonly rename: (oldPath: string, newPath: string) => unknown;
  private readonly writeFile: (filePath: string, data: string) => unknown;

  constructor(filePath: string, options: JsonConfigFileOptions = {}) {
    this.filePath = filePath;
    this.readFile = options.readFile || fs.readFileSync;
    this.mkdir = options.mkdir || fs.mkdirSync;
    this.writeFile = options.writeFile || fs.writeFileSync;
    this.rename = options.rename || fs.renameSync;
    this.createTempPath = options.createTempPath || ((targetPath: string) => `${targetPath}.tmp-${process.pid}-${Date.now()}`);
  }

  /**
   * 严格读取配置根对象；缺失、不可读、JSON 无效或根节点错误都会抛出分类错误。
   */
  read(): JsonConfigObject {
    let rawConfig: string;

    try {
      rawConfig = this.readFile(this.filePath, 'utf8');
    } catch (error: unknown) {
      throw new JsonConfigFileError(isNodeErrorCode(error, 'ENOENT') ? 'missing' : 'read', this.filePath);
    }

    let parsedConfig: unknown;

    try {
      parsedConfig = JSON.parse(rawConfig);
    } catch {
      throw new JsonConfigFileError('invalid_json', this.filePath);
    }

    if (!isJsonConfigObject(parsedConfig)) {
      throw new JsonConfigFileError('invalid_root', this.filePath);
    }

    return parsedConfig;
  }

  /**
   * 容错读取可选配置；任何文件或 JSON 错误都降级为空对象。
   */
  readOptional(): JsonConfigObject {
    try {
      return this.read();
    } catch {
      return {};
    }
  }

  /**
   * 为可创建配置的写入流程读取根对象；仅文件不存在时返回空对象。
   */
  readOrEmpty(): JsonConfigObject {
    try {
      return this.read();
    } catch (error: unknown) {
      if (error instanceof JsonConfigFileError && error.kind === 'missing') {
        return {};
      }

      throw error;
    }
  }

  /**
   * 重新读取当前文件、执行同步节点变换并原子替换；默认允许首次创建配置文件。
   */
  update(mutator: (rootConfig: JsonConfigObject) => void, options: {allowMissing?: boolean} = {}): void {
    const rootConfig = options.allowMissing === false ? this.read() : this.readOrEmpty();

    mutator(rootConfig);
    this.write(rootConfig);
  }

  /**
   * 将完整根对象写入临时文件后 rename 到目标路径，避免暴露半写入 JSON。
   */
  write(rootConfig: JsonConfigObject): void {
    const tempPath = this.createTempPath(this.filePath);

    this.mkdir(path.dirname(this.filePath), {recursive: true});
    this.writeFile(tempPath, `${JSON.stringify(rootConfig, null, 2)}\n`);
    this.rename(tempPath, this.filePath);
  }
}

function createJsonConfigFileErrorMessage(kind: JsonConfigFileErrorKind, filePath: string): string {
  switch (kind) {
    case 'missing':
      return `配置文件不存在：${filePath}`;
    case 'read':
      return `无法读取配置文件：${filePath}`;
    case 'invalid_json':
      return `配置文件不是有效 JSON：${filePath}`;
    case 'invalid_root':
      return `配置文件根节点必须是对象：${filePath}`;
  }
}

function isJsonConfigObject(value: unknown): value is JsonConfigObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

export {
  JsonConfigFile,
  JsonConfigFileError,
  isJsonConfigObject
};

export type {
  JsonConfigFileErrorKind,
  JsonConfigFileOptions,
  JsonConfigObject
};

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type UserConfigSource = Record<string, unknown>;

type ReadUserConfigOptions = {
  configPath?: string;
  readFile?: (filePath: string, encoding: BufferEncoding) => string;
};

function getDefaultUserConfigPath(): string {
  return path.join(os.homedir(), '.echo', 'config.json');
}

/**
 * 读取用户级配置根节点；失败时返回空对象，避免可选 TUI 配置阻断聊天能力。
 */
function readOptionalUserConfig(options: ReadUserConfigOptions = {}): UserConfigSource {
  const configPath = options.configPath || getDefaultUserConfigPath();
  const readFile = options.readFile || fs.readFileSync;
  let rawConfig: string;

  try {
    rawConfig = readFile(configPath, 'utf8');
  } catch {
    return {};
  }

  try {
    const parsedConfig: unknown = JSON.parse(rawConfig);
    return isPlainObject(parsedConfig) ? parsedConfig : {};
  } catch {
    return {};
  }
}

function isPlainObject(value: unknown): value is UserConfigSource {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export {
  getDefaultUserConfigPath,
  readOptionalUserConfig
};

export type {
  ReadUserConfigOptions,
  UserConfigSource
};

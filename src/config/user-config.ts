import os from 'node:os';
import path from 'node:path';

import {JsonConfigFile} from './json-config-file';

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

  return new JsonConfigFile(configPath, {readFile: options.readFile}).readOptional();
}

export {
  getDefaultUserConfigPath,
  readOptionalUserConfig
};

export type {
  ReadUserConfigOptions,
  UserConfigSource
};

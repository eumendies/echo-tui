import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import {JsonConfigFile} from './json-config-file';

type UserConfigSource = Record<string, unknown>;

const CONFIG_CHANGE_DEBOUNCE_MS = 75;

type ReadUserConfigOptions = {
  configPath?: string;
  readFile?: (filePath: string, encoding: BufferEncoding) => string;
};

type UserConfigWatcher = {
  close: () => void;
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

/**
 * 监听用户配置所在目录；目录监听可跨越配置文件的原子 rename 替换。
 */
function watchUserConfig(onChange: () => void, onError?: (error: Error) => void): UserConfigWatcher {
  const configPath = getDefaultUserConfigPath();
  const configDirectory = path.dirname(configPath);
  const configFileName = path.basename(configPath);
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const watcher = fs.watch(configDirectory, (_eventType, fileName) => {
    if (fileName !== null && fileName.toString() !== configFileName) {
      return;
    }

    if (changeTimer) {
      clearTimeout(changeTimer);
    }

    changeTimer = setTimeout(() => {
      changeTimer = undefined;

      if (!closed) {
        onChange();
      }
    }, CONFIG_CHANGE_DEBOUNCE_MS);
  });

  function close(): void {
    if (closed) {
      return;
    }

    closed = true;

    if (changeTimer) {
      clearTimeout(changeTimer);
      changeTimer = undefined;
    }

    watcher.close();
  }

  watcher.on('error', (error) => {
    close();
    onError?.(error);
  });

  return {
    close
  };
}

export {
  getDefaultUserConfigPath,
  readOptionalUserConfig,
  watchUserConfig
};

export type {
  ReadUserConfigOptions,
  UserConfigSource,
  UserConfigWatcher
};

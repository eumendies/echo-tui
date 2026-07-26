import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import {JsonConfigFile} from './json-config-file';

type UserConfigSource = Record<string, unknown>;

const CONFIG_CHANGE_DEBOUNCE_MS = 75;
const CONFIG_WATCHFILE_INTERVAL_MS = 100;

type ReadUserConfigOptions = {
  configPath?: string;
  readFile?: (filePath: string, encoding: BufferEncoding) => string;
};

type UserConfigWatcher = {
  close: () => void;
};

type ConfigFileSnapshot =
  | {exists: false}
  | {exists: true; ino: number; mtimeMs: number; size: number};

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

function createConfigFileSnapshot(stats: fs.Stats): ConfigFileSnapshot {
  if (stats.nlink === 0) {
    return {exists: false};
  }

  return {
    exists: true,
    ino: stats.ino,
    mtimeMs: stats.mtimeMs,
    size: stats.size
  };
}

function readConfigFileSnapshot(configPath: string): ConfigFileSnapshot {
  try {
    return createConfigFileSnapshot(fs.statSync(configPath));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {exists: false};
    }

    throw error;
  }
}

function areConfigFileSnapshotsEqual(left: ConfigFileSnapshot, right: ConfigFileSnapshot): boolean {
  if (!left.exists || !right.exists) {
    return left.exists === right.exists;
  }

  return left.ino === right.ino && left.mtimeMs === right.mtimeMs && left.size === right.size;
}

/**
 * 监听用户配置所在目录；目录监听可跨越配置文件的原子 rename 替换，资源不足时退回轮询。
 */
function watchUserConfig(onChange: () => void, onError?: (error: Error) => void): UserConfigWatcher {
  const configPath = getDefaultUserConfigPath();
  const configDirectory = path.dirname(configPath);
  const configFileName = path.basename(configPath);
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let watcher: fs.FSWatcher | undefined;
  let pollListener: ((current: fs.Stats, previous: fs.Stats) => void) | undefined;
  let lastSnapshot = readConfigFileSnapshot(configPath);

  function scheduleChange(): void {
    if (closed) {
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
  }

  function startPollingFallback(): void {
    if (closed || pollListener) {
      return;
    }

    pollListener = (current) => {
      const currentSnapshot = createConfigFileSnapshot(current);

      if (areConfigFileSnapshotsEqual(lastSnapshot, currentSnapshot)) {
        return;
      }

      lastSnapshot = currentSnapshot;
      scheduleChange();
    };

    fs.watchFile(configPath, {interval: CONFIG_WATCHFILE_INTERVAL_MS}, pollListener);

    const currentSnapshot = readConfigFileSnapshot(configPath);
    if (!areConfigFileSnapshotsEqual(lastSnapshot, currentSnapshot)) {
      lastSnapshot = currentSnapshot;
      scheduleChange();
    }
  }

  function closeFsWatcher(): void {
    if (!watcher) {
      return;
    }

    watcher.close();
    watcher = undefined;
  }

  function closePollingFallback(): void {
    if (!pollListener) {
      return;
    }

    fs.unwatchFile(configPath, pollListener);
    pollListener = undefined;
  }

  function close(): void {
    if (closed) {
      return;
    }

    closed = true;

    if (changeTimer) {
      clearTimeout(changeTimer);
      changeTimer = undefined;
    }

    closeFsWatcher();
    closePollingFallback();
  }

  function handleWatchFailure(error: Error): void {
    closeFsWatcher();

    try {
      startPollingFallback();
    } catch (fallbackError) {
      close();
      onError?.(fallbackError instanceof Error ? fallbackError : error);
    }
  }

  try {
    watcher = fs.watch(configDirectory, (_eventType, fileName) => {
      if (fileName !== null && fileName.toString() !== configFileName) {
        return;
      }

      lastSnapshot = readConfigFileSnapshot(configPath);
      scheduleChange();
    });

    watcher.on('error', handleWatchFailure);
  } catch (error) {
    handleWatchFailure(error instanceof Error ? error : new Error(String(error)));
  }

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

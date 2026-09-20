import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type UpdateState = {
  lastCheckedAt?: number; // 最近一次成功检查的毫秒时间戳；缺失表示尚无有效缓存
  latestVersion?: string; // 最近一次成功检查看到的 registry latest 版本
  ignoredVersion?: string; // 用户选择忽略的版本；仅该版本不再提示，更高版本恢复提示
  restartGuardAt?: number; // 最近一次更新重启的毫秒时间戳；短窗口内重启进程跳过重新提示
};

/**
 * 返回更新状态文件的默认路径；该文件独立于 config.json，写入不会触发用户配置 watcher。
 */
function getDefaultUpdateStatePath(): string {
  return path.join(os.homedir(), '.echo', 'update-state.json');
}

/**
 * 容错读取更新状态：文件缺失、JSON 损坏或字段类型非法都按"无状态"处理，绝不阻断启动。
 */
function readUpdateState(filePath: string = getDefaultUpdateStatePath()): UpdateState {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const record = parsed as Record<string, unknown>;
    return {
      ...(typeof record.lastCheckedAt === 'number' && Number.isFinite(record.lastCheckedAt) ? {lastCheckedAt: record.lastCheckedAt} : {}),
      ...(typeof record.latestVersion === 'string' && record.latestVersion !== '' ? {latestVersion: record.latestVersion} : {}),
      ...(typeof record.ignoredVersion === 'string' && record.ignoredVersion !== '' ? {ignoredVersion: record.ignoredVersion} : {}),
      ...(typeof record.restartGuardAt === 'number' && Number.isFinite(record.restartGuardAt) ? {restartGuardAt: record.restartGuardAt} : {})
    };
  } catch {
    return {};
  }
}

/**
 * 原子写入更新状态：先写同目录临时文件再 rename，避免下次读取到半写 JSON；失败向上抛出由调用方决定降级。
 */
function writeUpdateState(state: UpdateState, filePath: string = getDefaultUpdateStatePath()): void {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  const tempPath = `${filePath}.${process.pid}.tmp`;

  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`);
    fs.renameSync(tempPath, filePath);
  } catch (error: unknown) {
    try {
      fs.rmSync(tempPath, {force: true});
    } catch {
      // 临时文件清理失败不影响错误的最终归属。
    }

    throw error;
  }
}

export {
  getDefaultUpdateStatePath,
  readUpdateState,
  writeUpdateState
};

export type {
  UpdateState
};

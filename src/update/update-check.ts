import path from 'node:path';

import {getDefaultUpdateStatePath, readUpdateState, writeUpdateState} from './update-state';

type UpdateCheckFetch = (url: string, init: {headers: Record<string, string>; signal: AbortSignal}) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

type UpdateCheckOptions = {
  configEnabled: boolean; // 用户配置 updates.checkOnStartup 的归一化结果
  currentVersion: string; // 当前运行版本（package.json）
  env?: NodeJS.ProcessEnv; // npm registry 覆盖等环境输入来源，缺省 process.env
  fetchFn?: UpdateCheckFetch; // registry 请求实现，缺省全局 fetch
  now?: () => number; // 当前时间毫秒值，缺省 Date.now
  packageRoot?: string; // 当前运行副本根目录，缺省由模块位置推导
  statePath?: string; // 更新状态文件路径，缺省 ~/.echo/update-state.json
  timeoutMs?: number; // registry 请求超时，缺省 5s
  ttlMs?: number; // 成功检查的缓存有效期，缺省 24h
};

type UpdateCheckIdleReason =
  | 'config-disabled' // 用户配置关闭了启动检查
  | 'ignored' // 命中用户忽略的版本
  | 'not-installed' // 源码运行或 npx 缓存副本不参与检查
  | 'post-update-restart' // 处于更新重启后的防重复提示窗口
  | 'registry-error' // 请求、超时或响应失败且无有效缓存
  | 'up-to-date'; // 未发现更高的 latest 版本

type UpdateCheckResult =
  | {status: 'available'; currentVersion: string; latestVersion: string} // 存在需要提示的新版本
  | {status: 'none'; reason: UpdateCheckIdleReason}; // 无需提示及原因

type ParsedVersion = {
  major: number; // 主版本号；非法段按 0 处理
  minor: number; // 次版本号
  patch: number; // 修订号
};

const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
// scoped 包名的 latest 端点要求编码斜杠，registry.npmjs.org 与主流镜像均支持该形式。
const LATEST_ENDPOINT_PATH = '@eumendies%2Fecho-tui/latest';
// 更新重启后的防重复提示窗口：覆盖重启进程启动耗时，同时避免长期抑制正常检查。
const RESTART_GUARD_WINDOW_MS = 5 * 60 * 1000;
// 发布版本为纯数字 x.y.z；正则同时接受 v 前缀与 prerelease/build 后缀形态（防御性），但排序只按数字段进行。
const VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * 判断值是否为可解析的 semver 版本号；用于过滤 registry 响应里的非法 version 字段。
 * 前缀 v、prerelease 与 build 后缀形态都接受，但比较只按数字段进行。
 */
function isValidVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION_PATTERN.test(value.trim());
}

/**
 * 比较两个版本号；返回负数表示 left 更低、0 表示相等、正数表示 left 更高。
 * 只比较三段数字：数字段相同的版本视为相等（后缀不参与排序）；
 * 容忍前导 v、缺省段与非数字段（按 0 处理），因为当前版本可能来自本地 package.json 的手工版本号。
 */
function compareVersions(left: string, right: string): number {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);

  return parsedLeft.major - parsedRight.major
    || parsedLeft.minor - parsedRight.minor
    || parsedLeft.patch - parsedRight.patch;
}

function parseVersion(value: string): ParsedVersion {
  const segments = String(value).trim().replace(/^v/i, '').split('.');

  return {
    major: parseNumericSegment(segments[0]),
    minor: parseNumericSegment(segments[1]),
    patch: parseNumericSegment(segments[2])
  };
}

function parseNumericSegment(segment: string | undefined): number {
  const match = /^\d+/.exec(segment || '');
  return match ? Number(match[0]) : 0;
}

/**
 * 判断当前运行副本是否来自包管理器安装目录；源码运行（npm start / npm link）与 npx 缓存不参与检查。
 */
function isInstalledCopy(packageRoot: string): boolean {
  return packageRoot.includes(`${path.sep}node_modules${path.sep}`)
    && !packageRoot.includes(`${path.sep}_npx${path.sep}`);
}

/**
 * 推导当前包根目录；编译产物固定位于 dist/src/update，向上三级即包根（仓库根或 node_modules 内的包目录）。
 */
function resolveDefaultPackageRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

/**
 * 解析 registry 基址：优先 npm_config_registry（镜像/私有源），非法值回退官方源。
 */
function resolveRegistryBase(env: NodeJS.ProcessEnv): string {
  const configured = typeof env.npm_config_registry === 'string' ? env.npm_config_registry.trim() : '';

  if (configured !== '') {
    try {
      const url = new URL(configured);

      if (url.protocol === 'https:' || url.protocol === 'http:') {
        return url.href.replace(/\/+$/, '');
      }
    } catch {
      // 非法 URL 直接回退官方源。
    }
  }

  return DEFAULT_REGISTRY_URL;
}

/**
 * 请求 registry 的 latest 端点；任何失败（超时、非 2xx、响应非法）都返回 null 由调用方静默处理。
 */
async function fetchLatestVersion(options: {
  fetchFn: UpdateCheckFetch;
  currentVersion: string;
  registryBase: string;
  timeoutMs: number;
}): Promise<string | null> {
  try {
    const response = await options.fetchFn(`${options.registryBase}/${LATEST_ENDPOINT_PATH}`, {
      headers: {
        accept: 'application/json',
        'user-agent': `echo-tui/${options.currentVersion}`
      },
      signal: AbortSignal.timeout(options.timeoutMs)
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as unknown;

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }

    const version = (payload as Record<string, unknown>).version;
    return isValidVersion(version) ? version.trim() : null;
  } catch {
    return null;
  }
}

/**
 * 执行一次启动更新检查：先做配置开关与运行副本资格判定，处于更新重启窗口时直接跳过，
 * 再按 TTL 缓存决定是否联网，最后比较版本并应用忽略语义。
 * 所有网络与文件失败静默降级；该函数不产生终端输出、不写 transcript、不改用户配置。
 */
async function checkForUpdate(options: UpdateCheckOptions): Promise<UpdateCheckResult> {
  const env = options.env || process.env;

  if (!options.configEnabled) {
    return {status: 'none', reason: 'config-disabled'};
  }

  if (!isInstalledCopy(options.packageRoot || resolveDefaultPackageRoot())) {
    return {status: 'none', reason: 'not-installed'};
  }

  const now = (options.now || Date.now)();
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const statePath = options.statePath || getDefaultUpdateStatePath();
  const state = readUpdateState(statePath);

  // 更新流程主动重启后，短窗口内不再重新提示；标记由 update-runner 在重启前写入。
  if (typeof state.restartGuardAt === 'number' && now >= state.restartGuardAt && now - state.restartGuardAt < RESTART_GUARD_WINDOW_MS) {
    return {status: 'none', reason: 'post-update-restart'};
  }

  const cacheFresh = typeof state.lastCheckedAt === 'number'
    && typeof state.latestVersion === 'string'
    && now >= state.lastCheckedAt
    && now - state.lastCheckedAt < ttlMs;
  let latestVersion: string;

  if (cacheFresh) {
    latestVersion = state.latestVersion as string;
  } else {
    const fetched = await fetchLatestVersion({
      fetchFn: options.fetchFn || ((url, init) => fetch(url, init)),
      currentVersion: options.currentVersion,
      registryBase: resolveRegistryBase(env),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    });

    if (fetched === null) {
      return {status: 'none', reason: 'registry-error'};
    }

    latestVersion = fetched;

    try {
      writeUpdateState({...state, lastCheckedAt: now, latestVersion}, statePath);
    } catch {
      // 缓存写入失败只影响下次启动是否重新联网，不影响本次提示路径。
    }
  }

  if (compareVersions(latestVersion, options.currentVersion) <= 0) {
    return {status: 'none', reason: 'up-to-date'};
  }

  if (state.ignoredVersion === latestVersion) {
    return {status: 'none', reason: 'ignored'};
  }

  return {status: 'available', currentVersion: options.currentVersion, latestVersion};
}

export {
  checkForUpdate,
  compareVersions,
  isValidVersion
};

export type {
  UpdateCheckIdleReason,
  UpdateCheckOptions,
  UpdateCheckResult
};

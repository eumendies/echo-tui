import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {SandboxCommandInput, SandboxPolicy, SandboxProvider} from './types';

const MACOS_SANDBOX_EXEC_PATH = '/usr/bin/sandbox-exec'; // macOS 自带 Seatbelt 前端;已 deprecated,缺失时按不可用降级。
const MACOS_SEATBELT_PROVIDER_NAME = 'macos-seatbelt';
const MACOS_SANDBOX_UNAVAILABLE_REASON = 'sandbox-exec 不可用'; // /status 降级说明;保持既有展示文案不变。

type MacosSeatbeltProviderOptions = {
  sandboxExecPath?: string; // 沙箱前端可执行文件路径;测试可注入。
  exists?: (targetPath: string) => boolean; // 存在性探测;测试可注入。
  realpath?: (targetPath: string) => string; // 路径归一化;测试可注入。
  homedir?: () => string; // 用户主目录;用于内置 agent-memory 写入路径。
  tmpdir?: () => string; // 进程临时目录;realpath 后进入可写集。
};

/**
 * 创建 macOS Seatbelt 沙箱 provider;把 (shell -lc command) 包装为 sandbox-exec -p <profile> 形式的 spawn argv。
 * profile 由 deny default 加定向 allow 组成,只把"写"与"网"作为边界,读取全盘放行以保住常规工具链。
 */
function createMacosSeatbeltSandboxProvider(options: MacosSeatbeltProviderOptions = {}): SandboxProvider {
  const sandboxExecPath = options.sandboxExecPath || MACOS_SANDBOX_EXEC_PATH;
  const exists = options.exists || fs.existsSync;
  const realpath = options.realpath || fs.realpathSync;
  const homedir = options.homedir || os.homedir;
  const tmpdir = options.tmpdir || os.tmpdir;

  return {
    name: MACOS_SEATBELT_PROVIDER_NAME,
    isAvailable: () => exists(sandboxExecPath),
    describeUnavailable: () => MACOS_SANDBOX_UNAVAILABLE_REASON,
    wrapCommand(input: SandboxCommandInput, policy: SandboxPolicy): string[] | null {
      if (policy.mode === 'off' || !exists(sandboxExecPath)) {
        return null;
      }

      // read-only 档语义恒为禁网;在 provider 层归一化,保证任何上游传参下档位不变体。
      // off 已在上面提前返回,此处 mode 只剩两档;TS 需要显式收窄到非 off 类型。
      const mode = policy.mode === 'read-only' ? 'read-only' as const : 'workspace-write' as const;
      const network = mode === 'read-only' ? false : policy.network;
      const profile = buildSeatbeltProfile({
        mode,
        network,
        writablePaths: resolveSandboxWritablePaths({
          cwd: input.cwd,
          extraWritablePaths: policy.extraWritablePaths,
          homedir,
          mode,
          realpath,
          tmpdir
        })
      });
      return [sandboxExecPath, '-p', profile, input.shell, '-lc', input.command];
    }
  };
}

/**
 * 由策略生成 Seatbelt profile 文本;mach-lookup 等 v1 全部放宽,后续按实际失败案例迭代收紧。
 */
function buildSeatbeltProfile(options: {mode: 'read-only' | 'workspace-write'; network: boolean; writablePaths: string[]}): string {
  const writeFilters = [
    ...options.writablePaths.map((writablePath) => `  (subpath "${escapeSeatbeltString(writablePath)}")`),
    '  (literal "/dev/null")',
    '  (literal "/dev/dtracehelper")'
  ].join('\n');
  const networkRules = options.network ? '(allow network*)\n(allow system-socket)' : '(deny network*)';

  return [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    '(allow process-info*)',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow iokit*)',
    '(allow ipc-posix-shm)',
    '(allow ipc-posix-sem)',
    '(allow file-read*)',
    `(allow file-write*\n${writeFilters})`,
    networkRules
  ].join('\n');
}

/**
 * 计算可写路径集合;symlink 必须归一化(macOS 的 /tmp、/var 指向 /private/*),不存在的目录保留原路径,
 * 因为 subpath 规则按路径前缀匹配,目录稍后创建也能命中。read-only 档不包含工作区与 agent-memory。
 */
function resolveSandboxWritablePaths(options: {
  cwd: string;
  extraWritablePaths: string[];
  homedir: () => string;
  mode: 'read-only' | 'workspace-write';
  realpath: (targetPath: string) => string;
  tmpdir: () => string;
}): string[] {
  const paths = [realpathSafe(options.realpath, options.tmpdir()), '/private/tmp'];

  if (options.mode === 'workspace-write') {
    paths.unshift(realpathSafe(options.realpath, options.cwd));
    paths.push(realpathSafe(options.realpath, path.join(options.homedir(), '.echo', 'agent-memory')));
    paths.push(...options.extraWritablePaths.map((extraPath) => realpathSafe(options.realpath, extraPath)));
  }

  return [...new Set(paths)];
}

function realpathSafe(realpath: (targetPath: string) => string, targetPath: string): string {
  try {
    return realpath(targetPath);
  } catch {
    return targetPath;
  }
}

function escapeSeatbeltString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export {
  MACOS_SANDBOX_EXEC_PATH,
  MACOS_SEATBELT_PROVIDER_NAME,
  buildSeatbeltProfile,
  createMacosSeatbeltSandboxProvider
};

export type {
  MacosSeatbeltProviderOptions
};

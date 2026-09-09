import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {SandboxCommandInput, SandboxPolicy, SandboxProvider} from './types';

const LINUX_BWRAP_PATH = '/usr/bin/bwrap'; // 大多数发行版的标准安装位置;发现优先级最高,缺失时继续按 PATH 探测。
const LINUX_BUBBLEWRAP_PROVIDER_NAME = 'linux-bubblewrap';
const BWRAP_TRIAL_TIMEOUT_MS = 5_000;
// 试运行复刻真实命令的 mount 形态(ro-bind 在前 + dev/proc/tmpfs 覆盖);嵌套容器等受限环境
// 会在探测期直接失败并显式降级,而不是让每条命令执行期才报错。/bin/true 在主流发行版必然存在。
const BWRAP_TRIAL_ARGS = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp', '/bin/true'];

type LinuxBubblewrapProviderOptions = {
  bwrapPath?: string; // 固定使用的 bwrap 路径;设置时跳过自动发现,测试可注入。
  exists?: (targetPath: string) => boolean; // 存在性探测;测试可注入。
  realpath?: (targetPath: string) => string; // 路径归一化;测试可注入。
  homedir?: () => string; // 用户主目录;用于内置 agent-memory 写入路径。
  tmpdir?: () => string; // 进程临时目录;不在 /tmp 下时补 bind。
  envPath?: string; // 探测用 PATH;缺省取 process.env.PATH,测试可注入。
  probe?: (bwrapPath: string) => boolean; // 试运行探测;测试可注入。
  mkdir?: (targetPath: string) => void; // 可写目录预创建;测试可注入以避免真实文件系统副作用。
};

/**
 * 创建 Linux bubblewrap 沙箱 provider;把 (shell -lc command) 包装为 bwrap spawn argv。
 * bwrap 的文件系统选项按命令行顺序生效,mount 顺序按"先全局只读、后定向放行"组织:
 * --ro-bind / / 必须最先挂,否则会把后到的 --dev/--proc 盖成宿主只读视图(/dev/null 变只读);
 * ro-bind 之后用 dev/proc/tmpfs 覆盖出可写边界,读取全盘放行以保住常规工具链;
 * 不做 PID namespace 隔离,保持进程组终止语义最简单。
 */
function createLinuxBubblewrapSandboxProvider(options: LinuxBubblewrapProviderOptions = {}): SandboxProvider {
  const exists = options.exists || fs.existsSync;
  const realpath = options.realpath || fs.realpathSync;
  const homedir = options.homedir || os.homedir;
  const tmpdir = options.tmpdir || os.tmpdir;
  const probeTrial = options.probe || probeBubblewrapSandbox;
  const mkdirWritablePath = options.mkdir || ((targetPath: string) => fs.mkdirSync(targetPath, {recursive: true}));
  // 试运行结果缓存在实例内:二进制存在不代表能建立 user namespace(Ubuntu AppArmor、容器 seccomp 均可能拒绝),
  // 首次探测后同一 provider 不再重复 spawnSync。
  let discoveredPath: string | null = null;
  let probeResult: boolean | null = null;

  const resolveProbe = (): {path: string | null; ok: boolean} => {
    if (probeResult === null) {
      discoveredPath = discoverBwrapPath(exists, options);
      probeResult = discoveredPath !== null ? probeTrial(discoveredPath) : false;
    }

    return {path: discoveredPath, ok: probeResult};
  };

  return {
    name: LINUX_BUBBLEWRAP_PROVIDER_NAME,
    isAvailable: () => resolveProbe().ok,
    describeUnavailable() {
      const probe = resolveProbe();
      // 两级降级原因分开展示,便于用户区分"没装"与"装了但环境受限"。
      return probe.path === null
        ? '未找到 bubblewrap 可执行文件'
        : 'bubblewrap 沙箱试运行失败(可能受 AppArmor/容器限制)';
    },
    wrapCommand(input: SandboxCommandInput, policy: SandboxPolicy): string[] | null {
      if (policy.mode === 'off') {
        return null;
      }

      const probe = resolveProbe();
      if (!probe.ok || probe.path === null) {
        return null;
      }

      // read-only 档语义恒为禁网;在 provider 层归一化,保证任何上游传参下档位不变体。
      // off 已提前返回,此处 mode 只剩两档;TS 需要显式收窄到非 off 类型。
      const mode = policy.mode === 'read-only' ? 'read-only' as const : 'workspace-write' as const;
      const network = mode === 'read-only' ? false : policy.network;
      const argv = [
        '--die-with-parent',
        ...(network ? [] : ['--unshare-net']),
        '--ro-bind', '/', '/',
        // 全盘只读之后才能覆盖挂载;顺序颠倒会让 ro-bind 把 /dev、/proc 盖成宿主只读视图。
        '--dev', '/dev',
        '--proc', '/proc',
        '--tmpfs', '/tmp',
        // 最小设备集不含 /dev/shm;node/java/chrome 等工具链依赖 POSIX 共享内存,补一个私有 tmpfs。
        '--tmpfs', '/dev/shm',
        ...buildWritableBinds({
          cwd: input.cwd,
          extraWritablePaths: policy.extraWritablePaths,
          homedir,
          mode,
          mkdirWritablePath,
          realpath,
          tmpdir
        }),
        input.shell,
        '-lc',
        input.command
      ];
      return [probe.path, ...argv];
    }
  };
}

/**
 * 发现 bwrap 可执行文件:优先 /usr/bin/bwrap,再按 PATH 顺序扫描;
 * 显式注入 bwrapPath 时跳过自动发现,Linux 发行版安装位置多样,单一固定路径不够。
 */
function discoverBwrapPath(exists: (targetPath: string) => boolean, options: LinuxBubblewrapProviderOptions): string | null {
  if (options.bwrapPath) {
    return exists(options.bwrapPath) ? options.bwrapPath : null;
  }

  const searchPath = options.envPath ?? process.env.PATH ?? '';
  const candidates = [
    LINUX_BWRAP_PATH,
    ...searchPath.split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, 'bwrap'))
  ];

  for (const candidate of candidates) {
    if (exists(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * 试运行探测真实建沙能力;通过后结果由调用方缓存,不在每条命令路径上重复执行。
 */
function probeBubblewrapSandbox(bwrapPath: string): boolean {
  const trial = spawnSync(bwrapPath, BWRAP_TRIAL_ARGS, {stdio: 'ignore', timeout: BWRAP_TRIAL_TIMEOUT_MS});
  return trial.error === undefined && trial.status === 0;
}

/**
 * 计算可写边界 bind 参数:进程 TMPDIR 不在 /tmp 下时两种档位都补 bind(在 /tmp 下由 tmpfs 覆盖),
 * workspace-write 档追加严格 bind 的工作区,以及 best-effort 预创建后 --bind-try 的 agent-memory 与追加目录;
 * 预创建失败(权限等)时 --bind-try 会跳过该目录,避免单个不存在的可写路径让所有沙箱命令整体失败。
 */
function buildWritableBinds(options: {
  cwd: string;
  extraWritablePaths: string[];
  homedir: () => string;
  mode: 'read-only' | 'workspace-write';
  mkdirWritablePath: (targetPath: string) => void;
  realpath: (targetPath: string) => string;
  tmpdir: () => string;
}): string[] {
  const binds: string[] = [];
  const tmpPath = realpathSafe(options.realpath, options.tmpdir());

  if (tmpPath !== '/tmp' && !tmpPath.startsWith('/tmp/')) {
    binds.push('--bind-try', tmpPath, tmpPath);
  }

  if (options.mode === 'workspace-write') {
    // 工作区是执行前置条件(spawn 时 cwd 必须已存在),用严格 bind 保证边界一定生效。
    binds.push('--bind', options.cwd, options.cwd);
    binds.push(...bindOptionalPath(options.mkdirWritablePath, realpathSafe(options.realpath, path.join(options.homedir(), '.echo', 'agent-memory'))));
    for (const extraPath of options.extraWritablePaths) {
      binds.push(...bindOptionalPath(options.mkdirWritablePath, realpathSafe(options.realpath, extraPath)));
    }
  }

  return binds;
}

function bindOptionalPath(mkdirWritablePath: (targetPath: string) => void, targetPath: string): string[] {
  // bwrap 的 bind 源路径必须存在;symlink 经 realpath 归一化后即使目录尚未创建也能先建出来,
  // 与 macOS 侧"目录稍后创建也能命中规则"的语义对齐。
  try {
    mkdirWritablePath(targetPath);
  } catch {
    // 预创建失败时保持原路径,由 --bind-try 兜底跳过。
  }

  return ['--bind-try', targetPath, targetPath];
}

function realpathSafe(realpath: (targetPath: string) => string, targetPath: string): string {
  try {
    return realpath(targetPath);
  } catch {
    return targetPath;
  }
}

export {
  LINUX_BUBBLEWRAP_PROVIDER_NAME,
  LINUX_BWRAP_PATH,
  createLinuxBubblewrapSandboxProvider
};

export type {
  LinuxBubblewrapProviderOptions
};

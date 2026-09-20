import {spawn} from 'node:child_process';

import {getDefaultUpdateStatePath, readUpdateState, writeUpdateState} from './update-state';

type SpawnFunction = typeof spawn;

type RunUpdateAndRestartOptions = {
  latestVersion: string; // 本次更新的目标版本，仅用于前台状态文案
  argv?: string[]; // 原进程参数，缺省 process.argv；重启时复用入口脚本与原始参数
  cwd?: string; // 前台命令与重启进程的工作目录，缺省 process.cwd()
  env?: NodeJS.ProcessEnv; // 子进程环境，缺省 process.env
  execPath?: string; // 重启使用的 Node 可执行文件，缺省 process.execPath
  platform?: NodeJS.Platform; // 平台判定（Windows 需要 shell 启动 npm.cmd），缺省 process.platform
  spawnFn?: SpawnFunction; // 子进程创建替换缝，缺省 node:child_process.spawn
  statePath?: string; // 更新状态文件路径（写入重启防重弹标记），缺省 ~/.echo/update-state.json
  write?: (text: string) => void; // 状态文案输出，缺省写 process.stdout
};

const PACKAGE_SPEC = '@eumendies/echo-tui@latest';
const MANUAL_UPDATE_COMMAND = `npm install -g ${PACKAGE_SPEC}`;

/**
 * 等待子进程结算：error 与 close 竞争时以先到者为准，避免 spawn 失败时悬挂。
 */
function waitForChildExit(child: ReturnType<SpawnFunction>): Promise<{code: number | null; error?: Error}> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: {code: number | null; error?: Error}): void => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    child.on('error', (error: Error) => settle({code: null, error}));
    child.on('close', (code: number | null) => settle({code}));
  });
}

/**
 * 运行单个前台子进程；同步抛出（非法参数等）也归一为 error 结果，保持调用路径一致。
 */
function runChildProcess(
  spawnFn: SpawnFunction,
  command: string,
  args: string[],
  options: {cwd: string; env: NodeJS.ProcessEnv; shell: boolean}
): Promise<{code: number | null; error?: Error}> {
  try {
    return waitForChildExit(spawnFn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: options.shell,
      stdio: 'inherit'
    }));
  } catch (error: unknown) {
    return Promise.resolve({code: null, error: error instanceof Error ? error : new Error(String(error))});
  }
}

/**
 * 重启前写入短窗口标记：重启进程在窗口内跳过更新检查，避免更新或失败后立即重复弹出提示。
 * 标记写入是尽力而为，失败不影响重启本身。
 */
function writeRestartGuard(statePath: string): void {
  try {
    writeUpdateState({...readUpdateState(statePath), restartGuardAt: Date.now()}, statePath);
  } catch {
    // 状态文件不可写时放弃防重弹保护。
  }
}

/**
 * 前台执行全局更新并重启 echo-tui：npm 输出直通终端；安装失败仍以当前版本重启，避免把用户甩回 shell。
 * 返回调用方应使用的进程退出码；重启前写入短窗口防重弹标记，避免重启进程立即重复弹出提示。
 */
async function runUpdateAndRestart(options: RunUpdateAndRestartOptions): Promise<number> {
  const write = options.write || ((text: string) => { process.stdout.write(text); });
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const spawnFn = options.spawnFn || spawn;
  const platform = options.platform || process.platform;
  const execPath = options.execPath || process.execPath;
  const argv = options.argv || process.argv;

  write(`\n正在更新 @eumendies/echo-tui 到 v${options.latestVersion}…\n`);

  const installResult = await runChildProcess(spawnFn, 'npm', ['install', '-g', PACKAGE_SPEC], {
    cwd,
    env,
    shell: platform === 'win32'
  });

  if (installResult.error) {
    write(`更新失败：${installResult.error.message}\n可稍后手动执行：${MANUAL_UPDATE_COMMAND}\n`);
    write('正在以当前版本重新启动 echo-tui…\n');
  } else if (installResult.code !== 0) {
    write(`更新失败（退出码 ${installResult.code === null ? '未知' : installResult.code}），可稍后手动执行：${MANUAL_UPDATE_COMMAND}\n`);
    write('正在以当前版本重新启动 echo-tui…\n');
  } else {
    write('更新完成，正在重新启动 echo-tui…\n');
  }

  const entry = argv[1];

  if (typeof entry !== 'string' || entry === '') {
    write(`无法自动重新启动，请手动重新运行：echo-tui\n`);
    return 1;
  }

  writeRestartGuard(options.statePath || getDefaultUpdateStatePath());

  const restartResult = await runChildProcess(spawnFn, execPath, argv.slice(1), {
    cwd,
    env,
    shell: false
  });

  if (restartResult.error) {
    write(`无法自动重新启动：${restartResult.error.message}\n请手动重新运行：echo-tui\n`);
    return 1;
  }

  return restartResult.code === null ? 1 : restartResult.code;
}

export {
  runUpdateAndRestart
};

export type {
  RunUpdateAndRestartOptions
};

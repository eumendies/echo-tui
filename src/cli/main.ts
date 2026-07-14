import fs from 'node:fs';
import path from 'node:path';

import { run } from '../app/main';
import {bootstrapEchoUserSetup} from '../config/user-setup-bootstrap';
import {runOnce} from './one-shot';
import type {RunOnceOptions} from './one-shot';

type CliAction =
  | {kind: 'start'}
  | {kind: 'once'; fullAccess: boolean; prompt: string}
  | {kind: 'help'}
  | {kind: 'version'}
  | {kind: 'invalid'; message: string}
  | {kind: 'unknown'; command: string};

type RunCliOptions = {
  argv?: string[];
  bootstrap?: () => void;
  runApp?: () => void | Promise<void>;
  runOnce?: (options: RunOnceOptions) => Promise<void>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
};

const HELP_TEXT = `Usage: echo-tui [command] [options]

Commands:
  echo-tui                         Start the terminal TUI in the current directory
  echo-tui --once <prompt...>      Run one non-interactive assistant turn

Options:
  -h, --help                       Show this help
  -v, --version                    Show version
  --full-access                    Allow approval-required tools with --once only
                                    WARNING: tools may modify the workspace/system;
                                    this mode has no transcript session or undo history
`;

/**
 * 将 CLI 参数解析成入口动作；只有无参数路径会进入 TUI raw mode。
 */
function parseCliArgs(argv: string[]): CliAction {
  if (argv.length === 0) {
    return {kind: 'start'};
  }

  const [command] = argv;

  if (command === '--help' || command === '-h') {
    return {kind: 'help'};
  }

  if (command === '--version' || command === '-v') {
    return {kind: 'version'};
  }

  if (command === '--once') {
    const promptParts: string[] = [];
    let fullAccess = false;

    for (const argument of argv.slice(1)) {
      if (argument === '--full-access') {
        fullAccess = true;
        continue;
      }

      promptParts.push(argument);
    }

    if (promptParts.length === 0 || promptParts.join(' ').trim() === '') {
      return {kind: 'invalid', message: '--once requires a prompt'};
    }

    return {
      kind: 'once',
      fullAccess,
      prompt: promptParts.join(' ')
    };
  }

  if (command === '--full-access') {
    return {kind: 'invalid', message: '--full-access can only be used with --once'};
  }

  return {kind: 'unknown', command};
}

/**
 * 执行真实 CLI 入口副作用：启动 TUI、输出帮助/版本或报告未知命令。
 */
async function runCli(options: RunCliOptions = {}): Promise<number> {
  const action = parseCliArgs(options.argv || process.argv.slice(2));
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;

  switch (action.kind) {
    case 'start': {
      const bootstrap = options.bootstrap || bootstrapEchoUserSetup;

      try {
        bootstrap();
      } catch (error: unknown) {
        stderr.write(`Failed to initialize echo-tui user setup: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
      }

      await (options.runApp || run)();
      return 0;
    }
    case 'once': {
      const bootstrap = options.bootstrap || bootstrapEchoUserSetup;

      try {
        bootstrap();
        await (options.runOnce || runOnce)({
          fullAccess: action.fullAccess,
          prompt: action.prompt,
          stdout
        });
      } catch (error: unknown) {
        stderr.write(`Failed to run echo-tui once: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
      }

      return 0;
    }
    case 'help':
      stdout.write(HELP_TEXT);
      return 0;
    case 'version':
      stdout.write(`${readPackageVersion()}\n`);
      return 0;
    case 'unknown':
      stderr.write(`Unknown command: ${action.command}\n\n${HELP_TEXT}`);
      return 1;
    case 'invalid':
      stderr.write(`Invalid arguments: ${action.message}\n\n${HELP_TEXT}`);
      return 1;
  }
}

function readPackageVersion(): string {
  try {
    const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {version?: unknown};
    return typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export {
  HELP_TEXT,
  parseCliArgs,
  readPackageVersion,
  runCli
};

export type {
  CliAction,
  RunCliOptions
};

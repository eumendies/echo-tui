import {DEFAULT_BASH_MAX_OUTPUT_BYTES, runBashCommand} from './bash-command-runner';
import {normalizePositiveInteger, resolveCwd} from './tool-handler-utils';
import {createToolResultTruncationMarker} from './tool-result-offloading';

import type {BashToolExecutionResult, ToolCall, ToolExecutionOptions, ToolHandler} from '../types/tool';
import type {BashCommandRunResult} from './bash-command-runner';
import type {ToolResultStore} from './tool-result-offloading';

const RUN_BASH_COMMAND_TOOL_NAME = 'run_bash_command';
const PLAN_READONLY_BASH_REJECTION = 'In plan mode, run_bash_command may only run readonly inspection commands such as pwd, git status, git diff, git log, git show, git rev-parse, git branch --show-current, git ls-files, and git merge-base. This command may modify the workspace or system state, so it was rejected. To run it, exit plan mode first.';
const SHELL_META_PATTERN = /[\r\n;&|<>`$()]/u;
const PLAN_ALLOWED_GIT_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'merge-base']);
const PLAN_BLOCKED_GIT_OPTIONS = new Set(['--output', '--ext-diff', '--external-diff']);
const CHANGE_HISTORY_READONLY_COMMANDS = new Set(['pwd', 'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'echo', 'printf']);
const CHANGE_HISTORY_BLOCKED_FIND_OPTIONS = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir']);

type BashToolHandlerOptions = {
  cwd?: string | (() => string);
  timeoutMs?: number | null;
  maxOutputBytes?: number;
  shell?: string;
  toolResultStore?: ToolResultStore;
};

/**
 * 创建本地 bash function tool；只暴露非交互命令执行能力和最小 JSON schema。
 */
function createBashToolHandler(options: BashToolHandlerOptions = {}): ToolHandler {
  const timeoutMs = options.timeoutMs ?? null;
  const maxOutputBytes = normalizePositiveInteger(options.maxOutputBytes, DEFAULT_BASH_MAX_OUTPUT_BYTES);
  const shell = options.shell || '/bin/bash';

  return {
    definition: {
      name: RUN_BASH_COMMAND_TOOL_NAME,
      description: 'Run a non-interactive bash command in the current workspace.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['command'],
        properties: {
          command: {
            type: 'string'
          }
        }
      }
    },
    execute(args: Record<string, unknown>, call: ToolCall, executionOptions?: ToolExecutionOptions): Promise<BashToolExecutionResult> {
      return executeBashCommand(args, call, {
        abortSignal: executionOptions?.abortSignal,
        cwd: resolveCwd(options.cwd),
        maxOutputBytes,
        shell,
        timeoutMs,
        toolResultStore: options.toolResultStore,
        changeRecorder: executionOptions?.changeRecorder
      });
    }
  };
}

/**
 * 执行 bash 命令并把退出码、timeout、截断输出归一化为 tool result。
 */
function executeBashCommand(
  args: Record<string, unknown>,
  call: ToolCall,
  options: Required<Pick<BashToolHandlerOptions, 'shell'>> & Pick<ToolExecutionOptions, 'changeRecorder'> & {abortSignal?: AbortSignal; cwd: string; maxOutputBytes: number; timeoutMs: number | null; toolResultStore?: ToolResultStore}
): Promise<BashToolExecutionResult> {
  const command = args.command;

  if (typeof command !== 'string' || command.trim() === '') {
    return Promise.resolve({
      callId: call.callId,
      toolName: RUN_BASH_COMMAND_TOOL_NAME,
      ok: false,
      text: 'command must be a non-empty string',
      details: {kind: 'bash'}
    });
  }

  if (!isChangeHistoryReadonlyBashCommand(command)) {
    options.changeRecorder?.invalidate('上一轮执行过不可追踪的 bash 命令，无法安全回退文件修改');
  }

  return runBashCommand({
    command,
    abortSignal: options.abortSignal,
    cwd: options.cwd,
    maxOutputBytes: options.maxOutputBytes,
    shell: options.shell,
    toolResultStore: options.toolResultStore,
    timeoutMs: options.timeoutMs
  }).then((result) => {
    return {
      callId: call.callId,
      toolName: RUN_BASH_COMMAND_TOOL_NAME,
      ok: !result.timedOut && result.exitCode === 0,
      text: formatBashResult(result),
      details: {
        kind: 'bash',
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        truncated: result.truncated,
        durationMs: result.durationMs
      }
    };
  });
}

/**
 * 格式化回传给模型和 transcript 的 bash 执行摘要。
 */
function formatBashResult(options: BashCommandRunResult): string {
  if (!options.error && !options.timedOut && !options.truncated && options.exitCode === 0) {
    return formatSuccessfulBashOutput(options.stdout, options.stderr);
  }

  const lines = [
    `command: ${options.command}`,
    `exit_code: ${options.exitCode === null ? 'null' : options.exitCode}`
  ];

  if (options.timedOut) {
    lines.push('timed_out: true');
  }

  if (options.truncated) {
    lines.push('truncated: true');
  }

  if (options.error) {
    lines.push(`error: ${options.error}`);
  }

  if (options.offloadFilePath) {
    lines.push('', createToolResultTruncationMarker(options.offloadFilePath));
  }

  appendLabeledOutput(lines, 'stdout', options.stdout);
  appendLabeledOutput(lines, 'stderr', options.stderr);

  if (!options.stdout.trim() && !options.stderr.trim()) {
    lines.push('', 'output: (empty)');
  }

  if (options.timedOut) {
    lines.push('', 'Command timed out.');
  }

  if (options.truncated && !options.offloadFilePath) {
    lines.push('', 'Output was truncated.');
  }

  return lines.join('\n');
}

function formatSuccessfulBashOutput(stdout: string, stderr: string): string {
  if (stdout.trim() && stderr.trim()) {
    return [
      'stdout:',
      stdout.replace(/\n$/, ''),
      '',
      'stderr:',
      stderr.replace(/\n$/, '')
    ].join('\n');
  }

  if (stdout.trim()) {
    return stdout.replace(/\n$/, '');
  }

  if (stderr.trim()) {
    return [
      'stderr:',
      stderr.replace(/\n$/, '')
    ].join('\n');
  }

  return 'command completed successfully with no output';
}

function appendLabeledOutput(lines: string[], label: string, output: string): void {
  if (!output.trim()) {
    return;
  }

  lines.push('', `${label}:`, output.replace(/\n$/, ''));
}

function isPlanReadonlyBashCommand(command: string): boolean {
  const argv = parseSinglePlanCommand(command);

  if (!argv) {
    return false;
  }

  if (argv[0] === 'pwd') {
    return argv.length === 1;
  }

  if (argv[0] !== 'git' || argv.length < 2) {
    return false;
  }

  if (argv[1] === 'branch') {
    return argv.length === 3 && argv[2] === '--show-current';
  }

  if (!PLAN_ALLOWED_GIT_SUBCOMMANDS.has(argv[1])) {
    return false;
  }

  return !argv.slice(2).some(isBlockedPlanGitOption);
}

function isChangeHistoryReadonlyBashCommand(command: string): boolean {
  const argv = parseSinglePlanCommand(command);

  if (!argv) {
    return false;
  }

  if (isPlanReadonlyBashCommand(command)) {
    return true;
  }

  if (CHANGE_HISTORY_READONLY_COMMANDS.has(argv[0])) {
    return true;
  }

  if (argv[0] === 'find') {
    return !argv.slice(1).some((arg) => CHANGE_HISTORY_BLOCKED_FIND_OPTIONS.has(arg));
  }

  return false;
}

function parseSinglePlanCommand(command: string): string[] | null {
  const trimmed = command.trim();

  if (trimmed === '' || SHELL_META_PATTERN.test(trimmed)) {
    return null;
  }

  const argv: string[] = [];
  let token = '';
  let quote: 'single' | 'double' | null = null;

  for (const char of trimmed) {
    if (quote === 'single') {
      if (char === "'") {
        quote = null;
      } else {
        token += char;
      }
      continue;
    }

    if (quote === 'double') {
      if (char === '"') {
        quote = null;
      } else {
        token += char;
      }
      continue;
    }

    if (char === "'") {
      quote = 'single';
      continue;
    }

    if (char === '"') {
      quote = 'double';
      continue;
    }

    if (/\s/u.test(char)) {
      if (token !== '') {
        argv.push(token);
        token = '';
      }
      continue;
    }

    token += char;
  }

  if (quote) {
    return null;
  }

  if (token !== '') {
    argv.push(token);
  }

  return argv.length > 0 ? argv : null;
}

function isBlockedPlanGitOption(arg: string): boolean {
  return PLAN_BLOCKED_GIT_OPTIONS.has(arg) || arg.startsWith('--output=');
}

export {
  DEFAULT_BASH_MAX_OUTPUT_BYTES,
  PLAN_READONLY_BASH_REJECTION,
  RUN_BASH_COMMAND_TOOL_NAME,
  createBashToolHandler,
  formatBashResult,
  isChangeHistoryReadonlyBashCommand,
  isPlanReadonlyBashCommand,
};

export type {
  BashToolHandlerOptions
};

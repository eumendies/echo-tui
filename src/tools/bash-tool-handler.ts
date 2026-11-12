import {DEFAULT_BASH_MAX_OUTPUT_BYTES, runBashCommand} from './bash-command-runner';

import {capUtf8TailText, capUtf8Text, normalizePositiveInteger, resolveCwd} from './tool-handler-utils';
import {createToolResultTruncationMarker} from './tool-result-offloading';
import {isChangeHistoryReadonlyBashCommand, isPlanReadonlyBashCommand} from './readonly-bash-command';

import type {BashToolExecutionResult, ToolCall, ToolExecutionOptions, ToolHandler} from '../types/tool';
import type {BackgroundTaskManager, BackgroundTaskReference, BackgroundTaskState} from '../types/background-task';
import type {ChangeFileRecorder} from '../types/change-history';
import type {BashCommandRunResult} from './bash-command-runner';
import type {ToolResultStore} from './tool-result-offloading';
import type {SandboxRuntimeContext} from '../sandbox/types';

const RUN_BASH_COMMAND_TOOL_NAME = 'run_bash_command';
const UNTRACKED_BASH_REASON = '存在不可追踪的 bash 操作，仅能恢复已记录的受控文件。';
const BACKGROUND_UNSUPPORTED_MESSAGE = 'Background execution is only available in the interactive main session. Re-run this in the foreground.';
const PLAN_READONLY_BASH_REJECTION = 'In plan mode, run_bash_command may only run readonly inspection commands: pwd; file inspection commands such as ls, cat, head, tail, wc, grep, rg, echo, printf, and find without write options; readonly git inspection commands such as git status, git diff, git log, git show, git branch -a, git grep, git config --get, and git stash list; and combinations of readonly commands with |, &&, ;, ||, or newlines. This command may modify the workspace or system state, so it was rejected. To run it, exit plan mode first.';

type BashToolHandlerOptions = {
  background?: BackgroundTaskManager; // 后台任务能力;仅交互式主会话的 registry 注入,缺失即拒绝后台启动。
  cwd?: string | (() => string);
  timeoutMs?: number | null;
  maxOutputBytes?: number;
  sandbox?: SandboxRuntimeContext; // run_bash_command 的沙箱运行上下文;缺省或 provider 不可用时按无沙箱执行。
  sessionId?: string; // 当前会话身份;后台任务按它分区,缺失时无法后台执行。
  shell?: string;
  toolResultStore?: ToolResultStore;
};

type ExecuteBashCommandOptions = {
  abortSignal?: AbortSignal; // turn 级取消;只在启动交接前影响后台任务。
  background?: BackgroundTaskManager; // 后台任务能力;唯一后台可用性判据。
  changeRecorder?: ChangeFileRecorder; // 未追踪命令保留受控编辑记录，并提示有限恢复范围。
  cwd: string;
  maxOutputBytes: number;
  sandbox?: SandboxRuntimeContext;
  sessionId?: string;
  shell: string;
  timeoutMs: number | null;
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
          background: {
            type: 'boolean',
            description: 'Start in the background and return log and status paths instead of waiting.'
          },
          command: {
            type: 'string'
          }
        }
      }
    },
    execute(args: Record<string, unknown>, call: ToolCall, executionOptions?: ToolExecutionOptions): Promise<BashToolExecutionResult> {
      return executeBashCommand(args, call, {
        abortSignal: executionOptions?.abortSignal,
        background: options.background,
        changeRecorder: executionOptions?.changeRecorder,
        cwd: resolveCwd(options.cwd),
        maxOutputBytes,
        sandbox: options.sandbox,
        sessionId: options.sessionId,
        shell,
        timeoutMs,
        toolResultStore: options.toolResultStore
      });
    }
  };
}

/**
 * 执行 bash 命令并把退出码、timeout、截断输出归一化为 tool result。
 */
async function executeBashCommand(
  args: Record<string, unknown>,
  call: ToolCall,
  options: ExecuteBashCommandOptions
): Promise<BashToolExecutionResult> {
  const command = args.command;

  if (typeof command !== 'string' || command.trim() === '') {
    return createBashFailureResult(call, 'command must be a non-empty string', options.maxOutputBytes);
  }

  const backgroundRequested = args.background;

  if (backgroundRequested !== undefined && typeof backgroundRequested !== 'boolean') {
    // 参数类型错误必须在启动进程前拒绝,避免把无效意图静默当成前台执行。
    return createBashFailureResult(call, 'background must be a boolean when provided', options.maxOutputBytes);
  }

  // 生效只读沙箱内的命令无法写工作区,不构成不可追踪写入;判定条件与 runner 的包装同源(同一 provider 实例与缓存探测)。
  const sandboxedReadonly = options.sandbox !== undefined
    && options.sandbox.policy.mode === 'read-only'
    && options.sandbox.provider.isAvailable();
  const mayWrite = !sandboxedReadonly && !isChangeHistoryReadonlyBashCommand(command);

  if (backgroundRequested === true) {
    return executeBackgroundCommand(command, call, options, mayWrite);
  }

  if (mayWrite) {
    options.changeRecorder?.markUntracked(UNTRACKED_BASH_REASON);
  }

  const result = await runBashCommand({
    command,
    abortSignal: options.abortSignal,
    cwd: options.cwd,
    maxOutputBytes: options.maxOutputBytes,
    sandbox: options.sandbox,
    shell: options.shell,
    toolResultStore: options.toolResultStore,
    timeoutMs: options.timeoutMs
  });
  const text = formatBashResult(result, options.maxOutputBytes);

  return {
    callId: call.callId,
    toolName: RUN_BASH_COMMAND_TOOL_NAME,
    ok: !result.timedOut && result.exitCode === 0,
    text,
    details: {
      kind: 'bash',
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      truncated: result.truncated || Buffer.byteLength(formatCompleteBashResult(result), 'utf8') > options.maxOutputBytes,
      durationMs: result.durationMs
    }
  };
}

/**
 * 启动受管理的后台任务;能力缺失时在启动进程前返回失败结果。
 */
async function executeBackgroundCommand(
  command: string,
  call: ToolCall,
  options: ExecuteBashCommandOptions,
  mayWrite: boolean
): Promise<BashToolExecutionResult> {
  const manager = options.background;
  const sessionId = options.sessionId;

  if (!manager || !sessionId) {
    return createBashFailureResult(call, BACKGROUND_UNSUPPORTED_MESSAGE, options.maxOutputBytes);
  }

  const started = await manager.start({
    command,
    cwd: options.cwd,
    sessionId,
    sandbox: options.sandbox,
    shell: options.shell,
    timeoutMs: options.timeoutMs,
    ...(options.abortSignal ? {abortSignal: options.abortSignal} : {})
  });

  // 交接前取消也可能已经执行了 shell；不能把失败结果误当成没有副作用。
  if (mayWrite && (started.ok || started.mayHaveExecuted)) {
    options.changeRecorder?.markUntracked(UNTRACKED_BASH_REASON);
  }

  if (!started.ok) {
    return createBashFailureResult(call, started.message, options.maxOutputBytes);
  }

  return {
    callId: call.callId,
    toolName: RUN_BASH_COMMAND_TOOL_NAME,
    // 启动成功不等于命令成功;这里不填造 exit code,也不复用前台失败语义。
    ok: true,
    text: formatBackgroundStartResult(started.reference, started.state, options.maxOutputBytes),
    details: {
      kind: 'bash',
      background: {
        taskId: started.reference.taskId,
        sessionId: started.reference.sessionId,
        ownerInstanceId: started.reference.ownerInstanceId,
        outputPath: started.reference.outputPath,
        statusPath: started.reference.statusPath,
        state: started.state,
        command
      }
    }
  };
}

function createBashFailureResult(call: ToolCall, message: string, maxOutputBytes: number): BashToolExecutionResult {
  return {
    callId: call.callId,
    toolName: RUN_BASH_COMMAND_TOOL_NAME,
    ok: false,
    text: capUtf8Text(message, maxOutputBytes).text,
    details: {kind: 'bash'}
  };
}

/**
 * 固定字段块 + 查询指引;不含任何命令输出正文,避免模型把启动当成执行结果。
 */
function formatBackgroundStartResult(reference: Pick<BackgroundTaskReference, 'outputPath' | 'statusPath'>, state: BackgroundTaskState, maxOutputBytes: number): string {
  const text = [
    `state: ${state}`,
    `output_path: ${reference.outputPath}`,
    `status_path: ${reference.statusPath}`,
    '',
    'Running in the background. Use read_files on status_path for state/exit_code/reason, then output_path with offset/limit for output. A successful start does not mean success; reaching the end of a running log only means the current end.'
  ].join('\n');

  return capUtf8Text(text, maxOutputBytes).text;
}

/**
 * 格式化回传给模型和 transcript 的 bash 执行摘要。
 */
function formatBashResult(options: BashCommandRunResult, maxOutputBytes = DEFAULT_BASH_MAX_OUTPUT_BYTES): string {
  const formatted = formatCompleteBashResult(options);

  if (Buffer.byteLength(formatted, 'utf8') <= maxOutputBytes) {
    return formatted;
  }

  return formatBoundedBashResult(options, maxOutputBytes);
}

function formatCompleteBashResult(options: BashCommandRunResult): string {
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

/**
 * 在同一最终预算中保留状态、截断说明和合并输出尾部；极小预算下仍保持 UTF-8 完整。
 */
function formatBoundedBashResult(options: BashCommandRunResult, maxOutputBytes: number): string {
  const notice = options.offloadFilePath
    // artifact 存在时在截断通知里说明完整输出已落盘，并给出 read_files 续读指引；
    // 只在截断发生时出现，不占常态工具 schema 上下文。
    ? `${createToolResultTruncationMarker(options.offloadFilePath)} Read the saved complete output with read_files.`
    : 'Output was truncated. Re-run with narrower output or redirect output to a file and use read_files with offset/limit.';
  const status = [
    `exit_code: ${options.exitCode === null ? 'null' : options.exitCode}`,
    ...(options.timedOut ? ['timed_out: true'] : []),
    'truncated: true',
    ...(options.error ? [`error: ${options.error}`] : []),
    `command: ${options.command}`
  ].join('\n');
  const separatorBytes = 4;
  const usableBytes = Math.max(0, maxOutputBytes - separatorBytes);
  const desiredNoticeBytes = Buffer.byteLength(notice, 'utf8');
  const noticeBudget = options.offloadFilePath
    ? Math.min(usableBytes, desiredNoticeBytes)
    : Math.floor(usableBytes / 3);
  const contentBytes = usableBytes - noticeBudget;
  const statusBudget = Math.floor(contentBytes / 2);
  const tailBudget = contentBytes - statusBudget;
  const sections = [
    capUtf8Text(status, statusBudget).text,
    capUtf8Text(notice, noticeBudget).text,
    capUtf8TailText(options.output, tailBudget).text
  ].filter((section) => section !== '');

  return capUtf8Text(sections.join('\n\n'), maxOutputBytes).text;
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

export {
  BACKGROUND_UNSUPPORTED_MESSAGE,
  DEFAULT_BASH_MAX_OUTPUT_BYTES,
  PLAN_READONLY_BASH_REJECTION,
  RUN_BASH_COMMAND_TOOL_NAME,
  createBashToolHandler,
  formatBackgroundStartResult,
  formatBashResult,
  isChangeHistoryReadonlyBashCommand,
  isPlanReadonlyBashCommand,
};

export type {
  BashToolHandlerOptions,
  ExecuteBashCommandOptions
};

import {createToolResultTruncationMarker} from './tool-result-offloading';

import type {BashCommandRunResult} from './bash-command-runner';
import type {ShellTranscriptRecord} from '../types/transcript';

/**
 * 生成 shell 命令行展示文本；shell-local 追加 ` [local]`。
 * 该文本同时是 record 首行与运行期 echo 的唯一来源，避免两处模板漂移。
 */
function formatShellCommandLine(command: string, includeInContext: boolean): string {
  return `$ ${command}${includeInContext ? '' : ' [local]'}`;
}

/**
 * 把一次 shell 执行投影为持久化 transcript record；text 同时服务终端投影与压缩摘要。
 */
function createShellRecord(result: BashCommandRunResult, includeInContext: boolean): ShellTranscriptRecord {
  const output = formatShellOutput(result);

  return {
    role: 'shell',
    text: formatShellRecordText(formatShellCommandLine(result.command, includeInContext), result, output),
    command: result.command,
    durationMs: result.durationMs,
    ...(result.error ? {error: result.error} : {}),
    exitCode: result.exitCode,
    includeInContext,
    output,
    timedOut: result.timedOut,
    truncated: result.truncated
  };
}

/**
 * 组装 record 文本：命令行 + 空行 + 合并输出 + error/timeout/truncated/exit 尾注。
 */
function formatShellRecordText(commandLine: string, result: BashCommandRunResult, output: string): string {
  const lines = [commandLine];

  if (output.trim() !== '') {
    lines.push('', output.replace(/\n$/, ''));
  }

  if (result.error) {
    lines.push('', result.error);
  }

  if (result.timedOut) {
    lines.push('', `[timed out after ${result.durationMs}ms]`);
  }

  if (result.truncated && !result.offloadFilePath) {
    lines.push('', '[output truncated]');
  }

  if (result.exitCode !== 0 || result.timedOut || output.trim() === '') {
    lines.push('', `[exit ${result.exitCode === null ? 'null' : result.exitCode}]`);
  }

  return lines.join('\n');
}

/**
 * ctx 模式超限时在输出前插入统一截断 marker；shell-local 的完整输出原样返回。
 */
function formatShellOutput(result: BashCommandRunResult): string {
  if (!result.offloadFilePath) {
    return result.output;
  }

  const marker = createToolResultTruncationMarker(result.offloadFilePath);
  return result.output.trim() === '' ? marker : `${marker}\n\n${result.output}`;
}

export {
  createShellRecord,
  formatShellCommandLine
};

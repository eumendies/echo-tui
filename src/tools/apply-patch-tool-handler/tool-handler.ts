import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES,
  capUtf8Text,
  normalizePositiveInteger,
  resolveCwd
} from '../tool-handler-utils';
import {parsePatchText} from './parser';
import {simulatePatch} from './simulator';

import type {ApplyPatchToolExecutionResult, ToolCall, ToolExecutionOptions, ToolHandler} from '../../types/tool';
import type {ApplyPatchLimits} from './parser';
import type {ChangedFile, ApplyPatchExecutionResult} from './simulator';

const APPLY_PATCH_TOOL_NAME = 'apply_patch';
const DEFAULT_MAX_PATCH_BYTES = 256_000;
const DEFAULT_MAX_FILE_BYTES = 1_000_000;
const DEFAULT_MAX_CHANGED_FILES = 20;
const DEFAULT_MAX_HUNKS = 100;
const APPLY_PATCH_LABEL_MAX_PATHS = 5;
const FILE_EDIT_RESULT_MAX_FIELD_BYTES = 24_000;
const FILE_EDIT_RESULT_TRUNCATION_SUFFIX = '… [truncated]';

type ApplyPatchToolHandlerOptions = {
  cwd?: string | (() => string);
  maxPatchBytes?: number;
  maxFileBytes?: number;
  maxChangedFiles?: number;
  maxHunks?: number;
  maxOutputBytes?: number; // 最终 provider-visible 摘要的 UTF-8 字节预算，仅供固定安全上限或测试覆盖。
};

type ApplyPatchFailureDetails = {
  hint?: string; // 失败修复建议，独立成行放在原文回显之前
  hunkLines?: string[]; // 匹配失败 hunk 的 pre-image 行，作为失败文本的最后一段回显
  filesUntouched: boolean; // 写盘前失败时为 true，失败文本才会声明文件未被改动
};

/**
 * 为 apply_patch 调用生成轻量可见摘要；这里只扫 patch header，不做执行期语义校验。
 */
function createApplyPatchCallLabel(argumentsText: unknown): string {
  const paths = extractApplyPatchCallPaths(argumentsText);

  if (paths.length === 0) {
    return APPLY_PATCH_TOOL_NAME;
  }

  return `${APPLY_PATCH_TOOL_NAME}(${formatApplyPatchPathSummary(paths)})`;
}

function formatApplyPatchPathSummary(paths: string[]): string {
  const visiblePaths = paths.slice(0, APPLY_PATCH_LABEL_MAX_PATHS);
  const hiddenDeletePath = paths.slice(APPLY_PATCH_LABEL_MAX_PATHS).find((item) => item.startsWith('delete '));

  if (hiddenDeletePath && visiblePaths.length > 0 && !visiblePaths.some((item) => item.startsWith('delete '))) {
    visiblePaths[visiblePaths.length - 1] = hiddenDeletePath;
  }

  if (paths.length > visiblePaths.length) {
    visiblePaths.push(`… +${paths.length - visiblePaths.length} more`);
  }

  return visiblePaths.join(', ');
}

/**
 * 从 function call arguments 的 patch 文本中提取文件路径摘要；这里只扫 header，不解析 hunk。
 */
function extractApplyPatchCallPaths(argumentsText: unknown): string[] {
  if (typeof argumentsText !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(argumentsText) as {patch?: unknown};
    return typeof parsed.patch === 'string' ? extractPatchPaths(parsed.patch) : [];
  } catch {
    return [];
  }
}

/**
 * 只提取 Begin Patch 文件指令；无效格式不显示为可执行的文件目标。
 */
function extractPatchPaths(patch: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const lines = patch.replace(/\r\n?/g, '\n').split('\n');
  if (lines.find((line) => line.trim() !== '')?.trimStart() !== '*** Begin Patch') {
    return paths;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimStart();
    const beginPatchFile = /^\*\*\* (Add|Update|Delete) File:\s*(.+)$/.exec(line);

    if (beginPatchFile) {
      addPatchPath(paths, seen, formatPatchPreviewPath(beginPatchFile[1], beginPatchFile[2].trim()));
    }
  }

  return paths;
}

function addPatchPath(paths: string[], seen: Set<string>, patchPath: string): void {
  if (!patchPath || seen.has(patchPath)) {
    return;
  }

  seen.add(patchPath);
  paths.push(patchPath);
}

function formatPatchPreviewPath(kind: string, patchPath: string): string {
  return kind === 'Delete' ? `delete ${patchPath}` : patchPath;
}

/**
 * 创建本地 patch 编辑工具；工具只解析受支持的文本 patch，不委托 git 或系统 patch。
 */
function createApplyPatchToolHandler(options: ApplyPatchToolHandlerOptions = {}): ToolHandler {
  const limits = normalizeLimits(options);
  const maxOutputBytes = normalizePositiveInteger(options.maxOutputBytes, DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES);

  return {
    definition: {
      name: APPLY_PATCH_TOOL_NAME,
      description: 'Apply a *** Begin Patch to add, update, or delete UTF-8 text files, including files outside the current working directory. Relative paths resolve from the current working directory; absolute paths and .. paths are supported.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['patch'],
        properties: {
          patch: {
            type: 'string',
            description: 'Patch text must start with *** Begin Patch and end with *** End Patch. Use *** Add File / *** Update File / *** Delete File directives. Include enough context lines for each update.'
          }
        }
      }
    },
    execute(args: Record<string, unknown>, call: ToolCall, executionOptions?: ToolExecutionOptions): ApplyPatchToolExecutionResult {
      let result: ApplyPatchExecutionResult;
      try {
        result = applyPatch(args.patch, {
          cwd: resolveCwd(options.cwd),
          limits,
          changeRecorder: executionOptions?.changeRecorder
        });
      } catch (error: unknown) {
        result = {
          ok: false,
          reason: error instanceof Error && error.message.trim() !== '' ? error.message : 'failed to access changed files'
        };
      }
      const displayFiles = result.ok ? result.value.displayFiles : undefined;
      const display = displayFiles ? {kind: APPLY_PATCH_TOOL_NAME, files: displayFiles} as const : undefined;

      return {
        callId: call.callId,
        toolName: APPLY_PATCH_TOOL_NAME,
        ok: result.ok,
        text: result.ok
          ? formatSuccess(result.value.changedFiles, maxOutputBytes)
          : formatFailure(
            result.reason,
            {
              hint: result.hint,
              hunkLines: result.hunkLines,
              filesUntouched: result.filesUntouched === true
            },
            maxOutputBytes
          ),
        details: {kind: 'apply_patch', ...(display ? {display} : {})}
      };
    }
  };
}

/**
 * 解析、校验并模拟 patch；进入写盘阶段前不会修改目标文件。
 */
function applyPatch(patch: unknown, options: {cwd: string; limits: ApplyPatchLimits; changeRecorder?: ToolExecutionOptions['changeRecorder']}): ApplyPatchExecutionResult {
  if (typeof patch !== 'string') {
    return {ok: false, reason: 'patch must be a string', filesUntouched: true};
  }

  if (patch.trim() === '') {
    return {ok: false, reason: 'patch must be non-empty', filesUntouched: true};
  }

  if (Buffer.byteLength(patch, 'utf8') > options.limits.maxPatchBytes) {
    return {ok: false, reason: `patch exceeds ${options.limits.maxPatchBytes} bytes`, filesUntouched: true};
  }

  const parsed = parsePatchText(patch, options.limits);

  if (!parsed.ok) {
    return {...parsed, filesUntouched: true};
  }

  const simulated = simulatePatch(parsed.value, options);

  if (!simulated.ok) {
    return {...simulated, filesUntouched: true};
  }

  // 所有解析、校验和内存应用都成功后才进入写盘阶段；写成功的文件立即标记为可回退。
  try {
    for (const changedFile of simulated.value.changedFiles) {
      options.changeRecorder?.captureFileBefore(changedFile.absolutePath);
    }

    for (const changedFile of simulated.value.changedFiles) {
      if (changedFile.kind === 'deleted') {
        fs.unlinkSync(changedFile.absolutePath);
      } else {
        fs.mkdirSync(path.dirname(changedFile.absolutePath), {recursive: true});
        fs.writeFileSync(changedFile.absolutePath, changedFile.content, 'utf8');
      }

      options.changeRecorder?.captureFileAfter(changedFile.absolutePath);
    }
  } catch (error: unknown) {
    const message = error instanceof Error && error.message.trim() !== '' ? error.message : 'failed to write changed files';
    return {ok: false, reason: message, displayFiles: simulated.value.displayFiles};
  }

  return {ok: true, value: simulated.value};
}

function formatSuccess(changedFiles: ChangedFile[], maxOutputBytes: number): string {
  const lines = ['Applied patch.', 'Changed files:'];

  if (changedFiles.length === 0) {
    return capUtf8Text([...lines, '- none'].join('\n'), maxOutputBytes).text;
  }

  let omitted = 0;
  for (const [index, file] of changedFiles.entries()) {
    const pathText = capFileEditResultField(file.filePath, FILE_EDIT_RESULT_MAX_FIELD_BYTES);
    const line = `- ${pathText} (${file.kind})`;
    const remaining = changedFiles.length - index - 1;
    const candidate = [...lines, line, ...(remaining > 0 ? [formatOmittedChangedFiles(remaining)] : [])].join('\n');

    if (Buffer.byteLength(candidate, 'utf8') > maxOutputBytes) {
      omitted = changedFiles.length - index;
      break;
    }

    lines.push(line);
  }

  if (omitted > 0) {
    while (lines.length > 2 && Buffer.byteLength([...lines, formatOmittedChangedFiles(omitted)].join('\n'), 'utf8') > maxOutputBytes) {
      lines.pop();
      omitted += 1;
    }
    lines.push(formatOmittedChangedFiles(omitted));
  }

  return capUtf8Text(lines.join('\n'), maxOutputBytes).text;
}

/**
 * 组装 patch 失败文本：头部声明失败并区分文件是否被改动，随后依次是原因、修复提示和失败 hunk 原文；
 * 原文回显固定放在最后，避免模型把它当成提示或原因的一部分。
 */
function formatFailure(reason: string, details: ApplyPatchFailureDetails, maxOutputBytes: number): string {
  const header = details.filesUntouched ? 'Patch failed. No files were changed.' : 'Patch failed.';
  const labels = [
    header,
    'Reason: ',
    ...(details.hint !== undefined ? ['Hint: '] : []),
    ...(details.hunkLines !== undefined ? ['Failed hunk lines:'] : [])
  ];
  const availableBytes = Math.max(0, maxOutputBytes - Buffer.byteLength(labels.join('\n'), 'utf8'));
  const boundedReason = capFileEditResultField(reason, Math.min(FILE_EDIT_RESULT_MAX_FIELD_BYTES, availableBytes));
  const remainingAfterReason = Math.max(0, availableBytes - Buffer.byteLength(boundedReason, 'utf8'));
  const boundedHint = details.hint === undefined
    ? undefined
    : capFileEditResultField(details.hint, Math.min(FILE_EDIT_RESULT_MAX_FIELD_BYTES, remainingAfterReason));
  const remainingAfterHint = Math.max(0, remainingAfterReason - Buffer.byteLength(boundedHint ?? '', 'utf8'));
  const boundedHunkLines = details.hunkLines === undefined
    ? undefined
    : capFileEditResultField(
      details.hunkLines.join('\n'),
      Math.min(FILE_EDIT_RESULT_MAX_FIELD_BYTES, remainingAfterHint)
    );
  const text = [
    header,
    `Reason: ${boundedReason}`,
    ...(boundedHint !== undefined ? [`Hint: ${boundedHint}`] : []),
    ...(boundedHunkLines !== undefined ? ['Failed hunk lines:', boundedHunkLines] : [])
  ].join('\n');
  return capUtf8Text(text, maxOutputBytes).text;
}

function capFileEditResultField(value: string, maxBytes: number): string {
  const normalizedMaxBytes = Math.max(0, maxBytes);
  if (Buffer.byteLength(value, 'utf8') <= normalizedMaxBytes) {
    return value;
  }

  const suffixBytes = Buffer.byteLength(FILE_EDIT_RESULT_TRUNCATION_SUFFIX, 'utf8');
  return normalizedMaxBytes <= suffixBytes
    ? capUtf8Text(FILE_EDIT_RESULT_TRUNCATION_SUFFIX, normalizedMaxBytes).text
    : `${capUtf8Text(value, normalizedMaxBytes - suffixBytes).text}${FILE_EDIT_RESULT_TRUNCATION_SUFFIX}`;
}

function formatOmittedChangedFiles(count: number): string {
  return `[${count} changed ${count === 1 ? 'file' : 'files'} omitted due to output limit]`;
}

function normalizeLimits(options: ApplyPatchToolHandlerOptions): ApplyPatchLimits {
  return {
    maxPatchBytes: options.maxPatchBytes ?? DEFAULT_MAX_PATCH_BYTES,
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxChangedFiles: options.maxChangedFiles ?? DEFAULT_MAX_CHANGED_FILES,
    maxHunks: options.maxHunks ?? DEFAULT_MAX_HUNKS
  };
}

export {
  APPLY_PATCH_TOOL_NAME,
  DEFAULT_MAX_CHANGED_FILES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_HUNKS,
  DEFAULT_MAX_PATCH_BYTES,
  createApplyPatchCallLabel,
  createApplyPatchToolHandler
};

export type {
  ApplyPatchToolHandlerOptions
};

import * as fs from 'node:fs';
import * as path from 'node:path';

import {resolveCwd} from '../tool-handler-utils';
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

type ApplyPatchToolHandlerOptions = {
  cwd?: string | (() => string);
  maxPatchBytes?: number;
  maxFileBytes?: number;
  maxChangedFiles?: number;
  maxHunks?: number;
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
 * 支持 Begin Patch、标准文件 header 和 diff --git header 三种常见路径来源。
 */
function extractPatchPaths(patch: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const lines = patch.replace(/\r\n?/g, '\n').split('\n');
  let pendingDiffOldPath: string | null = null;
  let pendingDiffDeleted = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trimStart();
    const beginPatchFile = /^\*\*\* (Add|Update|Delete) File:\s*(.+)$/.exec(line);

    if (beginPatchFile) {
      addPatchPath(paths, seen, formatPatchPreviewPath(beginPatchFile[1], beginPatchFile[2].trim()));
      continue;
    }

    if (line.startsWith('deleted file mode')) {
      pendingDiffDeleted = true;
      continue;
    }

    if (line.startsWith('--- ') && index + 1 < lines.length) {
      const oldPath = parsePatchHeaderPath(line.slice(4));
      const nextLine = lines[index + 1].trimStart();

      if (nextLine.startsWith('+++ ')) {
        const newPath = parsePatchHeaderPath(nextLine.slice(4));
        const isDelete = newPath === '/dev/null';
        const displayPath = normalizePatchDisplayPath(isDelete ? oldPath : newPath);

        if (isDelete && pendingDiffOldPath) {
          replacePatchPath(paths, seen, pendingDiffOldPath, formatPatchPreviewPath('Delete', displayPath));
        } else {
          addPatchPath(paths, seen, formatPatchPreviewPath(isDelete ? 'Delete' : 'Update', displayPath));
        }

        pendingDiffOldPath = null;
        pendingDiffDeleted = false;
        index += 1;
        continue;
      }
    }

    if (line.startsWith('diff --git ')) {
      const match = /^diff --git\s+(\S+)\s+(\S+)$/.exec(line);

      if (match) {
        pendingDiffOldPath = normalizePatchDisplayPath(match[1]);
        pendingDiffDeleted = false;
        addPatchPath(paths, seen, normalizePatchDisplayPath(match[2]));
      }

      continue;
    }

    if (line.startsWith('@@') && pendingDiffOldPath && pendingDiffDeleted) {
      replacePatchPath(paths, seen, pendingDiffOldPath, formatPatchPreviewPath('Delete', pendingDiffOldPath));
      pendingDiffOldPath = null;
      pendingDiffDeleted = false;
    }
  }

  return paths;
}

function addPatchPath(paths: string[], seen: Set<string>, patchPath: string): void {
  if (!patchPath || patchPath === '/dev/null' || seen.has(patchPath)) {
    return;
  }

  seen.add(patchPath);
  paths.push(patchPath);
}

function replacePatchPath(paths: string[], seen: Set<string>, existingPath: string, patchPath: string): void {
  if (seen.has(patchPath)) {
    return;
  }

  const index = paths.indexOf(existingPath);

  if (index < 0) {
    addPatchPath(paths, seen, patchPath);
    return;
  }

  paths[index] = patchPath;
  seen.delete(existingPath);
  seen.add(patchPath);
}

function formatPatchPreviewPath(kind: string, patchPath: string): string {
  return kind === 'Delete' ? `delete ${patchPath}` : patchPath;
}

function parsePatchHeaderPath(rawPath: string): string {
  return rawPath.trim().split('\t')[0];
}

function normalizePatchDisplayPath(patchPath: string): string {
  return patchPath.startsWith('a/') || patchPath.startsWith('b/') ? patchPath.slice(2) : patchPath;
}

/**
 * 创建本地 patch 编辑工具；工具只解析受支持的文本 patch，不委托 git 或系统 patch。
 */
function createApplyPatchToolHandler(options: ApplyPatchToolHandlerOptions = {}): ToolHandler {
  const limits = normalizeLimits(options);

  return {
    definition: {
      name: APPLY_PATCH_TOOL_NAME,
      description: 'Apply a patch to add, update, or delete UTF-8 text files, including files outside the current working directory. Relative paths resolve from the current working directory; absolute paths and .. paths are supported. Supports unified diff and *** Begin Patch formats.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['patch'],
        properties: {
          patch: {
            type: 'string',
            description: 'Patch text. Use unified diff, or *** Begin Patch with *** Add File / *** Update File / *** Delete File. Include enough context lines so each update or unified delete hunk matches uniquely.'
          }
        }
      }
    },
    execute(args: Record<string, unknown>, call: ToolCall, executionOptions?: ToolExecutionOptions): ApplyPatchToolExecutionResult {
      const result = applyPatch(args.patch, {
        cwd: resolveCwd(options.cwd),
        limits,
        changeRecorder: executionOptions?.changeRecorder
      });
      const displayFiles = result.ok ? result.value.displayFiles : undefined;
      const display = displayFiles ? {kind: APPLY_PATCH_TOOL_NAME, files: displayFiles} as const : undefined;

      return {
        callId: call.callId,
        toolName: APPLY_PATCH_TOOL_NAME,
        ok: result.ok,
        text: result.ok ? formatSuccess(result.value.changedFiles) : formatFailure(result.reason, result.hint),
        ...(display ? {display} : {})
      };
    }
  };
}

/**
 * 解析、校验并模拟 patch；进入写盘阶段前不会修改目标文件。
 */
function applyPatch(patch: unknown, options: {cwd: string; limits: ApplyPatchLimits; changeRecorder?: ToolExecutionOptions['changeRecorder']}): ApplyPatchExecutionResult {
  if (typeof patch !== 'string') {
    return {ok: false, reason: 'patch must be a string'};
  }

  if (patch.trim() === '') {
    return {ok: false, reason: 'patch must be non-empty'};
  }

  if (Buffer.byteLength(patch, 'utf8') > options.limits.maxPatchBytes) {
    return {ok: false, reason: `patch exceeds ${options.limits.maxPatchBytes} bytes`};
  }

  const parsed = parsePatchText(patch, options.limits);

  if (!parsed.ok) {
    return parsed;
  }

  const simulated = simulatePatch(parsed.value, options);

  if (!simulated.ok) {
    return simulated;
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

function formatSuccess(changedFiles: ChangedFile[]): string {
  return [
    'Applied patch.',
    'Changed files:',
    ...changedFiles.map((file) => `- ${file.filePath} (${file.kind})`)
  ].join('\n');
}

function formatFailure(reason: string, hint?: string): string {
  return [
    'Patch failed.',
    `Reason: ${reason}`,
    ...(hint ? [`Hint: ${hint}`] : [])
  ].join('\n');
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

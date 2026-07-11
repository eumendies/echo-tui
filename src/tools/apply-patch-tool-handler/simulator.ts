import * as fs from 'node:fs';
import * as path from 'node:path';

import {isGitPath} from '../tool-handler-utils';

import type {ApplyPatchDisplayFile, ApplyPatchDisplayLine} from '../../types/tool';
import type {ApplyPatchLimits, PatchHunk, PatchOperation, Result} from './parser';

type ChangedFile = {
  kind: 'added' | 'updated';
  filePath: string;
  absolutePath: string;
  content: string;
} | {
  kind: 'deleted';
  filePath: string;
  absolutePath: string;
};

type ApplyPatchSuccess = {ok: true; value: {
  changedFiles: ChangedFile[];
  displayFiles: ApplyPatchDisplayFile[];
}};

type ApplyPatchFailure = {ok: false; reason: string; hint?: string; displayFiles?: ApplyPatchDisplayFile[]};

type ApplyPatchExecutionResult = ApplyPatchSuccess | ApplyPatchFailure;

/**
 * 在内存中应用全部文件操作；成功后调用方才会写入文件系统。
 */
function simulatePatch(
  operations: PatchOperation[],
  options: {cwd: string; limits: ApplyPatchLimits}
): ApplyPatchExecutionResult {
  const changedFiles = new Map<string, ChangedFile>();
  const displayFiles: ApplyPatchDisplayFile[] = [];
  const seenPaths = new Set<string>();

  for (const operation of operations) {
    const resolved = resolvePatchPath(options.cwd, operation.filePath);

    if (!resolved.ok) {
      return {...resolved, displayFiles: createUnresolvedApplyPatchDisplayFiles(operations)};
    }

    // 先按绝对路径判重，避免同一文件通过相对路径和绝对路径被写两次。
    if (seenPaths.has(resolved.value)) {
      return {
        ok: false,
        reason: `multiple file patches for ${operation.filePath} are not supported`,
        displayFiles: createUnresolvedApplyPatchDisplayFiles(operations)
      };
    }

    seenPaths.add(resolved.value);

    if (operation.kind === 'add') {
      const added = simulateAddFile(operation, resolved.value);

      if (!added.ok) {
        return {...added, displayFiles: createUnresolvedApplyPatchDisplayFiles(operations)};
      }

      changedFiles.set(operation.filePath, added.value.changedFile);
      displayFiles.push(added.value.displayFile);
      continue;
    }

    if (operation.kind === 'delete') {
      const deleted = simulateDeleteFile(operation, resolved.value, options.limits);

      if (!deleted.ok) {
        return {...deleted, displayFiles: createUnresolvedApplyPatchDisplayFiles(operations)};
      }

      changedFiles.set(operation.filePath, deleted.value.changedFile);
      displayFiles.push(deleted.value.displayFile);
      continue;
    }

    const updated = simulateUpdateFile(operation, resolved.value, options.limits);

    if (!updated.ok) {
      return {...updated, displayFiles: createUnresolvedApplyPatchDisplayFiles(operations)};
    }

    changedFiles.set(operation.filePath, updated.value.changedFile);
    displayFiles.push(updated.value.displayFile);
  }

  return {
    ok: true,
    value: {
      changedFiles: Array.from(changedFiles.values()),
      displayFiles
    }
  };
}

function createUnresolvedApplyPatchDisplayFiles(operations: PatchOperation[]): ApplyPatchDisplayFile[] {
  return operations.map((operation) => ({
    path: operation.filePath,
    kind: operation.kind === 'add' ? 'added' : operation.kind === 'delete' ? 'deleted' : 'updated',
    lines: operation.hunks.flatMap((hunk) => hunk.displayLines.map((line) => ({...line, postLine: null})))
  }));
}

function simulateAddFile(
  operation: PatchOperation,
  absolutePath: string
): Result<{changedFile: ChangedFile; displayFile: ApplyPatchDisplayFile}> {
  if (fs.existsSync(absolutePath)) {
    return {ok: false, reason: `target file already exists: ${operation.filePath}`};
  }

  const lines: string[] = [];

  for (const hunk of operation.hunks) {
    if (hunk.oldLines.length > 0) {
      return {ok: false, reason: `add file hunk for ${operation.filePath} must not contain old lines`};
    }

    lines.push(...hunk.newLines);
  }

  return {
    ok: true,
    value: {
      changedFile: {
        absolutePath,
        content: lines.length === 0 ? '' : `${lines.join('\n')}\n`,
        filePath: operation.filePath,
        kind: 'added'
      },
      displayFile: {
        path: operation.filePath,
        kind: 'added',
        lines: lines.map((text, index) => ({kind: 'added', text, postLine: index + 1}))
      }
    }
  };
}

function simulateUpdateFile(
  operation: PatchOperation,
  absolutePath: string,
  limits: ApplyPatchLimits
): Result<{changedFile: ChangedFile; displayFile: ApplyPatchDisplayFile}> {
  const readable = readPatchTargetFile(operation.filePath, absolutePath, limits, 'follow_symlink');

  if (!readable.ok) {
    return readable;
  }

  const split = splitFileContent(readable.value.content);
  const applied = operation.matchMode === 'sequential'
    ? applySequentialUpdateHunks(operation, split.lines)
    : applyIndependentUpdateHunks(operation, split.lines);

  if (!applied.ok) {
    return applied;
  }

  return {
    ok: true,
    value: {
      changedFile: {
        absolutePath,
        content: joinFileContent(applied.value.lines, split.trailingNewline),
        filePath: operation.filePath,
        kind: 'updated'
      },
      displayFile: {
        path: operation.filePath,
        kind: 'updated',
        lines: createResolvedDisplayLines(applied.value.matchedHunks, applied.value.lines)
      }
    }
  };
}

function simulateDeleteFile(
  operation: PatchOperation,
  absolutePath: string,
  limits: ApplyPatchLimits
): Result<{changedFile: ChangedFile; displayFile: ApplyPatchDisplayFile}> {
  const readable = readPatchTargetFile(operation.filePath, absolutePath, limits, 'reject_symlink');

  if (!readable.ok) {
    return readable;
  }

  const split = splitFileContent(readable.value.content);

  if (operation.hunks.length > 0) {
    if (operation.hunks.some((hunk) => hunk.newLines.length > 0)) {
      return {
        ok: false,
        reason: `delete hunk for ${operation.filePath} must only contain removed lines`,
        hint: 'Read the file again and include every current file line as a removed line.'
      };
    }

    const applied = operation.matchMode === 'sequential'
      ? applySequentialUpdateHunks(operation, split.lines)
      : applyIndependentUpdateHunks(operation, split.lines);

    if (!applied.ok) {
      return applied;
    }

    if (applied.value.lines.length > 0) {
      return {
        ok: false,
        reason: `delete patch for ${operation.filePath} does not remove the entire file`,
        hint: 'Include every current file line as a removed line in the delete hunk.'
      };
    }
  }

  const originalLines = split.lines;

  return {
    ok: true,
    value: {
      changedFile: {
        absolutePath,
        filePath: operation.filePath,
        kind: 'deleted'
      },
      displayFile: {
        path: operation.filePath,
        kind: 'deleted',
        lines: originalLines.map((text) => ({kind: 'removed', text, postLine: null}))
      }
    }
  };
}

function readPatchTargetFile(
  filePath: string,
  absolutePath: string,
  limits: ApplyPatchLimits,
  symlinkPolicy: 'follow_symlink' | 'reject_symlink'
): Result<{content: string}> {
  if (!fs.existsSync(absolutePath)) {
    return {ok: false, reason: `target file does not exist: ${filePath}`};
  }

  const stat = symlinkPolicy === 'reject_symlink' ? fs.lstatSync(absolutePath) : fs.statSync(absolutePath);

  if (symlinkPolicy === 'reject_symlink' && stat.isSymbolicLink()) {
    return {ok: false, reason: `target path is a symlink: ${filePath}`};
  }

  if (!stat.isFile()) {
    return {ok: false, reason: `target path is not a file: ${filePath}`};
  }

  if (stat.size > limits.maxFileBytes) {
    return {ok: false, reason: `target file exceeds ${limits.maxFileBytes} bytes: ${filePath}`};
  }

  const content = fs.readFileSync(absolutePath, 'utf8');

  if (content.includes('\0')) {
    return {ok: false, reason: `target file appears to be binary: ${filePath}`};
  }

  return {ok: true, value: {content}};
}

function applyIndependentUpdateHunks(
  operation: PatchOperation,
  startingLines: string[]
): Result<{lines: string[]; matchedHunks: Array<{hunk: PatchHunk; postStart: number}>}> {
  let currentLines = startingLines;
  const matchedHunks: Array<{hunk: PatchHunk; postStart: number}> = [];

  for (const hunk of operation.hunks) {
    // 空 oldLines 没有定位锚点；插入也必须带上下文，避免猜测插入位置。
    if (hunk.oldLines.length === 0) {
      return {
        ok: false,
        reason: `hunk for ${operation.filePath} has no context or removed lines`,
        hint: 'Read the file again and include context around the insertion.'
      };
    }

    const match = findUniqueMatch(currentLines, hunk.oldLines);

    if (!match.ok) {
      return {
        ok: false,
        reason: `${match.reason} in ${operation.filePath}`,
        hint: 'Read the file again and include more surrounding context in the hunk.'
      };
    }

    const delta = hunk.newLines.length - hunk.oldLines.length;

    for (const matched of matchedHunks) {
      if (match.value < matched.postStart) {
        matched.postStart += delta;
      }
    }

    matchedHunks.push({hunk, postStart: match.value});
    currentLines = [
      ...currentLines.slice(0, match.value),
      ...hunk.newLines,
      ...currentLines.slice(match.value + hunk.oldLines.length)
    ];
  }

  return {ok: true, value: {lines: currentLines, matchedHunks}};
}

function applySequentialUpdateHunks(
  operation: PatchOperation,
  startingLines: string[]
): Result<{lines: string[]; matchedHunks: Array<{hunk: PatchHunk; postStart: number}>}> {
  let currentLines = startingLines;
  const matchedHunks: Array<{hunk: PatchHunk; postStart: number}> = [];
  let searchStart = 0;

  for (const hunk of operation.hunks) {
    if (hunk.anchorLine !== undefined) {
      const anchor = findFirstMatch(currentLines, [hunk.anchorLine], searchStart);

      if (!anchor.ok) {
        return {
          ok: false,
          reason: `${anchor.reason} in ${operation.filePath}`,
          hint: 'Read the file again and include more surrounding context in the hunk.'
        };
      }

      searchStart = anchor.value + 1;
    }

    if (!hunk.hasChange) {
      if (hunk.oldLines.length === 0) {
        if (hunk.anchorLine !== undefined) {
          continue;
        }

        return {
          ok: false,
          reason: `hunk for ${operation.filePath} has no context or removed lines`,
          hint: 'Read the file again and include context around the insertion.'
        };
      }

      const contextMatch = findFirstMatch(currentLines, hunk.oldLines, searchStart);

      if (!contextMatch.ok) {
        return {
          ok: false,
          reason: `${contextMatch.reason} in ${operation.filePath}`,
          hint: 'Read the file again and include more surrounding context in the hunk.'
        };
      }

      searchStart = contextMatch.value + hunk.oldLines.length;
      continue;
    }

    if (hunk.oldLines.length === 0) {
      if (hunk.anchorLine === undefined) {
        return {
          ok: false,
          reason: `hunk for ${operation.filePath} has no context or removed lines`,
          hint: 'Read the file again and include context around the insertion.'
        };
      }

      const insertAt = searchStart;
      matchedHunks.push({hunk, postStart: insertAt});
      currentLines = [
        ...currentLines.slice(0, insertAt),
        ...hunk.newLines,
        ...currentLines.slice(insertAt)
      ];
      searchStart = insertAt + hunk.newLines.length;
      continue;
    }

    const match = findFirstMatch(currentLines, hunk.oldLines, searchStart);

    if (!match.ok) {
      return {
        ok: false,
        reason: `${match.reason} in ${operation.filePath}`,
        hint: 'Read the file again and include more surrounding context in the hunk.'
      };
    }

    matchedHunks.push({hunk, postStart: match.value});
    currentLines = [
      ...currentLines.slice(0, match.value),
      ...hunk.newLines,
      ...currentLines.slice(match.value + hunk.oldLines.length)
    ];
    searchStart = match.value + hunk.newLines.length;
  }

  return {ok: true, value: {lines: currentLines, matchedHunks}};
}

/**
 * 基于最终内存文件生成完整事实行，并在对应 post-image 位置插入 removed 行。
 */
function createResolvedDisplayLines(
  matchedHunks: Array<{hunk: PatchHunk; postStart: number}>,
  finalLines: string[]
): ApplyPatchDisplayLine[] {
  const addedLines = new Map<number, string>();
  const removedLines = new Map<number, string[]>();

  for (const matched of matchedHunks) {
    let postLine = matched.postStart + 1;

    for (const line of matched.hunk.displayLines) {
      if (line.kind === 'removed') {
        // 后续 hunk 可能删除先前 added 行；清除标记，避免上移到该行号的普通 context 被误标为 added。
        addedLines.delete(postLine);
        const anchored = removedLines.get(postLine) || [];
        anchored.push(line.text);
        removedLines.set(postLine, anchored);
        continue;
      }

      if (line.kind === 'added') {
        addedLines.set(postLine, line.text);
      }

      postLine += 1;
    }
  }

  const lines: ApplyPatchDisplayLine[] = [];

  for (let postLine = 1; postLine <= finalLines.length + 1; postLine += 1) {
    for (const text of removedLines.get(postLine) || []) {
      lines.push({kind: 'removed', text, postLine: null});
    }

    if (postLine <= finalLines.length) {
      lines.push({
        kind: addedLines.has(postLine) ? 'added' : 'context',
        text: finalLines[postLine - 1],
        postLine
      });
    }
  }

  return lines;
}

function findUniqueMatch(lines: string[], target: string[], startIndex = 0): Result<number> {
  const matches: number[] = [];

  // 不做模糊匹配：0 次匹配说明上下文过期，多次匹配说明上下文不够唯一。
  for (let index = startIndex; index <= lines.length - target.length; index += 1) {
    let matched = true;

    for (let offset = 0; offset < target.length; offset += 1) {
      if (lines[index + offset] !== target[offset]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      matches.push(index);
    }

    if (matches.length > 1) {
      return {ok: false, reason: 'hunk matched multiple locations'};
    }
  }

  return matches.length === 0
    ? {ok: false, reason: 'hunk matched 0 locations'}
    : {ok: true, value: matches[0]};
}

function findFirstMatch(lines: string[], target: string[], startIndex: number): Result<number> {
  // Begin Patch 顺序模式按 V4A 语义从游标后取第一个精确匹配，重复上下文交给游标推进消歧。
  for (let index = startIndex; index <= lines.length - target.length; index += 1) {
    let matched = true;

    for (let offset = 0; offset < target.length; offset += 1) {
      if (lines[index + offset] !== target[offset]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return {ok: true, value: index};
    }
  }

  return {ok: false, reason: 'hunk matched 0 locations'};
}

function resolvePatchPath(cwd: string, patchPath: string): Result<string> {
  if (patchPath.trim() === '') {
    return {ok: false, reason: 'patch path must be non-empty'};
  }

  if (patchPath.includes('\0')) {
    return {ok: false, reason: 'patch path must not contain NUL'};
  }

  const absoluteCwd = path.resolve(cwd);
  const absolutePath = path.isAbsolute(patchPath) ? path.resolve(patchPath) : path.resolve(absoluteCwd, patchPath);

  // 当前版本临时允许 cwd 外路径；保留 .git 拒绝，避免直接破坏 Git 内部状态。
  return isGitPath(absolutePath)
    ? {ok: false, reason: `.git paths are not allowed: ${patchPath}`}
    : {ok: true, value: absolutePath};
}

function splitFileContent(content: string): {lines: string[]; trailingNewline: boolean} {
  if (content === '') {
    return {lines: [], trailingNewline: false};
  }

  const trailingNewline = content.endsWith('\n');
  const body = trailingNewline ? content.slice(0, -1) : content;

  return {
    lines: body === '' ? [] : body.split('\n'),
    trailingNewline
  };
}

function joinFileContent(lines: string[], trailingNewline: boolean): string {
  if (lines.length === 0) {
    return trailingNewline ? '\n' : '';
  }

  return `${lines.join('\n')}${trailingNewline ? '\n' : ''}`;
}

export {
  simulatePatch
};

export type {
  ApplyPatchExecutionResult,
  ChangedFile
};

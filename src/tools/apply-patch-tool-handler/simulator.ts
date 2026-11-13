import * as fs from 'node:fs';
import * as path from 'node:path';

import {isGitPath, unsupportedLineEndingReason} from '../tool-handler-utils';

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

type VirtualFileSnapshot = {
  exists: false;
} | {
  exists: true;
  content: string;
  symlink: boolean;
};

type VirtualFileState = {
  absolutePath: string;
  filePath: string;
  initial: VirtualFileSnapshot;
  current: {exists: false} | {exists: true; content: string};
};

/**
 * 一行内容与其后分隔符绑定；separator 为空表示文件到此结束且无尾换行。
 */
type ContentLine = {
  text: string;
  separator: string;
};

type SplitFileContent = {
  lines: ContentLine[];
  // 文件主流行尾，用于没有原分隔符可继承的新增行。
  mainEol: string;
};

type ApplyPatchSuccess = {ok: true; value: {
  changedFiles: ChangedFile[];
  displayFiles: ApplyPatchDisplayFile[];
}};

type ApplyPatchFailure = {
  ok: false;
  reason: string;
  hint?: string;
  // 匹配失败的 hunk pre-image 行；有值时作为失败提示的最后一段原文回显
  hunkLines?: string[];
  // 仅在写盘前失败时为 true，可向模型声明文件未被改动；写盘阶段异常不设置该标记
  filesUntouched?: boolean;
  displayFiles?: ApplyPatchDisplayFile[];
};

type ApplyPatchExecutionResult = ApplyPatchSuccess | ApplyPatchFailure;

/**
 * 在内存中应用全部文件操作；成功后调用方才会写入文件系统。
 */
function simulatePatch(
  operations: PatchOperation[],
  options: {cwd: string; limits: ApplyPatchLimits}
): ApplyPatchExecutionResult {
  const virtualFiles = new Map<string, VirtualFileState>();
  const displayFiles: ApplyPatchDisplayFile[] = [];

  for (const operation of operations) {
    const resolved = resolvePatchPath(options.cwd, operation.filePath);

    if (!resolved.ok) {
      return {...resolved, displayFiles: createUnresolvedApplyPatchDisplayFiles(operations)};
    }

    let virtualFile = virtualFiles.get(resolved.value);

    if (!virtualFile) {
      const loaded = loadVirtualFile(operation, resolved.value, options.limits);

      if (!loaded.ok) {
        return {...loaded, displayFiles: createUnresolvedApplyPatchDisplayFiles(operations)};
      }

      virtualFile = loaded.value;
      virtualFiles.set(resolved.value, virtualFile);
    }

    if (operation.kind === 'add') {
      const added = simulateAddFile(operation, virtualFile.current);

      if (!added.ok) {
        return {...added, displayFiles: createUnresolvedApplyPatchDisplayFiles(operations)};
      }

      virtualFile.current = {exists: true, content: added.value.content};
      displayFiles.push(added.value.displayFile);
      continue;
    }

    if (!virtualFile.current.exists) {
      return {
        ok: false,
        reason: `target file does not exist: ${operation.filePath}`,
        displayFiles: createUnresolvedApplyPatchDisplayFiles(operations)
      };
    }

    if (operation.kind === 'delete') {
      if (virtualFile.initial.exists && virtualFile.initial.symlink) {
        return {
          ok: false,
          reason: `target path is a symlink: ${operation.filePath}`,
          displayFiles: createUnresolvedApplyPatchDisplayFiles(operations)
        };
      }

      const deleted = simulateDeleteFile(operation, virtualFile.current.content);

      if (!deleted.ok) {
        return {...deleted, displayFiles: createUnresolvedApplyPatchDisplayFiles(operations)};
      }

      virtualFile.current = {exists: false};
      displayFiles.push(deleted.value.displayFile);
      continue;
    }

    const updated = simulateUpdateFile(operation, virtualFile.current.content);

    if (!updated.ok) {
      return {...updated, displayFiles: createUnresolvedApplyPatchDisplayFiles(operations)};
    }

    virtualFile.current = {exists: true, content: updated.value.content};
    displayFiles.push(updated.value.displayFile);
  }

  return {
    ok: true,
    value: {
      changedFiles: createChangedFiles(virtualFiles.values()),
      displayFiles
    }
  };
}

/**
 * 首次遇到路径时读取真实文件；后续同路径操作只消费内存中的当前状态。
 */
function loadVirtualFile(
  operation: PatchOperation,
  absolutePath: string,
  limits: ApplyPatchLimits
): Result<VirtualFileState> {
  if (!fs.existsSync(absolutePath)) {
    if (operation.kind !== 'add') {
      return {ok: false, reason: `target file does not exist: ${operation.filePath}`};
    }

    return {
      ok: true,
      value: {
        absolutePath,
        filePath: operation.filePath,
        initial: {exists: false},
        current: {exists: false}
      }
    };
  }

  if (operation.kind === 'add') {
    return {ok: false, reason: `target file already exists: ${operation.filePath}`};
  }

  const readable = readPatchTargetFile(
    operation.filePath,
    absolutePath,
    limits,
    operation.kind === 'delete' ? 'reject_symlink' : 'follow_symlink'
  );

  if (!readable.ok) {
    return readable;
  }

  const symlink = fs.lstatSync(absolutePath).isSymbolicLink();
  return {
    ok: true,
    value: {
      absolutePath,
      filePath: operation.filePath,
      initial: {exists: true, content: readable.value.content, symlink},
      current: {exists: true, content: readable.value.content}
    }
  };
}

/**
 * 将每个虚拟路径归并为一次最终文件系统操作；新增后删除不产生写盘项。
 */
function createChangedFiles(virtualFiles: Iterable<VirtualFileState>): ChangedFile[] {
  const changedFiles: ChangedFile[] = [];

  for (const file of virtualFiles) {
    if (!file.initial.exists && !file.current.exists) {
      continue;
    }

    if (!file.current.exists) {
      changedFiles.push({kind: 'deleted', filePath: file.filePath, absolutePath: file.absolutePath});
      continue;
    }

    changedFiles.push({
      kind: file.initial.exists ? 'updated' : 'added',
      filePath: file.filePath,
      absolutePath: file.absolutePath,
      content: file.current.content
    });
  }

  return changedFiles;
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
  current: VirtualFileState['current']
): Result<{content: string; displayFile: ApplyPatchDisplayFile}> {
  if (current.exists) {
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
      // 新文件不继承任何既有风格，统一使用 LF。
      content: lines.map((text) => `${text}\n`).join(''),
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
  content: string
): Result<{content: string; displayFile: ApplyPatchDisplayFile}> {
  const split = splitFileContent(content);
  const applied = applySequentialUpdateHunks(operation, split.lines, split.mainEol);

  if (!applied.ok) {
    return applied;
  }

  return {
    ok: true,
    value: {
      content: joinFileContent(applied.value.lines, split.mainEol),
      displayFile: {
        path: operation.filePath,
        kind: 'updated',
        lines: createResolvedDisplayLines(applied.value.matchedHunks, applied.value.lines.map((line) => line.text))
      }
    }
  };
}

function simulateDeleteFile(
  operation: PatchOperation,
  content: string
): Result<{displayFile: ApplyPatchDisplayFile}> {
  const split = splitFileContent(content);
  const originalLines = split.lines.map((line) => line.text);

  return {
    ok: true,
    value: {
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

  const lineEndingReason = unsupportedLineEndingReason(content);

  if (lineEndingReason) {
    return {ok: false, reason: `${lineEndingReason}: ${filePath}`};
  }

  return {ok: true, value: {content}};
}

// hunk 应用结果；失败时允许携带 pre-image 行，供失败提示末尾回显。
type HunkApplicationResult =
  | {ok: true; value: {lines: ContentLine[]; matchedHunks: Array<{hunk: PatchHunk; postStart: number}>}}
  | ApplyPatchFailure;

/**
 * 按 displayLines 逐项重建替换区间：context 复用原行对象以保留其分隔符，只有 added 行需要新行尾。
 * 直接整段使用 newLines 会把 hunk 内未修改的 context 行一并改写行尾。
 */
function rebuildHunkLines(
  lines: ContentLine[],
  start: number,
  hunk: PatchHunk,
  mainEol: string
): ContentLine[] {
  const replacement: ContentLine[] = [];
  let sourceIndex = start;

  for (const line of hunk.displayLines) {
    if (line.kind === 'removed') {
      sourceIndex += 1;
      continue;
    }

    if (line.kind === 'context') {
      replacement.push(lines[sourceIndex]);
      sourceIndex += 1;
      continue;
    }

    replacement.push({text: line.text, separator: mainEol});
  }

  // 替换区间延伸到文件末尾时，末尾新行继承被替换末项的分隔符，避免意外增删尾换行。
  const removedEnd = start + hunk.oldLines.length;
  const lastDisplay = hunk.displayLines[hunk.displayLines.length - 1];

  if (removedEnd === lines.length && lastDisplay?.kind === 'added' && replacement.length > 0) {
    replacement[replacement.length - 1] = {
      text: replacement[replacement.length - 1].text,
      separator: lines[removedEnd - 1]?.separator ?? ''
    };
  }

  return [...lines.slice(0, start), ...replacement, ...lines.slice(removedEnd)];
}

/**
 * 在锚点后插入纯 added 行；末尾插入时新行接管原末行的“无尾换行”属性。
 */
function insertHunkLines(
  lines: ContentLine[],
  insertAt: number,
  newLines: string[],
  mainEol: string
): ContentLine[] {
  const atFileEnd = insertAt === lines.length;
  const takesTrailingState = atFileEnd && lines.length > 0 && lines[lines.length - 1].separator === '';
  const inserted = newLines.map((text, index) => ({
    text,
    // 原文件无尾换行时，只有新末行继续无尾换行；原末行的空分隔符由 joinFileContent 补上。
    separator: takesTrailingState && index === newLines.length - 1 ? '' : mainEol
  }));

  return [...lines.slice(0, insertAt), ...inserted, ...lines.slice(insertAt)];
}

function applySequentialUpdateHunks(
  operation: PatchOperation,
  startingLines: ContentLine[],
  mainEol: string
): HunkApplicationResult {
  let currentLines = startingLines;
  const matchedHunks: Array<{hunk: PatchHunk; postStart: number}> = [];
  let searchStart = 0;

  for (const [hunkIndex, hunk] of operation.hunks.entries()) {
    const hunkRef = formatHunkRef(hunkIndex, operation.hunks.length);

    if (hunk.anchorLine !== undefined) {
      const anchor = findFirstMatch(currentLines, [hunk.anchorLine], searchStart);

      if (!anchor.ok) {
        return {
          ok: false,
          reason: `${hunkRef} anchor line ${anchor.reason} in ${operation.filePath}`,
          hint: 'Read the file again and include more surrounding context in the hunk.',
          hunkLines: [hunk.anchorLine]
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
          reason: `${hunkRef} for ${operation.filePath} has no context or removed lines`,
          hint: 'Read the file again and include context around the insertion.'
        };
      }

      const contextMatch = findFirstMatch(currentLines, hunk.oldLines, searchStart);

      if (!contextMatch.ok) {
        return {
          ok: false,
          reason: `${hunkRef} ${contextMatch.reason} in ${operation.filePath}`,
          hint: 'Read the file again and include more surrounding context in the hunk.',
          hunkLines: hunk.oldLines
        };
      }

      searchStart = contextMatch.value + hunk.oldLines.length;
      continue;
    }

    if (hunk.oldLines.length === 0) {
      if (hunk.anchorLine === undefined) {
        return {
          ok: false,
          reason: `${hunkRef} for ${operation.filePath} has no context or removed lines`,
          hint: 'Read the file again and include context around the insertion.'
        };
      }

      const insertAt = searchStart;
      matchedHunks.push({hunk, postStart: insertAt});
      currentLines = insertHunkLines(currentLines, insertAt, hunk.newLines, mainEol);
      searchStart = insertAt + hunk.newLines.length;
      continue;
    }

    const match = findFirstMatch(currentLines, hunk.oldLines, searchStart);

    if (!match.ok) {
      return {
        ok: false,
        reason: `${hunkRef} ${match.reason} in ${operation.filePath}`,
        hint: 'Read the file again and include more surrounding context in the hunk.',
        hunkLines: hunk.oldLines
      };
    }

    matchedHunks.push({hunk, postStart: match.value});
    currentLines = rebuildHunkLines(currentLines, match.value, hunk, mainEol);
    searchStart = match.value + hunk.newLines.length;
  }

  return {ok: true, value: {lines: currentLines, matchedHunks}};
}

/**
 * 失败原因必须定位到具体 hunk；序号从 1 开始，与 patch 中 hunk 的书写顺序一致。
 */
function formatHunkRef(hunkIndex: number, totalHunks: number): string {
  return `hunk ${hunkIndex + 1} of ${totalHunks}`;
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

function findFirstMatch(lines: ContentLine[], target: string[], startIndex: number): Result<number> {
  // Begin Patch 顺序模式按 V4A 语义从游标后取第一个精确匹配，重复上下文交给游标推进消歧。
  for (let index = startIndex; index <= lines.length - target.length; index += 1) {
    let matched = true;

    for (let offset = 0; offset < target.length; offset += 1) {
      if (lines[index + offset].text !== target[offset]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return {ok: true, value: index};
    }
  }

  return {ok: false, reason: 'matched 0 locations'};
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

/**
 * 按 `\r\n` 与 `\n` 切分并保留每行原始分隔符；行内裸 CR 不属于分隔符。
 *
 * 调用方读取文件时已由 unsupportedLineEndingReason 拒绝裸 CR，因此“保留行内 CR”分支正常不可达，
 * 仅用于防止未来新增调用方绕过该检查。主流行尾在本次遍历中一并统计，避免二次扫描。
 */
function splitFileContent(content: string): SplitFileContent {
  if (content === '') {
    return {lines: [], mainEol: '\n'};
  }

  const lines: ContentLine[] = [];
  let start = 0;
  let crlfCount = 0;
  let lfCount = 0;

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== '\n') {
      continue;
    }

    // 只有紧邻 \n 的 \r 属于分隔符；其余 CR 留在行内容里。
    const hasCarriageReturn = index > start && content[index - 1] === '\r';
    const textEnd = hasCarriageReturn ? index - 1 : index;
    lines.push({text: content.slice(start, textEnd), separator: hasCarriageReturn ? '\r\n' : '\n'});
    if (hasCarriageReturn) crlfCount += 1;
    else lfCount += 1;
    start = index + 1;
  }

  if (start < content.length) {
    lines.push({text: content.slice(start), separator: ''});
  }

  return {lines, mainEol: crlfCount > lfCount ? '\r\n' : '\n'};
}

/**
 * 不变量守卫：`''` 只允许出现在最后一行。
 *
 * rebuildHunkLines 复用的 context 行与 insertHunkLines 之前的原末行都可能带着空分隔符，
 * 一旦它们因插入或替换而不再位于末尾，在这里统一补主流行尾即可，上游无需各自补位。
 */
function joinFileContent(lines: ContentLine[], mainEol: string): string {
  return lines.map((line, index) => {
    const separator = line.separator === '' && index < lines.length - 1 ? mainEol : line.separator;
    return line.text + separator;
  }).join('');
}

export {
  simulatePatch
};

export type {
  ApplyPatchExecutionResult,
  ChangedFile
};

import type {DiffFile, DiffHunk, DiffLine} from '../../types/diff';

type CreateDiffFileOptions = {
  newContent?: string;
  newExists: boolean;
  oldContent?: string;
  oldExists: boolean;
  oldPath?: string;
  path: string;
};

/**
 * 从 before/after 文本生成轻量 diff；fallback 只需要表达最终差异，不追求最小编辑路径。
 */
function createDiffFileFromContents(options: CreateDiffFileOptions): DiffFile | null {
  const oldLines = options.oldExists ? splitContent(options.oldContent || '') : [];
  const newLines = options.newExists ? splitContent(options.newContent || '') : [];

  if (options.oldExists && options.newExists && options.oldContent === options.newContent) {
    return null;
  }

  if (!options.oldExists && options.newExists) {
    return createWholeFileDiff({
      kind: 'added',
      path: options.path,
      lines: newLines.map((text, index) => ({kind: 'added', text, oldLine: null, newLine: index + 1}))
    });
  }

  if (options.oldExists && !options.newExists) {
    return createWholeFileDiff({
      kind: 'deleted',
      oldPath: options.oldPath,
      path: options.path,
      lines: oldLines.map((text, index) => ({kind: 'removed', text, oldLine: index + 1, newLine: null}))
    });
  }

  return createModifiedDiff({
    oldLines,
    newLines,
    oldPath: options.oldPath,
    path: options.path
  });
}

function createModifiedDiff(options: {newLines: string[]; oldLines: string[]; oldPath?: string; path: string}): DiffFile | null {
  const {oldLines, newLines} = options;
  let prefix = 0;

  // fallback diff 不做 LCS；只剥掉共同前后缀，保留少量上下文，保证实现稳定可预测。
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }

  let suffix = 0;

  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldChangeEnd = oldLines.length - suffix;
  const newChangeEnd = newLines.length - suffix;
  const contextBeforeStart = Math.max(0, prefix - 3);
  const contextAfterCount = Math.min(3, suffix);
  const lines: DiffLine[] = [];

  for (let index = contextBeforeStart; index < prefix; index += 1) {
    lines.push({kind: 'context', text: oldLines[index], oldLine: index + 1, newLine: index + 1});
  }

  for (let index = prefix; index < oldChangeEnd; index += 1) {
    lines.push({kind: 'removed', text: oldLines[index], oldLine: index + 1, newLine: null});
  }

  for (let index = prefix; index < newChangeEnd; index += 1) {
    lines.push({kind: 'added', text: newLines[index], oldLine: null, newLine: index + 1});
  }

  for (let offset = 0; offset < contextAfterCount; offset += 1) {
    const oldIndex = oldChangeEnd + offset;
    const newIndex = newChangeEnd + offset;
    lines.push({kind: 'context', text: oldLines[oldIndex], oldLine: oldIndex + 1, newLine: newIndex + 1});
  }

  if (lines.length === 0) {
    return null;
  }

  return createFile({
    kind: 'modified',
    path: options.path,
    oldPath: options.oldPath,
    hunks: [{
      oldStart: contextBeforeStart + 1,
      newStart: contextBeforeStart + 1,
      lines
    }]
  });
}

function createWholeFileDiff(options: {kind: 'added' | 'deleted'; lines: DiffLine[]; oldPath?: string; path: string}): DiffFile | null {
  if (options.lines.length === 0) {
    return null;
  }

  return createFile({
    kind: options.kind,
    oldPath: options.oldPath,
    path: options.path,
    hunks: [{
      oldStart: options.kind === 'added' ? 0 : 1,
      newStart: options.kind === 'added' ? 1 : 0,
      lines: options.lines
    }]
  });
}

function createFile(options: {hunks: DiffHunk[]; kind: DiffFile['kind']; oldPath?: string; path: string}): DiffFile {
  const added = options.hunks.reduce((count, hunk) => count + hunk.lines.filter((line) => line.kind === 'added').length, 0);
  const removed = options.hunks.reduce((count, hunk) => count + hunk.lines.filter((line) => line.kind === 'removed').length, 0);

  return {
    added,
    hunks: options.hunks,
    kind: options.kind,
    ...(options.oldPath ? {oldPath: options.oldPath} : {}),
    path: options.path,
    removed
  };
}

function splitContent(content: string): string[] {
  if (content === '') {
    return [];
  }

  // Git diff 的行模型不把文件末尾换行当成额外空行；这里保持同样的展示语义。
  const body = content.endsWith('\n') ? content.slice(0, -1) : content;

  return body === '' ? [] : body.split('\n');
}

export {
  createDiffFileFromContents,
  splitContent
};

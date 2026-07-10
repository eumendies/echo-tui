import type {DiffFile, DiffHunk, DiffLine} from '../../types/diff';

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@\s?(.*)$/;

type MutableDiffFile = {
  hunks: DiffHunk[];
  kind: DiffFile['kind'];
  oldPath?: string;
  path: string;
};

/**
 * 解析 Git unified diff 文本，生成 renderer 和 command handler 共享的 diff 模型。
 */
function parseUnifiedDiff(text: string): DiffFile[] {
  const files: MutableDiffFile[] = [];
  let current: MutableDiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const ensureFile = (): MutableDiffFile => {
    if (!current) {
      // 部分 patch 可能缺少 diff --git 行，先创建占位文件，再由 ---/+++ 头补路径。
      current = {kind: 'modified', path: '', hunks: []};
      files.push(current);
    }

    return current;
  };

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (rawLine.startsWith('diff --git ')) {
      current = parseDiffGitLine(rawLine);
      files.push(current);
      hunk = null;
      continue;
    }

    if (rawLine.startsWith('rename from ')) {
      const file = ensureFile();
      file.oldPath = stripGitPrefix(rawLine.slice('rename from '.length));
      file.kind = 'renamed';
      continue;
    }

    if (rawLine.startsWith('rename to ')) {
      const file = ensureFile();
      file.path = stripGitPrefix(rawLine.slice('rename to '.length));
      file.kind = 'renamed';
      continue;
    }

    if (rawLine.startsWith('new file mode ')) {
      ensureFile().kind = 'added';
      continue;
    }

    if (rawLine.startsWith('deleted file mode ')) {
      ensureFile().kind = 'deleted';
      continue;
    }

    if (rawLine.startsWith('--- ')) {
      const file = ensureFile();
      const parsedPath = parseHeaderPath(rawLine.slice(4));

      if (parsedPath === '/dev/null') {
        file.kind = 'added';
      } else {
        file.oldPath = stripGitPrefix(parsedPath);
      }
      continue;
    }

    if (rawLine.startsWith('+++ ')) {
      const file = ensureFile();
      const parsedPath = parseHeaderPath(rawLine.slice(4));

      if (parsedPath === '/dev/null') {
        file.kind = 'deleted';
      } else {
        file.path = stripGitPrefix(parsedPath);
      }
      continue;
    }

    const hunkMatch = HUNK_RE.exec(rawLine);

    if (hunkMatch) {
      const file = ensureFile();
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[2]);
      hunk = {
        oldStart: oldLine,
        newStart: newLine,
        ...(hunkMatch[3] ? {header: hunkMatch[3]} : {}),
        lines: []
      };
      file.hunks.push(hunk);
      continue;
    }

    if (!hunk || rawLine.startsWith('\\')) {
      // "\ No newline at end of file" 是 hunk 元信息，不参与行号和内容统计。
      continue;
    }

    const marker = rawLine.slice(0, 1);
    const content = rawLine.slice(1);

    if (marker === '+') {
      hunk.lines.push({kind: 'added', text: content, oldLine: null, newLine});
      newLine += 1;
    } else if (marker === '-') {
      hunk.lines.push({kind: 'removed', text: content, oldLine, newLine: null});
      oldLine += 1;
    } else if (marker === ' ') {
      hunk.lines.push({kind: 'context', text: content, oldLine, newLine});
      oldLine += 1;
      newLine += 1;
    }
  }

  return files
    .map(finalizeFile)
    .filter((file): file is DiffFile => file !== null);
}

function parseDiffGitLine(line: string): MutableDiffFile {
  const parts = line.trim().split(/\s+/);
  const oldPath = parts.length >= 4 ? stripGitPrefix(parts[2]) : '';
  const newPath = parts.length >= 4 ? stripGitPrefix(parts[3]) : oldPath;

  return {
    kind: 'modified',
    ...(oldPath ? {oldPath} : {}),
    path: newPath,
    hunks: []
  };
}

function parseHeaderPath(rawPath: string): string {
  // Git header 路径后可能带 tab 分隔的时间戳，只取真正的路径部分。
  return rawPath.trim().split('\t')[0];
}

function stripGitPrefix(filePath: string): string {
  const trimmed = filePath.trim();

  return trimmed.startsWith('a/') || trimmed.startsWith('b/') ? trimmed.slice(2) : trimmed;
}

function finalizeFile(file: MutableDiffFile): DiffFile | null {
  const hunks = file.hunks.filter((hunk) => hunk.lines.length > 0);

  if (hunks.length === 0) {
    return null;
  }

  const added = countLines(hunks, 'added');
  const removed = countLines(hunks, 'removed');
  // 删除文件的展示路径优先使用 oldPath，否则 renderer 会看到 /dev/null 方向的空路径。
  const path = file.kind === 'deleted' && file.oldPath ? file.oldPath : file.path || file.oldPath || '';

  if (!path) {
    return null;
  }

  return {
    added,
    hunks,
    kind: file.kind,
    ...(file.oldPath && file.oldPath !== path ? {oldPath: file.oldPath} : {}),
    path,
    removed
  };
}

function countLines(hunks: DiffHunk[], kind: DiffLine['kind']): number {
  return hunks.reduce((total, hunk) => total + hunk.lines.filter((line) => line.kind === kind).length, 0);
}

export {
  parseUnifiedDiff
};

type ApplyPatchLimits = {
  maxPatchBytes: number;
  maxFileBytes: number;
  maxChangedFiles: number;
  maxHunks: number;
};

// 不同输入语法最终都会归一成文件级操作，后续应用逻辑只处理这个内部模型。
type PatchOperation = {
  kind: 'add' | 'update' | 'delete';
  filePath: string;
  hunks: PatchHunk[];
};

// oldLines 是精确匹配锚点，newLines 是替换后的内容；行号只在 parser 层校验格式。
type PatchHunk = {
  anchorLine?: string;
  hasChange: boolean;
  oldLines: string[];
  newLines: string[];
  displayLines: ParsedPatchLine[];
};

type ParsedPatchLine = {
  kind: 'context' | 'removed' | 'added';
  text: string;
};

type Result<T> = {ok: true; value: T} | {ok: false; reason: string; hint?: string};

/**
 * 仅将 Begin Patch 输入解析为文件操作；数字块头只校验格式，不用作定位。
 */
function parsePatchText(patch: string, limits: ApplyPatchLimits): Result<PatchOperation[]> {
  const normalizedPatch = patch.replace(/\r\n?/g, '\n');
  const beginPatch = prepareBeginPatchInput(normalizedPatch);

  return beginPatch === null
    ? {ok: false, reason: 'patch must use *** Begin Patch format'}
    : parseBeginPatch(beginPatch, limits);
}

function prepareBeginPatchInput(patch: string): string | null {
  const lines = patch.split('\n');
  const beginIndex = lines.findIndex((line) => line.trim() !== '');

  if (beginIndex < 0 || lines[beginIndex].trimStart() !== '*** Begin Patch') {
    return null;
  }

  return stripBeginPatchIndent(lines.slice(beginIndex).join('\n'));
}

function stripBeginPatchIndent(patch: string): string {
  const lines = patch.split('\n');
  const beginLine = lines.find((line) => line.trimStart() === '*** Begin Patch');

  if (!beginLine) {
    return patch;
  }

  const indentLength = beginLine.length - beginLine.trimStart().length;

  if (indentLength === 0) {
    return patch;
  }

  const indent = beginLine.slice(0, indentLength);
  // 模型有时会把整段工具参数缩进；只剥离和 Begin Patch 行一致的公共缩进。
  return lines.map((line) => line.startsWith(indent) ? line.slice(indentLength) : line).join('\n');
}

function parseBeginPatch(patch: string, limits: ApplyPatchLimits): Result<PatchOperation[]> {
  const lines = patch.split('\n');
  const operations: PatchOperation[] = [];
  let index = 1;
  let hunkCount = 0;
  let sawEnd = false;

  while (index < lines.length) {
    const line = normalizeBeginPatchLine(lines[index]);

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    if (line === '*** End Patch') {
      sawEnd = true;
      index += 1;
      break;
    }

    const addFile = /^\*\*\* Add File:\s*(.+)$/.exec(line);

    if (addFile) {
      const parsed = parseBeginPatchAddFile(lines, index + 1, addFile[1].trim(), limits, hunkCount);

      if (!parsed.ok) {
        return parsed;
      }

      operations.push(parsed.value.operation);
      hunkCount = parsed.value.hunkCount;
      index = parsed.value.nextIndex;

      if (operations.length > limits.maxChangedFiles) {
        return {ok: false, reason: `patch changes more than ${limits.maxChangedFiles} files`};
      }

      continue;
    }

    const updateFile = /^\*\*\* Update File:\s*(.+)$/.exec(line);

    if (updateFile) {
      const parsed = parseBeginPatchUpdateFile(lines, index + 1, updateFile[1].trim(), limits, hunkCount);

      if (!parsed.ok) {
        return parsed;
      }

      operations.push(parsed.value.operation);
      hunkCount = parsed.value.hunkCount;
      index = parsed.value.nextIndex;

      if (operations.length > limits.maxChangedFiles) {
        return {ok: false, reason: `patch changes more than ${limits.maxChangedFiles} files`};
      }

      continue;
    }

    const deleteFile = /^\*\*\* Delete File:\s*(.+)$/.exec(line);

    if (deleteFile) {
      operations.push({
        filePath: deleteFile[1].trim(),
        hunks: [],
        kind: 'delete'
      });
      index += 1;

      if (operations.length > limits.maxChangedFiles) {
        return {ok: false, reason: `patch changes more than ${limits.maxChangedFiles} files`};
      }

      continue;
    }

    if (line.startsWith('*** Move to:') || line.startsWith('*** Rename to:')) {
      return {ok: false, reason: 'rename or move patches are not supported'};
    }

    return {ok: false, reason: `unsupported begin patch directive: ${line}`};
  }

  if (!sawEnd) {
    return {ok: false, reason: 'begin patch must end with *** End Patch'};
  }

  while (index < lines.length) {
    if (lines[index].trim() !== '') {
      return {ok: false, reason: `unexpected content after *** End Patch: ${lines[index]}`};
    }

    index += 1;
  }

  return operations.length === 0
    ? {ok: false, reason: 'patch contains no file changes'}
    : {ok: true, value: operations};
}

function parseBeginPatchAddFile(
  lines: string[],
  startIndex: number,
  filePath: string,
  limits: ApplyPatchLimits,
  startingHunkCount: number
): Result<{operation: PatchOperation; nextIndex: number; hunkCount: number}> {
  const newLines: string[] = [];
  const displayLines: ParsedPatchLine[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = normalizeBeginPatchLine(lines[index]);

    if (isBeginPatchDirective(line)) {
      break;
    }

    if (line.startsWith('\\ No newline at end of file')) {
      index += 1;
      continue;
    }

    if (!line.startsWith('+')) {
      return {ok: false, reason: `add file lines for ${filePath} must start with +`};
    }

    const text = line.slice(1);
    newLines.push(text);
    displayLines.push({kind: 'added', text});
    index += 1;
  }

  const hunkCount = startingHunkCount + 1;

  if (hunkCount > limits.maxHunks) {
    return {ok: false, reason: `patch exceeds ${limits.maxHunks} hunks`};
  }

  return {
    ok: true,
    value: {
      hunkCount,
      nextIndex: index,
      operation: {
        filePath,
        hunks: [{hasChange: true, oldLines: [], newLines, displayLines}],
        kind: 'add'
      }
    }
  };
}

function parseBeginPatchUpdateFile(
  lines: string[],
  startIndex: number,
  filePath: string,
  limits: ApplyPatchLimits,
  startingHunkCount: number
): Result<{operation: PatchOperation; nextIndex: number; hunkCount: number}> {
  const operation: PatchOperation = {kind: 'update', filePath, hunks: []};
  let index = startIndex;
  let hunkCount = startingHunkCount;
  let hasChangedHunk = false;

  while (index < lines.length) {
    const line = normalizeBeginPatchLine(lines[index]);

    if (isBeginPatchDirective(line)) {
      break;
    }

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    if (!line.startsWith('@@')) {
      return {ok: false, reason: `expected begin patch hunk header for ${filePath}, got: ${line}`};
    }

    const hunk = parseBeginPatchHunk(lines, index);

    if (!hunk.ok) {
      return hunk;
    }

    hunkCount += 1;

    if (hunkCount > limits.maxHunks) {
      return {ok: false, reason: `patch exceeds ${limits.maxHunks} hunks`};
    }

    operation.hunks.push(hunk.value.hunk);
    hasChangedHunk = hasChangedHunk || hunk.value.hunk.hasChange;
    index = hunk.value.nextIndex;
  }

  if (operation.hunks.length === 0) {
    return {ok: false, reason: `file patch for ${filePath} has no hunks`};
  }

  return hasChangedHunk
    ? {ok: true, value: {hunkCount, nextIndex: index, operation}}
    : {ok: false, reason: `file patch for ${filePath} has no changed hunks`};
}

function parseBeginPatchHunk(lines: string[], startIndex: number): Result<{hunk: PatchHunk; nextIndex: number}> {
  const header = parseBeginPatchHunkHeader(normalizeBeginPatchLine(lines[startIndex]));

  if (!header.ok) {
    return header;
  }

  const oldLines: string[] = [];
  const newLines: string[] = [];
  const displayLines: ParsedPatchLine[] = [];
  let hasChange = false;
  let index = startIndex + 1;

  while (index < lines.length) {
    const rawLine = lines[index];

    if (!isBeginPatchHunkBodyLine(rawLine)) {
      const boundaryLine = normalizeBeginPatchLine(rawLine);

      if (boundaryLine.startsWith('@@') || isBeginPatchDirective(boundaryLine)) {
        break;
      }

      if (boundaryLine.startsWith('\\ No newline at end of file')) {
        index += 1;
        continue;
      }

      return {ok: false, reason: `invalid begin patch hunk line: ${boundaryLine}`};
    }

    // Hunk body 第一列是 V4A 操作符；第二列开始才是文件内容，不能 trimStart。
    const line = rawLine;

    if (line.startsWith(' ')) {
      const text = line.slice(1);
      oldLines.push(text);
      newLines.push(text);
      displayLines.push({kind: 'context', text});
    } else if (line.startsWith('-')) {
      const text = line.slice(1);
      oldLines.push(text);
      displayLines.push({kind: 'removed', text});
      hasChange = true;
    } else if (line.startsWith('+')) {
      const text = line.slice(1);
      newLines.push(text);
      displayLines.push({kind: 'added', text});
      hasChange = true;
    }

    index += 1;
  }

  return {
    ok: true,
    value: {
      hunk: {
        ...(header.value ? {anchorLine: header.value} : {}),
        hasChange,
        oldLines,
        newLines,
        displayLines
      },
      nextIndex: index
    }
  };
}

function isBeginPatchHunkBodyLine(line: string): boolean {
  return line.startsWith(' ') || line.startsWith('-') || line.startsWith('+');
}

function parseBeginPatchHunkHeader(line: string): Result<string | undefined> {
  if (line === '@@') {
    return {ok: true, value: undefined};
  }

  if (/^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/.test(line)) {
    return {ok: true, value: undefined};
  }

  if (line.startsWith('@@ ')) {
    return {ok: true, value: line.slice(3)};
  }

  return {ok: false, reason: `invalid begin patch hunk header: ${line}`};
}

function normalizeBeginPatchLine(line: string): string {
  const trimmed = line.trimStart();

  if (
    trimmed.startsWith('*** ') ||
    trimmed.startsWith('@@') ||
    trimmed.startsWith('+') ||
    trimmed.startsWith('-') ||
    trimmed.startsWith('\\ No newline at end of file')
  ) {
    return trimmed;
  }

  return line;
}

function isBeginPatchDirective(line: string): boolean {
  return line.startsWith('*** ');
}

export {
  parsePatchText
};

export type {
  ApplyPatchLimits,
  PatchHunk,
  PatchOperation,
  Result
};

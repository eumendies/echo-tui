type ApplyPatchLimits = {
  maxPatchBytes: number;
  maxFileBytes: number;
  maxChangedFiles: number;
  maxHunks: number;
};

// 不同输入语法最终都会归一成文件级操作，后续应用逻辑只处理这个内部模型。
type PatchOperation = {
  kind: 'add' | 'update';
  filePath: string;
  hunks: PatchHunk[];
  matchMode: 'independent' | 'sequential';
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
 * 将 Begin Patch 或 unified diff 输入归一为文件操作，不使用 header 行号定位内容。
 */
function parsePatchText(patch: string, limits: ApplyPatchLimits): Result<PatchOperation[]> {
  const normalizedPatch = patch.replace(/\r\n?/g, '\n');
  const beginPatch = prepareBeginPatchInput(normalizedPatch);

  return beginPatch === null
    ? parseUnifiedDiff(normalizedPatch, limits)
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

    if (line.startsWith('*** Delete File:')) {
      return {ok: false, reason: 'delete file patches are not supported'};
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
        matchMode: 'independent',
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
  const operation: PatchOperation = {kind: 'update', filePath, hunks: [], matchMode: 'sequential'};
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

/**
 * 解析 unified diff 常见子集；不支持的 git patch 元数据会在这里明确失败。
 */
function parseUnifiedDiff(patch: string, limits: ApplyPatchLimits): Result<PatchOperation[]> {
  const lines = patch.split('\n');
  const operations: PatchOperation[] = [];
  let index = 0;
  let hunkCount = 0;
  let inferredOperation: PatchOperation | null = null;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const unsupported = detectUnsupportedMetadata(line);

    if (!unsupported.ok) {
      return unsupported;
    }

    if (line.startsWith('diff --git ')) {
      const inferred = parseDiffGitOperation(line);

      if (!inferred.ok) {
        return inferred;
      }

      inferredOperation = inferred.value;
      index += 1;
      continue;
    }

    if (line.startsWith('index ') || isIgnoredNewFileMode(line)) {
      index += 1;
      continue;
    }

    if (!line.startsWith('--- ')) {
      if (line.startsWith('@@') && inferredOperation) {
        const parsed = parseOperationHunks(lines, index, inferredOperation, limits, hunkCount);

        if (!parsed.ok) {
          return parsed;
        }

        operations.push(parsed.value.operation);
        hunkCount = parsed.value.hunkCount;
        index = parsed.value.nextIndex;
        inferredOperation = null;

        if (operations.length > limits.maxChangedFiles) {
          return {ok: false, reason: `patch changes more than ${limits.maxChangedFiles} files`};
        }

        continue;
      }

      return {ok: false, reason: `expected file header, got: ${line}`};
    }

    if (index + 1 >= lines.length || !lines[index + 1].startsWith('+++ ')) {
      return {ok: false, reason: 'file header must contain both --- and +++ lines'};
    }

    const operation = parseFileOperation(line, lines[index + 1]);

    if (!operation.ok) {
      return operation;
    }

    index += 2;
    inferredOperation = null;
    const parsed = parseOperationHunks(lines, index, operation.value, limits, hunkCount);

    if (!parsed.ok) {
      return parsed;
    }

    operations.push(parsed.value.operation);
    hunkCount = parsed.value.hunkCount;
    index = parsed.value.nextIndex;

    if (operations.length > limits.maxChangedFiles) {
      return {ok: false, reason: `patch changes more than ${limits.maxChangedFiles} files`};
    }
  }

  return operations.length === 0
    ? {ok: false, reason: 'patch contains no file changes'}
    : {ok: true, value: operations};
}

function parseOperationHunks(
  lines: string[],
  startIndex: number,
  operation: PatchOperation,
  limits: ApplyPatchLimits,
  startingHunkCount: number
): Result<{operation: PatchOperation; nextIndex: number; hunkCount: number}> {
  let index = startIndex;
  let hunkCount = startingHunkCount;

  while (index < lines.length) {
    const current = lines[index];

    if (current.trim() === '') {
      index += 1;
      continue;
    }

    const unsupported = detectUnsupportedMetadata(current);

    if (!unsupported.ok) {
      return unsupported;
    }

    if (
      current.startsWith('diff --git ') ||
      (current.startsWith('--- ') && index + 1 < lines.length && lines[index + 1].startsWith('+++ '))
    ) {
      break;
    }

    if (!current.startsWith('@@')) {
      return {ok: false, reason: `expected hunk header, got: ${current}`};
    }

    const hunk = parseHunk(lines, index);

    if (!hunk.ok) {
      return hunk;
    }

    hunkCount += 1;

    if (hunkCount > limits.maxHunks) {
      return {ok: false, reason: `patch exceeds ${limits.maxHunks} hunks`};
    }

    operation.hunks.push(hunk.value.hunk);
    index = hunk.value.nextIndex;
  }

  return operation.hunks.length === 0
    ? {ok: false, reason: `file patch for ${operation.filePath} has no hunks`}
    : {ok: true, value: {hunkCount, nextIndex: index, operation}};
}

function parseDiffGitOperation(line: string): Result<PatchOperation> {
  const match = /^diff --git\s+(\S+)\s+(\S+)$/.exec(line);

  if (!match) {
    return {ok: false, reason: `invalid diff --git header: ${line}`};
  }

  const oldPath = normalizeDiffPath(match[1]);
  const newPath = normalizeDiffPath(match[2]);

  return oldPath === newPath
    ? {ok: true, value: {kind: 'update', filePath: newPath, hunks: [], matchMode: 'independent'}}
    : {ok: false, reason: 'rename or move patches are not supported'};
}

function parseFileOperation(oldHeader: string, newHeader: string): Result<PatchOperation> {
  const oldPath = parseHeaderPath(oldHeader.slice(4));
  const newPath = parseHeaderPath(newHeader.slice(4));

  if (!oldPath || !newPath) {
    return {ok: false, reason: 'file header is missing a path'};
  }

  if (newPath === '/dev/null') {
    return {ok: false, reason: 'delete file patches are not supported'};
  }

  if (oldPath === '/dev/null') {
    return {ok: true, value: {kind: 'add', filePath: normalizeDiffPath(newPath), hunks: [], matchMode: 'independent'}};
  }

  const oldNormalized = normalizeDiffPath(oldPath);
  const newNormalized = normalizeDiffPath(newPath);

  return oldNormalized === newNormalized
    ? {ok: true, value: {kind: 'update', filePath: newNormalized, hunks: [], matchMode: 'independent'}}
    : {ok: false, reason: 'rename or move patches are not supported'};
}

function parseHunk(lines: string[], startIndex: number): Result<{hunk: PatchHunk; nextIndex: number}> {
  const header = lines[startIndex];

  if (!/^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/.test(header)) {
    return {ok: false, reason: `invalid hunk header: ${header}`};
  }

  const oldLines: string[] = [];
  const newLines: string[] = [];
  const displayLines: ParsedPatchLine[] = [];
  let hasChange = false;
  let index = startIndex + 1;

  while (index < lines.length) {
    const line = lines[index];

    if (
      line.startsWith('@@') ||
      line.startsWith('diff --git ') ||
      (line.startsWith('--- ') && index + 1 < lines.length && lines[index + 1].startsWith('+++ '))
    ) {
      break;
    }

    if (line.startsWith('\\ No newline at end of file')) {
      index += 1;
      continue;
    }

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
    } else if (line === '' && index === lines.length - 1) {
      break;
    } else {
      return {ok: false, reason: `invalid hunk line: ${line}`};
    }

    index += 1;
  }

  return hasChange
    ? {ok: true, value: {hunk: {hasChange: true, oldLines, newLines, displayLines}, nextIndex: index}}
    : {ok: false, reason: 'hunk must contain at least one added or removed line'};
}

function detectUnsupportedMetadata(line: string): Result<void> {
  if (line.startsWith('deleted file mode')) {
    return {ok: false, reason: 'delete file patches are not supported'};
  }

  if (line.startsWith('rename from') || line.startsWith('rename to') || line.startsWith('copy from') || line.startsWith('copy to')) {
    return {ok: false, reason: 'rename, move, and copy patches are not supported'};
  }

  if (line.startsWith('old mode') || line.startsWith('new mode')) {
    return {ok: false, reason: 'mode change patches are not supported'};
  }

  if (line.startsWith('GIT binary patch') || line.startsWith('Binary files ')) {
    return {ok: false, reason: 'binary patches are not supported'};
  }

  if (line === 'new file mode 120000') {
    return {ok: false, reason: 'symlink patches are not supported'};
  }

  if (line.startsWith('new file mode ') && !isIgnoredNewFileMode(line)) {
    return {ok: false, reason: 'file mode patches are not supported'};
  }

  return {ok: true, value: undefined};
}

function isIgnoredNewFileMode(line: string): boolean {
  return line === 'new file mode 100644';
}

function parseHeaderPath(rawPath: string): string {
  return rawPath.trim().split('\t')[0];
}

function normalizeDiffPath(diffPath: string): string {
  return diffPath.startsWith('a/') || diffPath.startsWith('b/') ? diffPath.slice(2) : diffPath;
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

import type {FileEditDisplayFile, FileEditDisplayLine} from '../../types/tool';

type ReplacementSpan = {
  oldEnd: number;
  oldStart: number;
  postEnd: number;
  postStart: number;
};

type LineRegion = {
  oldEnd: number;
  oldStart: number;
  postEnd: number;
  postStart: number;
};

/**
 * 将已完成的字符串替换投影为完整行级事实；renderer 只需折叠 context，不再读取文件。
 */
function createEditFileDisplayFile(filePath: string, before: string, after: string, spans: ReplacementSpan[]): FileEditDisplayFile {
  const beforeLines = splitContentLines(before);
  const afterLines = splitContentLines(after);
  const regions = mergeLineRegions(spans.map((span) => createLineRegion(before, after, span)));
  const removedByPostLine = new Map<number, string[]>();
  const addedPostLines = new Set<number>();

  for (const region of regions) {
    const anchor = Math.min(region.postStart, afterLines.length);
    const removed = beforeLines.slice(region.oldStart, region.oldEnd + 1);
    removedByPostLine.set(anchor, [...(removedByPostLine.get(anchor) || []), ...removed]);

    for (let index = region.postStart; index <= region.postEnd && index < afterLines.length; index += 1) {
      addedPostLines.add(index);
    }
  }

  const lines: FileEditDisplayLine[] = [];
  for (let index = 0; index <= afterLines.length; index += 1) {
    for (const text of removedByPostLine.get(index) || []) {
      lines.push({kind: 'removed', text, postLine: null});
    }

    if (index < afterLines.length) {
      lines.push({
        kind: addedPostLines.has(index) ? 'added' : 'context',
        text: afterLines[index],
        postLine: index + 1
      });
    }
  }

  return {path: filePath, kind: 'updated', lines};
}

function createLineRegion(before: string, after: string, span: ReplacementSpan): LineRegion {
  const oldStart = lineIndexAtOffset(before, span.oldStart);
  const wholeLineDeletion = isWholeLineDeletion(before, span);
  const removedEndsWithNewline = before[span.oldEnd - 1] === '\n';
  const replacementEndsWithNewline = span.postEnd > span.postStart && after[span.postEnd - 1] === '\n';
  const extendsIntoFollowingLine = removedEndsWithNewline
    && !replacementEndsWithNewline
    && !wholeLineDeletion
    && span.oldEnd < before.length;
  const oldEnd = lineIndexAtOffset(before, extendsIntoFollowingLine
    ? span.oldEnd
    : Math.max(span.oldStart, span.oldEnd - 1));
  const postStart = lineIndexAtOffset(after, span.postStart);
  const postEnd = span.postEnd > span.postStart
    ? lineIndexAtOffset(after, span.postEnd - 1)
    : wholeLineDeletion
      ? postStart - 1
      : Math.min(postStart, Math.max(0, splitContentLines(after).length - 1));
  return {oldStart, oldEnd, postStart, postEnd};
}

function isWholeLineDeletion(content: string, span: ReplacementSpan): boolean {
  const startsAtLineBoundary = span.oldStart === 0 || content[span.oldStart - 1] === '\n';
  const endsAtLineBoundary = span.oldEnd === content.length || content[span.oldEnd - 1] === '\n';
  return span.postStart === span.postEnd && startsAtLineBoundary && endsAtLineBoundary;
}

function mergeLineRegions(regions: LineRegion[]): LineRegion[] {
  const merged: LineRegion[] = [];

  for (const region of regions) {
    const previous = merged[merged.length - 1];
    if (previous && (region.oldStart <= previous.oldEnd || region.postStart <= previous.postEnd)) {
      previous.oldEnd = Math.max(previous.oldEnd, region.oldEnd);
      previous.postEnd = Math.max(previous.postEnd, region.postEnd);
      continue;
    }
    merged.push({...region});
  }

  return merged;
}

function lineIndexAtOffset(content: string, offset: number): number {
  let line = 0;
  for (let index = 0; index < Math.min(offset, content.length); index += 1) {
    if (content[index] === '\n') line += 1;
  }
  return line;
}

function splitContentLines(content: string): string[] {
  if (content === '') return [];
  const body = content.endsWith('\n') ? content.slice(0, -1) : content;
  return body === '' ? [] : body.split('\n');
}

export {createEditFileDisplayFile};
export type {ReplacementSpan};

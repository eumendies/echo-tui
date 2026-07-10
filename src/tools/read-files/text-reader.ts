import * as fs from 'node:fs';
import * as readline from 'node:readline';

import {capUtf8Text} from '../tool-handler-utils';

import type {Result} from '../tool-handler-utils';

type TextReadRequest = {
  limit?: number;
  offset: number;
};

type TextFileReadResult = {
  content: string;
  contentTruncated: boolean;
  hasMore: boolean;
  returnedLines: number;
  startLine?: number;
  endLine?: number;
  totalLines?: number;
};

/**
 * 流式读取 UTF-8 文本并按真实文件行分页，避免整文件加载到内存。
 */
async function readTextFile(request: TextReadRequest, absolutePath: string, maxContentBytes: number): Promise<Result<TextFileReadResult>> {
  const stream = fs.createReadStream(absolutePath, {encoding: 'utf8'});
  const reader = readline.createInterface({
    crlfDelay: Infinity,
    input: stream
  });
  const selectedLines: string[] = [];
  let contentBytes = 0;
  let contentTruncated = false;
  let hasMore = false;
  let lineIndex = 0;
  let returnedLines = 0;
  let readToEnd = true;

  try {
    for await (const line of reader) {
      const textCheck = validateTextLine(line);

      if (!textCheck.ok) {
        reader.close();
        stream.destroy();
        return textCheck;
      }

      if (lineIndex >= request.offset) {
        if (request.limit !== undefined && returnedLines >= request.limit) {
          hasMore = true;
          readToEnd = false;
          reader.close();
          stream.destroy();
          break;
        }

        const separatorBytes = selectedLines.length === 0 ? 0 : 1;
        const remainingBytes = maxContentBytes - contentBytes - separatorBytes;

        if (remainingBytes <= 0) {
          contentTruncated = true;
          hasMore = true;
          readToEnd = false;
          reader.close();
          stream.destroy();
          break;
        }

        const capped = capUtf8Text(line, remainingBytes);

        selectedLines.push(capped.text);
        contentBytes += separatorBytes + Buffer.byteLength(capped.text, 'utf8');
        returnedLines += 1;

        if (capped.truncated) {
          contentTruncated = true;
          hasMore = true;
          readToEnd = false;
          reader.close();
          stream.destroy();
          break;
        }
      }

      lineIndex += 1;
    }
  } catch (error: unknown) {
    const reason = error instanceof Error && error.message.trim() !== '' ? error.message : 'failed to read file';
    return {ok: false, reason};
  } finally {
    reader.close();
    stream.destroy();
  }

  return {
    ok: true,
    value: {
      content: selectedLines.join('\n'),
      contentTruncated,
      ...(returnedLines > 0 ? {
        endLine: request.offset + returnedLines,
        startLine: request.offset + 1
      } : {}),
      hasMore,
      returnedLines,
      totalLines: readToEnd ? lineIndex : undefined
    }
  };
}

function validateTextLine(line: string): Result<undefined> {
  if (line.includes('\0')) {
    return {ok: false, reason: 'binary content is not supported by this version'};
  }

  if (line.includes('\uFFFD')) {
    return {ok: false, reason: 'non UTF-8 text is not supported by this version'};
  }

  return {ok: true, value: undefined};
}

export {
  readTextFile
};

export type {
  TextFileReadResult
};

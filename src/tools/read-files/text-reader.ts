import * as fs from 'node:fs';
import {StringDecoder} from 'node:string_decoder';
import {finished} from 'node:stream/promises';

import {capUtf8Text} from '../tool-handler-utils';
import type {Result} from '../tool-handler-utils';

type TextReadRequest = {
  limit?: number; // 请求的逻辑行数，不属于预算截断。
  offset: number; // 从零开始跳过的源行数。
};

type TextFileReadResult = {
  content: string; // LF 归一化、不含展示前缀的选中源行。
  contentTruncated: boolean; // 字节预算是否造成内容缺失。
  hasMore: boolean; // 已知或可能仍有后续内容。
  returnedLines: number; // 实际返回的逻辑行数，包含可能的末尾部分行。
  startLine?: number; // 第一条返回行在源文件中的一基行号。
  endLine?: number; // 最后一条返回行在源文件中的一基行号。
  totalLines?: number; // 只有完整扫描到 EOF 才可知道的源文件行数。
  nextOffset: number | null; // 部分行截断时禁止提供会跳过残余内容的续读位置。
};

/**
 * 有界流式读取 UTF-8；逐块累积一条源行，避免 readline 对超长行无界物化。
 * CRLF、CR 与 LF 均归一化为 LF；取消时销毁真实文件流。
 */
async function readTextFile(request: TextReadRequest, absolutePath: string, maxContentBytes: number, abortSignal?: AbortSignal): Promise<Result<TextFileReadResult>> {
  if (abortSignal?.aborted) {
    return {
      ok: false,
      reason: 'Tool call cancelled'
    };
  }
  const stream = fs.createReadStream(absolutePath, {signal: abortSignal});
  const decoder = new StringDecoder('utf8');
  const selectedLines: string[] = [];
  let contentBytes = 0;
  let lineIndex = 0;
  let line = '';
  let lineBytes = 0;
  let lineStarted = false;
  let afterCR = false;
  let stopped = false;
  let partialLine = false;
  let contentTruncated = false;
  let hasMore = false;

  // limit 与完整行预算停止都保留安全边界；部分源行才必须取消 next_offset。
  function consumePart(part: string, delimiter: boolean): void {
    if (stopped) {
      return;
    }
    if (part.includes('\0')) {
      throw new Error('binary content is not supported by this version');
    }
    if (part.includes('\uFFFD')) {
      throw new Error('non UTF-8 text is not supported by this version');
    }
    const selected = lineIndex >= request.offset;
    if (selected && (part !== '' || delimiter)) {
      if (request.limit !== undefined && selectedLines.length >= request.limit) {
        stopped = true;
        hasMore = true;
        return;
      }
      const separatorBytes = selectedLines.length === 0 ? 0 : 1;
      const available = maxContentBytes - contentBytes - separatorBytes - lineBytes;
      const partBytes = Buffer.byteLength(part, 'utf8');
      if (partBytes > available || (delimiter && available < 0)) {
        const capped = capUtf8Text(part, Math.max(0, available));
        // 行边界已无预算时不制造一条空的部分行。
        if (lineStarted || capped.text !== '') {
          line += capped.text;
          selectedLines.push(line);
          partialLine = true;
        }
        contentTruncated = true;
        hasMore = true;
        stopped = true;
        return;
      }
      line += part;
      lineBytes += partBytes;
    }
    lineStarted ||= part !== '';
    if (delimiter) {
      if (selected) {
        contentBytes += (selectedLines.length === 0 ? 0 : 1) + lineBytes;
        selectedLines.push(line);
      }
      lineIndex += 1;
      line = '';
      lineBytes = 0;
      lineStarted = false;
    }
  }
  function consumeChunk(chunk: string): void {
    let start = 0;
    if (afterCR && chunk.startsWith('\n')) {
      start = 1;
    }
    if (chunk.length > 0) {
      afterCR = false;
    }
    for (let index = start; index < chunk.length && !stopped; index += 1) {
      const char = chunk[index];
      if (char !== '\n' && char !== '\r') {
        continue;
      }
      consumePart(chunk.slice(start, index), true);
      if (char === '\r') {
        if (chunk[index + 1] === '\n') {
          index += 1;
        } else if (index === chunk.length - 1) {
          afterCR = true;
        }
      }
      start = index + 1;
    }
    if (!stopped && start < chunk.length) {
      consumePart(chunk.slice(start), false);
    }
  }
  try {
    for await (const chunk of stream) {
      consumeChunk(decoder.write(chunk as Buffer));
      if (stopped) {
        break;
      }
    }
    if (abortSignal?.aborted) {
      return {
        ok: false,
        reason: 'Tool call cancelled'
      };
    }
    if (!stopped) {
      consumeChunk(decoder.end());
      if (!stopped && lineStarted) {
        consumePart('', true);
      }
    }
  } catch (error: unknown) {
    return {
      ok: false,
      reason: abortSignal?.aborted ? 'Tool call cancelled' : error instanceof Error ? error.message : 'failed to read file'
    };
  } finally {
    stream.destroy();
    // 等待文件描述符关闭，而不是仅请求销毁；调用结束后不遗留后台读取。
    await finished(stream, {cleanup: true}).catch(() => undefined);
  }
  const returnedLines = selectedLines.length;
  return {
    ok: true,
    value: {
      content: selectedLines.join('\n'),
      contentTruncated,
      hasMore,
      returnedLines,
      ...(returnedLines > 0 ? {
        startLine: request.offset + 1,
        endLine: request.offset + returnedLines
      } : {}),
      ...(!stopped ? {totalLines: lineIndex} : {}),
      nextOffset: hasMore && !partialLine ? request.offset + returnedLines : null
    }
  };
}

export {readTextFile};

export type {TextFileReadResult};

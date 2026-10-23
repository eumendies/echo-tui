import * as fs from 'node:fs';
import * as path from 'node:path';

import {readDirectory} from './directory-reader';
import {readImageFile} from './image-reader';
import {extractPdfText} from './pdf-reader';
import {readTextFile} from './text-reader';
import {capUtf8Text, isGitPath} from '../tool-handler-utils';

import type {ScriptFileError, ScriptTextFile, ScriptToolErrorCode} from '../code-mode/contracts';
import type {ToolResultAttachment} from '../../types/tool';
import type {ImageReadOptions} from './image-reader';
import type {Result} from '../tool-handler-utils';
import type {DirectoryEntry, DirectoryReadResult} from './directory-reader';
import type {TextFileReadResult} from './text-reader';

type ReadFilesLimits = {
  maxFiles: number; // 单次文件请求数上限。
  maxFileContentBytes: number; // 单文件内容字节预算。
  maxDirectoryEntries: number; // 原生目录项数量上限。
  maxPdfBytes: number; // 允许提取的 PDF 源文件上限。
  maxPdfOutputBytes: number; // PDF 文本输出上限。
  maxTotalImageBytes: number; // 图片附件总字节预算。
  maxTotalOutputBytes: number; // 原生文本总输出预算。
};

type NormalizedFileRequest = {
  path: string; // 保留请求的原始路径。
  offset: number; // 跳过的源行数。
  limit?: number; // 可选请求行数。
};

type FileReadResult = {
  attachments?: ToolResultAttachment[]; // 仅原生多媒体路径可产生的附件。
  ok: boolean; // 当前路径读取是否成功。
  pdfExtracted?: boolean; // 是否需要 PDF 专属输出预算。
  text: string; // 原生展示正文。
  truncated: boolean; // 内容或附件预算是否造成缺失。
};

type MediaInfo = {
  kind: string; // 用于类型分派的资源种类。
  mediaType: string; // 原生附件的媒体类型。
};

type ReadOneFileOptions = {
  cwd: string; // 作为相对路径解析基准的当前工作目录。
  imageOptions: ImageReadOptions; // 控制图片附件安全上限和超限压缩行为。
  limits: ReadFilesLimits; // 控制文本、目录、PDF 与总输出规模。
  abortSignal?: AbortSignal; // 取消时关闭底层文本流。
  remainingImageAttachmentBytes: number; // 当前请求按顺序可使用的剩余图片附件聚合预算。
};

async function readOneFile(request: NormalizedFileRequest, options: ReadOneFileOptions): Promise<FileReadResult> {
  const resolved = resolveFilePath(request.path, options.cwd);
  const media = guessMedia(request.path);

  if (!resolved.ok) {
    return {
      ok: false,
      text: formatFileEnvelope({
        body: [`error: ${resolved.reason}`],
        kind: media.kind,
        path: request.path
      }),
      truncated: false
    };
  }

  const absolutePath = resolved.value;

  try {
    const stat = fs.statSync(absolutePath);

    if (stat.isDirectory()) {
      return createDirectoryFileResult(request, absolutePath, options.limits.maxDirectoryEntries);
    }

    if (!stat.isFile()) {
      return createFileError(request.path, media.kind, 'path is not a regular file');
    }

    if (media.kind === 'image') {
      return await createImageFileResult(request, absolutePath, media, stat.size, options.imageOptions, options.remainingImageAttachmentBytes);
    }

    if (media.kind === 'pdf') {
      return await createPdfFileResult(request, absolutePath, stat.size, options.limits);
    }

    if (media.kind !== 'text') {
      return createUnsupportedFile(request.path, media.kind, stat.size, `${media.kind} reading is not supported by this version`);
    }

    const textCheck = await readTextFile(request, absolutePath, options.limits.maxFileContentBytes, options.abortSignal);

    if (!textCheck.ok) {
      return createUnsupportedFile(request.path, 'binary', stat.size, textCheck.reason);
    }

    return createTextFileResult(request, textCheck.value);
  } catch (error: unknown) {
    const message = error instanceof Error && error.message.trim() !== '' ? error.message : 'failed to read file';
    return createFileError(request.path, media.kind, message);
  }
}

/** 文本机器入口在类型分派前拒绝目录、媒体与特殊文件，不创建附件或枚举目录。 */
async function readOneTextFile(request: NormalizedFileRequest, options: {
  cwd: string;
  maxContentBytes: number;
  abortSignal?: AbortSignal
}): Promise<ScriptTextFile | ScriptFileError> {
  const fail = (code: ScriptToolErrorCode, message: string): ScriptFileError => ({
    path: request.path,
    ok: false,
    kind: 'error',
    error: {
      code,
      message: capUtf8Text(message, 1024).text
    }
  });
  if (options.abortSignal?.aborted) {
    return fail('cancelled', 'Tool call cancelled');
  }
  const resolved = resolveFilePath(request.path, options.cwd);
  if (!resolved.ok) {
    return fail('invalid_arguments', resolved.reason);
  }
  try {
    const stat = fs.statSync(resolved.value);
    if (!stat.isFile() || guessMedia(request.path).kind !== 'text' || /\.(svg|ico|tiff?|avif|heic|heif|psd|mp3|wav|ogg|flac|aac|m4a|mp4|m4v|mov|webm|avi|mkv|mpeg|mpg|woff2?|ttf|otf)$/i.test(request.path)) {
      return fail('unsupported_type', 'Only regular UTF-8 text files are supported');
    }
    const result = await readTextFile(request, resolved.value, options.maxContentBytes, options.abortSignal);
    if (!result.ok) {
      return fail(options.abortSignal?.aborted ? 'cancelled' : /UTF-8|binary/.test(result.reason) ? 'invalid_encoding' : 'read_failed', result.reason);
    }
    const text = result.value;
    return {
      path: request.path,
      ok: true,
      kind: 'text',
      content: text.content,
      offset: request.offset,
      returned_lines: text.returnedLines,
      start_line: text.startLine ?? null,
      end_line: text.endLine ?? null,
      has_more: text.hasMore,
      content_truncated: text.contentTruncated,
      next_offset: text.nextOffset,
      ...(text.totalLines === undefined ? {} : {total_lines: text.totalLines})
    };
  } catch (error: unknown) {
    return fail('read_failed', error instanceof Error ? error.message : 'failed to read file');
  }
}

/**
 * 返回目录的直接子项；排序和分页都在单层枚举后完成，不读取后代内容。
 */
function createDirectoryFileResult(request: NormalizedFileRequest, absolutePath: string, maxDirectoryEntries: number): FileReadResult {
  const result = readDirectory(request, absolutePath, maxDirectoryEntries);

  if (!result.ok) {
    return createFileError(request.path, 'directory', result.reason);
  }

  return createDirectorySuccessResult(request, result.value);
}

function formatDirectoryEntry(entry: DirectoryEntry): string {
  return [
    `- ${entry.path}`,
    entry.kind,
    ...(entry.sizeBytes === undefined ? [] : [`size_bytes: ${entry.sizeBytes}`])
  ].join('; ');
}

function createDirectorySuccessResult(request: NormalizedFileRequest, result: DirectoryReadResult): FileReadResult {
  return {
    ok: true,
    text: formatFileEnvelope({
      body: [
        'entries:',
        ...(result.entries.length === 0 ? ['(empty)'] : result.entries.map(formatDirectoryEntry)),
        ...(result.hasMore ? ['', 'has_more: true'] : [])
      ],
      kind: 'directory',
      path: request.path
    }),
    truncated: result.truncated
  };
}

async function createPdfFileResult(request: NormalizedFileRequest, absolutePath: string, sizeBytes: number, limits: ReadFilesLimits): Promise<FileReadResult> {
  if (sizeBytes > limits.maxPdfBytes) {
    return createFileError(request.path, 'pdf', `PDF exceeds max size: ${sizeBytes} bytes > ${limits.maxPdfBytes} bytes`);
  }

  const extracted = await extractPdfText(absolutePath, limits.maxFileContentBytes);

  if (!extracted.ok) {
    return createFileErrorWithMetadata(request.path, 'pdf', sizeBytes, extracted.reason);
  }

  return {
    ok: true,
    pdfExtracted: true,
    text: formatFileEnvelope({
      body: [
        `pages: ${extracted.value.pageCount}`,
        `pages_with_text: ${extracted.value.pagesWithText}`,
        ...(extracted.value.contentTruncated ? ['content_truncated: true'] : []),
        '',
        'extracted_text:',
        '```',
        extracted.value.content,
        '```'
      ],
      kind: 'pdf',
      path: request.path
    }),
    truncated: extracted.value.contentTruncated
  };
}

async function createImageFileResult(request: NormalizedFileRequest, absolutePath: string, media: MediaInfo, sizeBytes: number, imageOptions: ImageReadOptions, remainingImageAttachmentBytes: number): Promise<FileReadResult> {
  if (remainingImageAttachmentBytes <= 0) {
    return createSkippedImageResult(request.path, sizeBytes);
  }

  const aggregateLimited = remainingImageAttachmentBytes < imageOptions.maxImageBytes;
  const result = await readImageFile(request.path, absolutePath, media.mediaType, sizeBytes, {
    ...imageOptions,
    maxImageBytes: Math.min(imageOptions.maxImageBytes, remainingImageAttachmentBytes)
  });

  if (!result.ok) {
    if (result.unsupported) {
      return createUnsupportedFile(request.path, media.kind, sizeBytes, result.reason);
    }

    if (aggregateLimited) {
      // 剩余聚合预算迫使单图上限缩小后读取失败：保留真实失败原因，
      // 避免把解码/压缩错误误报成单纯的预算跳过，模型才能决定是分批读还是换图。
      return createSkippedImageResult(request.path, sizeBytes, result.reason);
    }

    return createFileError(request.path, media.kind, result.reason);
  }

  return {
    attachments: [result.attachment],
    ok: true,
    text: formatFileEnvelope({
      body: [
        ...(result.compressed ? [`original_size_bytes: ${result.originalSizeBytes}`] : []),
        `size_bytes: ${result.attachment.sizeBytes}`,
        ...(result.compressed ? ['image_compressed: true'] : []),
        'image_attached: true'
      ],
      kind: 'image',
      path: request.path
    }),
    truncated: false
  };
}

function createSkippedImageResult(pathText: string, sizeBytes: number, reason?: string): FileReadResult {
  return {
    ok: true,
    text: formatFileEnvelope({
      body: [
        `size_bytes: ${sizeBytes}`,
        'image_attached: false',
        reason
          ? `image_skipped: total attachment byte limit reached (image read failed: ${reason})`
          : 'image_skipped: total attachment byte limit reached',
        'Read images in smaller batches to attach this image.'
      ],
      kind: 'image',
      path: pathText
    }),
    truncated: true
  };
}

function createTextFileResult(request: NormalizedFileRequest, content: TextFileReadResult): FileReadResult {
  const numberedContent = formatNumberedContent(content);

  return {
    ok: true,
    text: formatFileEnvelope({
      body: [
        ...(content.hasMore ? ['has_more: true'] : []),
        ...(content.contentTruncated ? ['content_truncated: true'] : []),
        ...(content.hasMore && content.nextOffset !== null ? [`next_offset: ${content.nextOffset}`, 'Use offset/limit to continue reading this file.'] : []),
        '',
        'content:',
        '```',
        ...(numberedContent === '' ? [] : [numberedContent]),
        '```'
      ],
      kind: 'text',
      path: request.path
    }),
    truncated: content.contentTruncated
  };
}

function createUnsupportedFile(pathText: string, kind: string, sizeBytes: number, reason: string): FileReadResult {
  return {
    ok: false,
    text: formatFileEnvelope({
      body: [
        `size_bytes: ${sizeBytes}`,
        `error: unsupported media type`,
        `reason: ${reason}`
      ],
      kind,
      path: pathText
    }),
    truncated: false
  };
}

function createFileError(pathText: string, kind: string, reason: string): FileReadResult {
  return {
    ok: false,
    text: formatFileEnvelope({
      body: [`error: ${reason}`],
      kind,
      path: pathText
    }),
    truncated: false
  };
}

function createFileErrorWithMetadata(pathText: string, kind: string, sizeBytes: number, reason: string): FileReadResult {
  return {
    ok: false,
    text: formatFileEnvelope({
      body: [
        `size_bytes: ${sizeBytes}`,
        `error: ${reason}`
      ],
      kind,
      path: pathText
    }),
    truncated: false
  };
}

function formatFileEnvelope(options: {path: string; kind: string; body: string[]}): string {
  return [
    `--- ${options.kind}: ${options.path}`,
    ...options.body
  ].join('\n');
}

function formatReadFilesFailure(reason: string): string {
  return [
    'read_files failed.',
    `Reason: ${reason}`
  ].join('\n');
}

function formatNumberedContent(content: TextFileReadResult): string {
  if (content.startLine === undefined) {
    return '';
  }

  const startLine = content.startLine;
  return content.content.split('\n').map((line, index) => `${startLine + index} │ ${line}`).join('\n');
}

function resolveFilePath(filePath: string, cwd: string): Result<string> {
  if (filePath.includes('\0')) {
    return {ok: false, reason: 'path must not contain NUL'};
  }

  const absolutePath = path.resolve(cwd, filePath);

  if (isGitPath(absolutePath)) {
    return {ok: false, reason: '.git paths are not allowed'};
  }

  return {ok: true, value: absolutePath};
}

function guessMedia(filePath: string): MediaInfo {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case '.bmp':
      return {kind: 'image', mediaType: 'image/bmp'};
    case '.gif':
      return {kind: 'image', mediaType: 'image/gif'};
    case '.jpg':
    case '.jpeg':
      return {kind: 'image', mediaType: 'image/jpeg'};
    case '.pdf':
      return {kind: 'pdf', mediaType: 'application/pdf'};
    case '.png':
      return {kind: 'image', mediaType: 'image/png'};
    case '.webp':
      return {kind: 'image', mediaType: 'image/webp'};
    case '.json':
      return {kind: 'text', mediaType: 'application/json'};
    case '.md':
      return {kind: 'text', mediaType: 'text/markdown'};
    case '.ts':
      return {kind: 'text', mediaType: 'text/typescript'};
    case '.tsx':
      return {kind: 'text', mediaType: 'text/tsx'};
    case '.js':
      return {kind: 'text', mediaType: 'text/javascript'};
    default:
      return {kind: 'text', mediaType: 'text/plain'};
  }
}

export {
  formatReadFilesFailure,
  readOneFile,
  readOneTextFile
};

export type {
  FileReadResult,
  NormalizedFileRequest,
  ReadOneFileOptions,
  ReadFilesLimits
};

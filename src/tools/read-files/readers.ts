import * as fs from 'node:fs';
import * as path from 'node:path';

import {readDirectory} from './directory-reader';
import {readImageFile} from './image-reader';
import {extractPdfText} from './pdf-reader';
import {readTextFile} from './text-reader';
import {isGitPath} from '../tool-handler-utils';

import type {ToolResultAttachment} from '../../types/tool';
import type {ImageReadOptions} from './image-reader';
import type {Result} from '../tool-handler-utils';
import type {DirectoryEntry, DirectoryReadResult} from './directory-reader';
import type {TextFileReadResult} from './text-reader';

type ReadFilesLimits = {
  maxFiles: number;
  maxFileContentBytes: number;
  maxDirectoryEntries: number;
  maxPdfBytes: number;
  maxPdfOutputBytes: number;
  maxTotalOutputBytes: number;
};

type NormalizedFileRequest = {
  path: string;
  offset: number;
  limit?: number;
};

type FileReadResult = {
  attachments?: ToolResultAttachment[];
  ok: boolean;
  pdfExtracted?: boolean;
  text: string;
  truncated: boolean;
};

type MediaInfo = {
  kind: string;
  mediaType: string;
};

type ReadOneFileOptions = {
  cwd: string; // 作为相对路径解析基准的当前工作目录。
  imageOptions: ImageReadOptions; // 控制图片附件安全上限和超限压缩行为。
  limits: ReadFilesLimits; // 控制文本、目录、PDF 与总输出规模。
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
      return await createImageFileResult(request, absolutePath, media, stat.size, options.imageOptions);
    }

    if (media.kind === 'pdf') {
      return await createPdfFileResult(request, absolutePath, stat.size, options.limits);
    }

    if (media.kind !== 'text') {
      return createUnsupportedFile(request.path, media.kind, stat.size, `${media.kind} reading is not supported by this version`);
    }

    const textCheck = await readTextFile(request, absolutePath, options.limits.maxFileContentBytes);

    if (!textCheck.ok) {
      return createUnsupportedFile(request.path, 'binary', stat.size, textCheck.reason);
    }

    return createTextFileResult(request, textCheck.value);
  } catch (error: unknown) {
    const message = error instanceof Error && error.message.trim() !== '' ? error.message : 'failed to read file';
    return createFileError(request.path, media.kind, message);
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

async function createImageFileResult(request: NormalizedFileRequest, absolutePath: string, media: MediaInfo, sizeBytes: number, imageOptions: ImageReadOptions): Promise<FileReadResult> {
  const result = await readImageFile(request.path, absolutePath, media.mediaType, sizeBytes, imageOptions);

  if (!result.ok) {
    return result.unsupported
      ? createUnsupportedFile(request.path, media.kind, sizeBytes, result.reason)
      : createFileError(request.path, media.kind, result.reason);
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

function createTextFileResult(request: NormalizedFileRequest, content: TextFileReadResult): FileReadResult {
  const numberedContent = formatNumberedContent(content);

  return {
    ok: true,
    text: formatFileEnvelope({
      body: [
        ...(content.hasMore ? ['has_more: true'] : []),
        ...(content.contentTruncated ? ['content_truncated: true'] : []),
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
  readOneFile
};

export type {
  FileReadResult,
  NormalizedFileRequest,
  ReadOneFileOptions,
  ReadFilesLimits
};

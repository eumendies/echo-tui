import {formatReadFilesFailure, readOneFile} from './readers';
import {capUtf8Text, normalizePositiveInteger, resolveCwd} from '../tool-handler-utils';
import {createOffloadedTextPreview} from '../tool-result-offloading';
import {DEFAULT_APP_SETTINGS} from '../../config/app-settings-config';

import type {ReadFilesToolExecutionResult, ToolCall, ToolHandler, ToolResultAttachment} from '../../types/tool';
import type {Result} from '../tool-handler-utils';
import type {ToolResultStore} from '../tool-result-offloading';
import type {FileReadResult, NormalizedFileRequest, ReadFilesLimits} from './readers';
import type {ImageReadOptions} from './image-reader';

const READ_FILES_TOOL_NAME = 'read_files';
const DEFAULT_MAX_FILES = 10;
const DEFAULT_MAX_FILE_CONTENT_BYTES = 1_000_000;
const DEFAULT_MAX_DIRECTORY_ENTRIES = 200;
const DEFAULT_MAX_IMAGE_BYTES = 5_000_000;
const DEFAULT_MAX_SOURCE_IMAGE_BYTES = 50_000_000;
const DEFAULT_MAX_IMAGE_PIXELS = 80_000_000;
const DEFAULT_MAX_PDF_BYTES = 10_000_000;
const DEFAULT_MAX_PDF_OUTPUT_BYTES = 65_536;
const DEFAULT_MAX_TOTAL_OUTPUT_BYTES = 256_000;

type ReadFilesToolHandlerOptions = {
  autoCompressImages?: boolean; // 覆盖超限图片是否自动缩小，缺失时默认开启。
  cwd?: string | (() => string); // 提供工具调用时解析相对路径的工作目录。
  maxFiles?: number; // 限制单次调用允许读取的文件项数量。
  maxFileContentBytes?: number; // 限制单个文本文件本次返回的内容字节数。
  maxDirectoryEntries?: number; // 限制目录读取返回的直接子项数量。
  maxImageBytes?: number; // 限制最终图片附件的二进制字节数。
  maxImagePixels?: number; // 限制图片解码后的所有帧总像素数。
  maxSourceImageBytes?: number; // 限制进入图片解码器的源文件字节数。
  maxPdfBytes?: number; // 限制允许解析的单个 PDF 源文件字节数。
  maxPdfOutputBytes?: number; // 限制 PDF 提取文本直接返回给模型的字节数。
  maxTotalOutputBytes?: number; // 限制单次 read_files 文本结果总字节数。
  toolResultStore?: ToolResultStore; // 保存被 offload 的完整 PDF 工具结果。
};

/**
 * 创建本地路径读取工具；返回目录直接子项、UTF-8 文本、图片附件或 PDF 提取文本。
 */
function createReadFilesToolHandler(options: ReadFilesToolHandlerOptions = {}): ToolHandler {
  const limits = normalizeLimits(options);
  const imageOptions = normalizeImageOptions(options);

  return {
    definition: {
      name: READ_FILES_TOOL_NAME,
      description: 'Read local files or list the direct children of known directories by path. Directory reads are non-recursive, return entry paths/types and regular-file sizes, and use offset/limit for entry pagination. Text files are returned with line numbers and use offset/limit for line pagination; supported images (PNG, JPEG, GIF, WebP) are attached as model-visible inputs with metadata and oversized images are automatically reduced when enabled; PDFs are returned as extracted text only. Offset/limit are ignored for images and PDFs. Use glob to discover files by path pattern and grep to search text content. PDF reading does not do OCR, page rendering, or PDF/document attachment passing. Unsupported media returns metadata without binary content. Relative paths resolve from the current working directory; absolute paths and .. paths are supported.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['files'],
        properties: {
          files: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['path'],
              properties: {
                path: {
                  type: 'string'
                },
                offset: {
                  type: 'number'
                },
                limit: {
                  type: 'number'
                }
              }
            }
          }
        }
      }
    },
    async execute(args: Record<string, unknown>, call: ToolCall): Promise<ReadFilesToolExecutionResult> {
      const result = await readFiles(args, {
        cwd: resolveCwd(options.cwd),
        imageOptions,
        limits,
        toolResultStore: options.toolResultStore
      });

      return {
        callId: call.callId,
        toolName: READ_FILES_TOOL_NAME,
        ok: result.ok,
        text: result.text,
        ...(result.attachments ? {attachments: result.attachments} : {}),
        details: {kind: 'read_files', truncated: result.truncated}
      };
    }
  };
}

/**
 * 校验输入并按顺序读取文件；批量中单个失败不会隐藏其他成功结果。
 */
async function readFiles(args: Record<string, unknown>, options: {cwd: string; imageOptions: ImageReadOptions; limits: ReadFilesLimits; toolResultStore?: ToolResultStore}): Promise<{attachments?: ToolResultAttachment[]; ok: boolean; text: string; truncated: boolean}> {
  const normalized = normalizeRequests(args.files, options.limits);

  if (!normalized.ok) {
    return {
      ok: false,
      text: formatReadFilesFailure(normalized.reason),
      truncated: false
    };
  }

  const fileResults: FileReadResult[] = [];

  for (const request of normalized.value) {
    fileResults.push(await readOneFile(request, options));
  }

  const ok = fileResults.every((result) => result.ok);
  const attachments = fileResults.flatMap((result) => result.attachments || []);
  const formatted = fileResults.map((result) => result.text).join('\n\n');

  if (fileResults.some((result) => result.pdfExtracted)) {
    const preview = createOffloadedTextPreview({
      maxPreviewBytes: Math.min(options.limits.maxPdfOutputBytes, options.limits.maxTotalOutputBytes),
      strategy: 'head',
      store: options.toolResultStore,
      text: formatted
    });

    return {
      ...(attachments.length > 0 ? {attachments} : {}),
      ok,
      text: preview.offloadFilePath || !preview.truncated ? preview.text : `${preview.text}\n\nOutput was truncated.`,
      truncated: preview.truncated || fileResults.some((result) => result.truncated)
    };
  }

  const capped = capUtf8Text(formatted, options.limits.maxTotalOutputBytes);

  return {
    ...(attachments.length > 0 ? {attachments} : {}),
    ok,
    text: capped.truncated ? `${capped.text}\n\nOutput was truncated.` : capped.text,
    truncated: capped.truncated || fileResults.some((result) => result.truncated)
  };
}

function normalizeRequests(files: unknown, limits: ReadFilesLimits): Result<NormalizedFileRequest[]> {
  if (!Array.isArray(files)) {
    return {ok: false, reason: 'files must be an array'};
  }

  if (files.length === 0) {
    return {ok: false, reason: 'files must not be empty'};
  }

  if (files.length > limits.maxFiles) {
    return {ok: false, reason: `files exceeds ${limits.maxFiles} entries`};
  }

  const requests: NormalizedFileRequest[] = [];

  for (const [index, file] of files.entries()) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      return {ok: false, reason: `files[${index}] must be an object`};
    }

    const candidate = file as Record<string, unknown>;
    const filePath = candidate.path;

    if (typeof filePath !== 'string' || filePath.trim() === '') {
      return {ok: false, reason: `files[${index}].path must be a non-empty string`};
    }

    const offset = normalizeNonNegativeInteger(candidate.offset, 0, `files[${index}].offset`);

    if (!offset.ok) {
      return offset;
    }

    const limit = normalizeOptionalPositiveInteger(candidate.limit, `files[${index}].limit`);

    if (!limit.ok) {
      return limit;
    }

    requests.push({
      path: filePath,
      offset: offset.value,
      ...(limit.value === undefined ? {} : {limit: limit.value})
    });
  }

  return {ok: true, value: requests};
}

function normalizeNonNegativeInteger(value: unknown, fallback: number, fieldName: string): Result<number> {
  if (value === undefined || value === null) {
    return {ok: true, value: fallback};
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return {ok: false, reason: `${fieldName} must be a non-negative integer`};
  }

  return {ok: true, value};
}

function normalizeOptionalPositiveInteger(value: unknown, fieldName: string): Result<number | undefined> {
  if (value === undefined || value === null) {
    return {ok: true, value: undefined};
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return {ok: false, reason: `${fieldName} must be a positive integer`};
  }

  return {ok: true, value};
}

function normalizeLimits(options: ReadFilesToolHandlerOptions): ReadFilesLimits {
  return {
    maxFiles: normalizePositiveInteger(options.maxFiles, DEFAULT_MAX_FILES),
    maxFileContentBytes: normalizePositiveInteger(options.maxFileContentBytes, DEFAULT_MAX_FILE_CONTENT_BYTES),
    maxDirectoryEntries: normalizePositiveInteger(options.maxDirectoryEntries, DEFAULT_MAX_DIRECTORY_ENTRIES),
    maxPdfBytes: normalizePositiveInteger(options.maxPdfBytes, DEFAULT_MAX_PDF_BYTES),
    maxPdfOutputBytes: normalizePositiveInteger(options.maxPdfOutputBytes, DEFAULT_MAX_PDF_OUTPUT_BYTES),
    maxTotalOutputBytes: normalizePositiveInteger(options.maxTotalOutputBytes, DEFAULT_MAX_TOTAL_OUTPUT_BYTES)
  };
}

function normalizeImageOptions(options: ReadFilesToolHandlerOptions): ImageReadOptions {
  return {
    autoCompressImages: typeof options.autoCompressImages === 'boolean'
      ? options.autoCompressImages
      : DEFAULT_APP_SETTINGS.autoCompressImages,
    maxImageBytes: normalizePositiveInteger(options.maxImageBytes, DEFAULT_MAX_IMAGE_BYTES),
    maxInputPixels: normalizePositiveInteger(options.maxImagePixels, DEFAULT_MAX_IMAGE_PIXELS),
    maxSourceImageBytes: normalizePositiveInteger(options.maxSourceImageBytes, DEFAULT_MAX_SOURCE_IMAGE_BYTES)
  };
}

export {
  DEFAULT_MAX_DIRECTORY_ENTRIES,
  DEFAULT_MAX_FILE_CONTENT_BYTES,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_IMAGE_PIXELS,
  DEFAULT_MAX_SOURCE_IMAGE_BYTES,
  DEFAULT_MAX_PDF_BYTES,
  DEFAULT_MAX_PDF_OUTPUT_BYTES,
  DEFAULT_MAX_TOTAL_OUTPUT_BYTES,
  READ_FILES_TOOL_NAME,
  createReadFilesToolHandler
};

export type {
  ReadFilesToolHandlerOptions
};

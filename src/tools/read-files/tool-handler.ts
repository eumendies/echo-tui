import {formatReadFilesFailure, readOneFile, readOneTextFile} from './readers';
import {SCRIPT_TOOL_MAX_RESPONSE_BYTES, checkedScriptEnvelope, scriptFailure, validateScriptInput} from '../code-mode/contracts';
import type {ScriptFileError, ScriptTextFile, ScriptToolEnvelope} from '../code-mode/contracts';

import {DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES, capUtf8Text, normalizePositiveInteger, resolveCwd} from '../tool-handler-utils';
import {createOffloadedTextPreview} from '../tool-result-offloading';
import {DEFAULT_APP_SETTINGS} from '../../config/app-settings-config';

import type {ReadFilesToolExecutionResult, ToolCall, ToolExecutionOptions, ToolHandler, ToolResultAttachment} from '../../types/tool';
import type {Result} from '../tool-handler-utils';
import type {ToolResultStore} from '../tool-result-offloading';
import type {FileReadResult, NormalizedFileRequest, ReadFilesLimits} from './readers';
import type {ImageReadOptions} from './image-reader';

const READ_FILES_TOOL_NAME = 'read_files';
const DEFAULT_MAX_FILES = 10;
const DEFAULT_MAX_FILE_CONTENT_BYTES = 1_000_000;
const DEFAULT_MAX_DIRECTORY_ENTRIES = 200;
const DEFAULT_MAX_IMAGE_BYTES = 3_000_000;
const DEFAULT_MAX_TOTAL_IMAGE_BYTES = 6_000_000;
const DEFAULT_MAX_SOURCE_IMAGE_BYTES = 50_000_000;
const DEFAULT_MAX_IMAGE_PIXELS = 80_000_000;
const DEFAULT_MAX_PDF_BYTES = 10_000_000;
const DEFAULT_MAX_PDF_OUTPUT_BYTES = 65_536;
const DEFAULT_MAX_TOTAL_OUTPUT_BYTES = DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES;

type ReadFilesToolHandlerOptions = {
  autoCompressImages?: boolean; // 覆盖超限图片是否自动缩小，缺失时默认开启。
  cwd?: string | (() => string); // 提供工具调用时解析相对路径的工作目录。
  maxFiles?: number; // 限制单次调用允许读取的文件项数量。
  maxFileContentBytes?: number; // 限制单个文本文件本次返回的内容字节数。
  maxDirectoryEntries?: number; // 限制目录读取返回的直接子项数量。
  maxImageBytes?: number; // 限制最终图片附件的二进制字节数。
  maxTotalImageBytes?: number; // 限制单次调用所有图片附件的二进制字节总和。
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
      description: 'Read local files or list the direct children of known directories by path. Directory reads are non-recursive, return entry paths/types and regular-file sizes, and use offset/limit for entry pagination. Text files are returned with line numbers and use offset/limit for line pagination; supported images (PNG, JPEG, GIF, WebP) are attached as model-visible inputs with metadata and oversized images are automatically reduced when enabled; PDFs are returned as extracted text only. Text results and aggregate image attachments are bounded, so split large batches and use offset/limit to continue. Offset/limit are ignored for images and PDFs. Use glob to discover files by path pattern and grep to search text content. PDF reading does not do OCR, page rendering, or PDF/document attachment passing. Unsupported media returns metadata without binary content. Relative paths resolve from the current working directory; absolute paths and .. paths are supported.',
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
    async execute(args: Record<string, unknown>, call: ToolCall, executionOptions?: ToolExecutionOptions): Promise<ReadFilesToolExecutionResult> {
      const result = await readFiles(args, {
        cwd: resolveCwd(options.cwd),
        imageOptions,
        limits,
        abortSignal: executionOptions?.abortSignal,
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
    },
    async executeScript(args, _call, executionOptions): Promise<ScriptToolEnvelope> {
      const abortSignal = executionOptions?.abortSignal;
      if (abortSignal?.aborted) {
        return scriptFailure('cancelled', 'Tool call cancelled');
      }
      const input = validateScriptInput('read_files', args);
      if (!input.ok) {
        return scriptFailure('invalid_arguments', input.reason);
      }
      const normalized = normalizeRequests(input.value.files, limits);
      if (!normalized.ok) {
        return scriptFailure('invalid_arguments', normalized.reason);
      }
      const cwd = resolveCwd(options.cwd);
      const files: Array<ScriptTextFile | ScriptFileError> = [];
      let remainingContentBytes = Math.min(limits.maxTotalOutputBytes, SCRIPT_TOOL_MAX_RESPONSE_BYTES);
      for (const request of normalized.value) {
        const file = await readOneTextFile(request, {
          cwd,
          abortSignal,
          maxContentBytes: Math.min(limits.maxFileContentBytes, remainingContentBytes)
        });
        if (abortSignal?.aborted) {
          return scriptFailure('cancelled', 'Tool call cancelled');
        }
        files.push(file);
        if (file.ok) {
          remainingContentBytes -= Buffer.byteLength(file.content, 'utf8');
        }
      }
      return projectScriptFiles(files);
    }
  };
}

/**
 * 校验输入并按顺序读取文件；批量中单个失败不会隐藏其他成功结果。
 */
async function readFiles(args: Record<string, unknown>, options: {
  cwd: string;
  imageOptions: ImageReadOptions;
  limits: ReadFilesLimits;
  abortSignal?: AbortSignal;
  toolResultStore?: ToolResultStore
}): Promise<{
  attachments?: ToolResultAttachment[];
  ok: boolean;
  text: string;
  truncated: boolean
}> {
  const normalized = normalizeRequests(args.files, options.limits);

  if (!normalized.ok) {
    const capped = capUtf8Text(formatReadFilesFailure(normalized.reason), options.limits.maxTotalOutputBytes);

    return {
      ok: false,
      text: capped.text,
      truncated: capped.truncated
    };
  }

  const fileResults: FileReadResult[] = [];
  let imageAttachmentBytes = 0;

  for (const request of normalized.value) {
    if (options.abortSignal?.aborted) {
      break;
    }
    const result = await readOneFile(request, {
      ...options,
      remainingImageAttachmentBytes: Math.max(0, options.limits.maxTotalImageBytes - imageAttachmentBytes)
    });
    fileResults.push(result);
    imageAttachmentBytes += (result.attachments || []).reduce((sum, attachment) => sum + attachment.sizeBytes, 0);
  }

  const ok = !options.abortSignal?.aborted && fileResults.every((result) => result.ok);
  const attachments = fileResults.flatMap((result) => result.attachments || []);
  const formatted = options.abortSignal?.aborted ? formatReadFilesFailure('Tool call cancelled') : fileResults.map((result) => result.text).join('\n\n');

  const maxOutputBytes = fileResults.some((result) => result.pdfExtracted)
    ? Math.min(options.limits.maxPdfOutputBytes, options.limits.maxTotalOutputBytes)
    : options.limits.maxTotalOutputBytes;
  const preview = createOffloadedTextPreview({
    maxPreviewBytes: maxOutputBytes,
    strategy: 'head',
    store: options.toolResultStore,
    text: formatted,
    truncationMessage: 'Output was truncated. Read fewer files per call and use offset/limit to continue text or directory reads.'
  });

  return {
    ...(attachments.length > 0 ? {attachments} : {}),
    ok,
    text: preview.text,
    truncated: preview.truncated || fileResults.some((result) => result.truncated)
  };
}

/** JSON 转义与 envelope 元数据也计入预算；按完整源行裁减，不制造跳行游标。 */
function projectScriptFiles(files: Array<ScriptTextFile | ScriptFileError>): ScriptToolEnvelope {
  const ok = files.every((file) => file.ok);
  const envelope: ScriptToolEnvelope = {
    schema_version: 1,
    ok,
    data: {files},
    error: ok ? null : {
      code: 'partial_failure',
      message: 'One or more files failed'
    },
    truncated: files.some((file) => file.ok && file.content_truncated)
  };
  const size = () => Buffer.byteLength(JSON.stringify(envelope), 'utf8');
  for (let index = files.length - 1; size() > SCRIPT_TOOL_MAX_RESPONSE_BYTES && index >= 0; index -= 1) {
    const file = files[index];
    if (!file.ok || file.returned_lines === 0) {
      continue;
    }
    const lines = file.content.split('\n');
    // 零行投影为安全的原 offset；保留的最后一行均完整，故可继续按行读取。
    const project = (count: number): ScriptTextFile => ({
      ...file,
      content: lines.slice(0, count).join('\n'),
      returned_lines: count,
      start_line: count > 0 ? file.offset + 1 : null,
      end_line: count > 0 ? file.offset + count : null,
      has_more: true,
      content_truncated: true,
      next_offset: file.offset + count
    });
    envelope.truncated = true;
    let low = 0;
    // 至少移除一行，避免把原来不完整的末行当作完整行保留。
    let high = file.returned_lines - 1;
    files[index] = project(0);
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      files[index] = project(mid);
      if (size() <= SCRIPT_TOOL_MAX_RESPONSE_BYTES) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    files[index] = project(low);
  }
  if (size() > SCRIPT_TOOL_MAX_RESPONSE_BYTES) {
    return scriptFailure('result_limit_exceeded', 'File result metadata exceeds the JSON envelope budget', true);
  }
  return checkedScriptEnvelope('read_files', envelope);
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

  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return {ok: false, reason: `${fieldName} must be a non-negative integer`};
  }

  return {ok: true, value};
}

function normalizeOptionalPositiveInteger(value: unknown, fieldName: string): Result<number | undefined> {
  if (value === undefined || value === null) {
    return {ok: true, value: undefined};
  }

  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
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
    maxTotalImageBytes: normalizePositiveInteger(options.maxTotalImageBytes, DEFAULT_MAX_TOTAL_IMAGE_BYTES),
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
  DEFAULT_MAX_TOTAL_IMAGE_BYTES,
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

import fs from 'node:fs';
import * as path from 'node:path';

import {isGitPath, resolveCwd} from '../tool-handler-utils';
import {createEditFileDisplayFile} from './display';

import type {EditFileToolExecutionResult, ToolCall, ToolExecutionOptions, ToolHandler} from '../../types/tool';
import type {ReplacementSpan} from './display';

const EDIT_FILE_TOOL_NAME = 'edit_file';
const DEFAULT_MAX_FILE_BYTES = 1_000_000;

type EditFileToolHandlerOptions = {
  cwd?: string | (() => string);
  maxFileBytes?: number;
};

type EditFileArguments = {
  path: string;
  oldString: string;
  newString: string;
  replaceAll: boolean;
};

type EditFileSimulation = {
  content: string;
  replacementCount: number;
  spans: ReplacementSpan[];
};

/**
 * 为 edit_file 调用生成有界路径摘要，避免 old/new 文本进入 pending 或审批界面。
 */
function createEditFileCallLabel(argumentsText: unknown): string {
  if (typeof argumentsText !== 'string') return EDIT_FILE_TOOL_NAME;
  try {
    const parsed = JSON.parse(argumentsText) as {path?: unknown; replace_all?: unknown};
    if (typeof parsed.path !== 'string' || parsed.path.trim() === '') return EDIT_FILE_TOOL_NAME;
    return `${EDIT_FILE_TOOL_NAME}(${parsed.path}${parsed.replace_all === true ? ', replace all' : ''})`;
  } catch {
    return EDIT_FILE_TOOL_NAME;
  }
}

/**
 * 创建精确字符串替换工具；所有匹配和 post-image 校验完成后才写入已有文本文件。
 */
function createEditFileToolHandler(options: EditFileToolHandlerOptions = {}): ToolHandler {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  return {
    definition: {
      name: EDIT_FILE_TOOL_NAME,
      description: 'Edit one existing UTF-8 text file by replacing an exact old_string with new_string. Relative paths resolve from the current working directory; absolute paths and .. paths are supported. By default old_string must match exactly once; set replace_all to replace every non-overlapping match. This tool does not create or delete files.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'old_string', 'new_string'],
        properties: {
          path: {type: 'string', description: 'Path of the existing UTF-8 text file to edit.'},
          old_string: {type: 'string', description: 'Exact text to replace. Include enough surrounding context for a unique match unless replace_all is true.'},
          new_string: {type: 'string', description: 'Replacement text. May be empty to remove the matched text.'},
          replace_all: {type: 'boolean', description: 'Replace every non-overlapping match in the original file. Defaults to false.'}
        }
      }
    },
    execute(args: Record<string, unknown>, call: ToolCall, executionOptions?: ToolExecutionOptions): EditFileToolExecutionResult {
      const parsed = parseArguments(args);
      if (!parsed.ok) return createFailure(call, parsed.reason, parsed.hint);

      const resolved = resolveEditPath(resolveCwd(options.cwd), parsed.value.path);
      if (!resolved.ok) return createFailure(call, resolved.reason);

      const loaded = readTargetFile(parsed.value.path, resolved.value, maxFileBytes);
      if (!loaded.ok) return createFailure(call, loaded.reason);

      const simulated = simulateEdit(loaded.value, parsed.value);
      if (!simulated.ok) return createFailure(call, simulated.reason, simulated.hint);

      const display: NonNullable<EditFileToolExecutionResult['details']['display']> = {
        kind: EDIT_FILE_TOOL_NAME,
        files: [createEditFileDisplayFile(parsed.value.path, loaded.value, simulated.value.content, simulated.value.spans)]
      };

      try {
        executionOptions?.changeRecorder?.captureFileBefore(resolved.value);
        fs.writeFileSync(resolved.value, simulated.value.content, 'utf8');
        executionOptions?.changeRecorder?.captureFileAfter(resolved.value);
      } catch (error: unknown) {
        return createFailure(call, error instanceof Error && error.message.trim() ? error.message : 'failed to write target file');
      }

      return {
        callId: call.callId,
        toolName: EDIT_FILE_TOOL_NAME,
        ok: true,
        text: `Replaced ${simulated.value.replacementCount} ${simulated.value.replacementCount === 1 ? 'occurrence' : 'occurrences'} in ${parsed.value.path}.`,
        details: {kind: EDIT_FILE_TOOL_NAME, display}
      };
    }
  };
}

function parseArguments(args: Record<string, unknown>): {ok: true; value: EditFileArguments} | {ok: false; reason: string; hint?: string} {
  if (typeof args.path !== 'string' || args.path.trim() === '') return {ok: false, reason: 'path must be a non-empty string'};
  if (typeof args.old_string !== 'string') return {ok: false, reason: 'old_string must be a string'};
  if (typeof args.new_string !== 'string') return {ok: false, reason: 'new_string must be a string'};
  if (args.replace_all !== undefined && typeof args.replace_all !== 'boolean') return {ok: false, reason: 'replace_all must be a boolean'};
  if (args.old_string === '') return {ok: false, reason: 'old_string must be non-empty'};
  if (args.old_string === args.new_string) return {ok: false, reason: 'old_string and new_string must be different'};
  return {
    ok: true,
    value: {path: args.path, oldString: args.old_string, newString: args.new_string, replaceAll: args.replace_all === true}
  };
}

function resolveEditPath(cwd: string, filePath: string): {ok: true; value: string} | {ok: false; reason: string} {
  if (filePath.includes('\0')) return {ok: false, reason: 'path must not contain NUL'};
  const absolutePath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(cwd, filePath);
  return isGitPath(absolutePath)
    ? {ok: false, reason: `.git paths are not allowed: ${filePath}`}
    : {ok: true, value: absolutePath};
}

function readTargetFile(filePath: string, absolutePath: string, maxFileBytes: number): {ok: true; value: string} | {ok: false; reason: string} {
  if (!fs.existsSync(absolutePath)) return {ok: false, reason: `target file does not exist: ${filePath}`};
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile()) return {ok: false, reason: `target path is not a regular file: ${filePath}`};
  if (stat.size > maxFileBytes) return {ok: false, reason: `target file exceeds ${maxFileBytes} bytes: ${filePath}`};
  const buffer = fs.readFileSync(absolutePath);
  const content = buffer.toString('utf8');
  if (!Buffer.from(content, 'utf8').equals(buffer)) return {ok: false, reason: `target file is not valid UTF-8: ${filePath}`};
  if (content.includes('\0')) return {ok: false, reason: `target file appears to be binary: ${filePath}`};
  return {ok: true, value: content};
}

function simulateEdit(content: string, args: EditFileArguments): {ok: true; value: EditFileSimulation} | {ok: false; reason: string; hint?: string} {
  const matches: number[] = [];
  let cursor = 0;
  while (cursor <= content.length - args.oldString.length) {
    const match = content.indexOf(args.oldString, cursor);
    if (match < 0) break;
    matches.push(match);
    cursor = match + args.oldString.length;
  }

  if (matches.length === 0) return {ok: false, reason: 'old_string matched 0 locations', hint: 'Read the file again and use the exact current text.'};
  if (!args.replaceAll && matches.length > 1) return {ok: false, reason: `old_string matched ${matches.length} locations`, hint: 'Include more surrounding context for a unique match or set replace_all to true.'};

  const selected = args.replaceAll ? matches : matches.slice(0, 1);
  const chunks: string[] = [];
  const spans: ReplacementSpan[] = [];
  let sourceCursor = 0;
  let postLength = 0;
  for (const oldStart of selected) {
    const unchanged = content.slice(sourceCursor, oldStart);
    chunks.push(unchanged, args.newString);
    postLength += unchanged.length;
    spans.push({oldStart, oldEnd: oldStart + args.oldString.length, postStart: postLength, postEnd: postLength + args.newString.length});
    postLength += args.newString.length;
    sourceCursor = oldStart + args.oldString.length;
  }
  chunks.push(content.slice(sourceCursor));
  return {ok: true, value: {content: chunks.join(''), replacementCount: selected.length, spans}};
}

function createFailure(call: ToolCall, reason: string, hint?: string): EditFileToolExecutionResult {
  return {
    callId: call.callId,
    toolName: EDIT_FILE_TOOL_NAME,
    ok: false,
    text: ['Edit failed.', `Reason: ${reason}`, ...(hint ? [`Hint: ${hint}`] : [])].join('\n'),
    details: {kind: EDIT_FILE_TOOL_NAME}
  };
}

export {
  DEFAULT_MAX_FILE_BYTES,
  EDIT_FILE_TOOL_NAME,
  createEditFileCallLabel,
  createEditFileToolHandler,
  simulateEdit
};

export type {EditFileToolHandlerOptions};

import type {
  ApplyPatchToolExecutionResult,
  BashToolExecutionResult,
  GlobToolExecutionResult,
  GrepToolExecutionResult,
  ReadFilesToolExecutionResult,
  ToolCall,
  ToolExecutionResult,
  WebFetchToolExecutionResult,
  WebSearchToolExecutionResult
} from '../types/tool';
import type {ToolCallTranscriptRecord, ToolResultTranscriptRecord} from '../types/transcript';

/**
 * 将工具调用投影为持久化 transcript record；text 同时服务会话预览和压缩摘要。
 */
function createToolCallTranscriptRecord(call: ToolCall): ToolCallTranscriptRecord {
  return {
    role: 'tool_call',
    text: formatToolCallTranscriptText(call),
    toolCallId: call.callId,
    toolName: call.toolName,
    argumentsText: call.argumentsText
  };
}

/**
 * 将工具执行结果投影为持久化 transcript record，显式保留已定义的工具专属元数据。
 */
function createToolResultTranscriptRecord(result: ToolExecutionResult): ToolResultTranscriptRecord {
  const baseRecord = {
    role: 'tool_result' as const,
    text: result.text,
    toolCallId: result.callId,
    toolName: result.toolName,
    ok: result.ok,
    ...(result.attachments ? {attachments: result.attachments} : {})
  };

  switch (result.toolName) {
    case 'run_bash_command': {
      const bashResult = result as BashToolExecutionResult;

      return {
        ...baseRecord,
        exitCode: bashResult.exitCode,
        timedOut: bashResult.timedOut,
        truncated: bashResult.truncated,
        durationMs: bashResult.durationMs
      };
    }
    case 'glob': {
      const globResult = result as GlobToolExecutionResult;

      return {
        ...baseRecord,
        exitCode: globResult.exitCode,
        truncated: globResult.truncated
      };
    }
    case 'grep': {
      const grepResult = result as GrepToolExecutionResult;

      return {
        ...baseRecord,
        exitCode: grepResult.exitCode,
        truncated: grepResult.truncated
      };
    }
    case 'read_files': {
      const readFilesResult = result as ReadFilesToolExecutionResult;

      return {
        ...baseRecord,
        truncated: readFilesResult.truncated
      };
    }
    case 'web_fetch': {
      const webFetchResult = result as WebFetchToolExecutionResult;

      return {
        ...baseRecord,
        timedOut: webFetchResult.timedOut,
        truncated: webFetchResult.truncated
      };
    }
    case 'web_search': {
      const webSearchResult = result as WebSearchToolExecutionResult;

      return {
        ...baseRecord,
        timedOut: webSearchResult.timedOut,
        truncated: webSearchResult.truncated
      };
    }
    case 'apply_patch': {
      const applyPatchResult = result as ApplyPatchToolExecutionResult;

      return {
        ...baseRecord,
        ...(applyPatchResult.display ? {display: applyPatchResult.display} : {})
      };
    }
  }

  return baseRecord;
}

function formatToolCallTranscriptText(call: ToolCall): string {
  const command = extractCommandArgument(call.argumentsText);

  return command ? `$ ${command}` : `${call.toolName}(${call.argumentsText})`;
}

function extractCommandArgument(argumentsText: string): string {
  try {
    const parsed = JSON.parse(argumentsText) as {command?: unknown};
    return typeof parsed.command === 'string' ? parsed.command : '';
  } catch {
    return '';
  }
}

export {
  createToolCallTranscriptRecord,
  createToolResultTranscriptRecord
};

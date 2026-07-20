import type {ToolCall, ToolExecutionResult} from '../types/tool';
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
    details: result.details,
    ...(result.attachments ? {attachments: result.attachments} : {})
  };
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

import type {ToolCall, ToolExecutionResult} from '../types/tool';
import type {ToolCallTranscriptRecord, ToolResultTranscriptRecord} from '../types/transcript';

// 该文案直接进入 provider 请求，因此只陈述"被用户中断且未返回结果"，不复述可能的工具失败细节。
const INTERRUPTED_TOOL_RESULT_TEXT = 'Tool execution was interrupted by the user before it returned a result.';

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

/**
 * 为 Esc 中断时仍未取得结果的工具调用构造合成失败 result。
 * 直接构造 record 而不经过 ToolExecutionResult：调用已被中断，没有真实工具专属 details 可言；
 * ok=false 加 generic details 保证 provider 按失败工具结果转换，不伪装成成功或带专属元数据的结果。
 */
function createInterruptedToolResultTranscriptRecord(call: ToolCall): ToolResultTranscriptRecord {
  return {
    role: 'tool_result',
    text: INTERRUPTED_TOOL_RESULT_TEXT,
    toolCallId: call.callId,
    toolName: call.toolName,
    ok: false,
    details: {kind: 'generic'}
  };
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
  createInterruptedToolResultTranscriptRecord,
  createToolResultTranscriptRecord
};

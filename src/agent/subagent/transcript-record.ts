import {createToolCallTranscriptRecord, createToolResultTranscriptRecord} from '../../tools/tool-transcript-record';

import type {SubagentRunMetadata} from '../../types/agent';
import type {ToolCall, ToolExecutionResult} from '../../types/tool';
import type {SubagentTranscriptRecord} from '../../types/transcript';

/** 为同一次子 Agent 运行创建公共 transcript 身份。 */
function createBase(metadata: SubagentRunMetadata, text: string): Omit<SubagentTranscriptRecord, 'event'> {
  return {
    role: 'subagent',
    text,
    agentName: metadata.agentName,
    parentToolCallId: metadata.parentToolCallId,
    runId: metadata.runId
  };
}

function createSubagentStartRecord(metadata: SubagentRunMetadata, task: string): SubagentTranscriptRecord {
  return {...createBase(metadata, task), event: {kind: 'start', task}};
}

function createSubagentReasoningRecord(metadata: SubagentRunMetadata, text: string): SubagentTranscriptRecord {
  return {...createBase(metadata, text), event: {kind: 'reasoning_summary'}};
}

function createSubagentAssistantRecord(metadata: SubagentRunMetadata, text: string): SubagentTranscriptRecord {
  return {...createBase(metadata, text), event: {kind: 'assistant'}};
}

function createSubagentToolCallRecord(metadata: SubagentRunMetadata, call: ToolCall): SubagentTranscriptRecord {
  const record = createToolCallTranscriptRecord(call);
  return {
    ...createBase(metadata, record.text),
    event: {
      kind: 'tool_call',
      toolCallId: call.callId,
      toolName: call.toolName,
      argumentsText: call.argumentsText
    }
  };
}

function createSubagentToolResultRecord(metadata: SubagentRunMetadata, result: ToolExecutionResult): SubagentTranscriptRecord {
  const record = createToolResultTranscriptRecord(result);
  return {
    ...createBase(metadata, record.text),
    event: {
      kind: 'tool_result',
      toolCallId: result.callId,
      toolName: result.toolName,
      ok: result.ok,
      details: result.details,
      ...(result.attachments ? {attachments: result.attachments} : {})
    }
  };
}

function createSubagentTerminalRecord(metadata: SubagentRunMetadata, kind: 'completed', durationMs: number): SubagentTranscriptRecord;
function createSubagentTerminalRecord(metadata: SubagentRunMetadata, kind: 'failed' | 'cancelled', durationMs: number, text: string): SubagentTranscriptRecord;
function createSubagentTerminalRecord(metadata: SubagentRunMetadata, kind: 'completed' | 'failed' | 'cancelled', durationMs: number, text = ''): SubagentTranscriptRecord {
  return {
    ...createBase(metadata, text),
    event: {kind, durationMs: Math.max(0, Math.floor(durationMs))}
  };
}

export {
  createSubagentAssistantRecord,
  createSubagentReasoningRecord,
  createSubagentStartRecord,
  createSubagentTerminalRecord,
  createSubagentToolCallRecord,
  createSubagentToolResultRecord
};

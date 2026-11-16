import {createToolCallTranscriptRecord, createToolResultTranscriptRecord} from '../../tools/tool-transcript-record';

import type {LlmConfig, SubagentRunMetadata} from '../../types/agent';
import type {ToolCall, ToolExecutionResult} from '../../types/tool';
import type {SubagentTranscriptRecord, SubagentWorkspaceOutcomeFacts, SubagentWorkspaceRecordFacts} from '../../types/transcript';

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

function createSubagentStartRecord(metadata: SubagentRunMetadata, task: string, parallelSize?: number, resolvedConfig?: LlmConfig, workspace?: SubagentWorkspaceRecordFacts): SubagentTranscriptRecord {
  return {
    ...createBase(metadata, task),
    event: {
      kind: 'start',
      task,
      ...(parallelSize === undefined ? {} : {parallelSize}),
      // 窗口与回看展示的子运行实际模型事实；旧会话记录缺省时渲染层回退主模型。
      ...(resolvedConfig === undefined ? {} : {model: resolvedConfig.model}),
      ...(resolvedConfig?.reasoningEffort === undefined ? {} : {reasoningEffort: resolvedConfig.reasoningEffort}),
      // 工作区事实来自系统核验，不来自模型报告；旧记录缺省保持合法。
      ...(workspace === undefined ? {} : {workspace})
    }
  };
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

type SubagentTerminalRecordOptions = {
  durationMs: number; // 从 start 到终态的墙钟耗时。
  text?: string; // failed/cancelled 的简洁诊断；completed 正文必须为空。
  workspace?: SubagentWorkspaceOutcomeFacts; // 成果定位；缺省表示该运行没有受管工作区。
};

function createSubagentTerminalRecord(metadata: SubagentRunMetadata, kind: 'completed', options: Omit<SubagentTerminalRecordOptions, 'text'>): SubagentTranscriptRecord;
function createSubagentTerminalRecord(metadata: SubagentRunMetadata, kind: 'failed' | 'cancelled', options: SubagentTerminalRecordOptions & {text: string}): SubagentTranscriptRecord;
function createSubagentTerminalRecord(metadata: SubagentRunMetadata, kind: 'completed' | 'failed' | 'cancelled', options: SubagentTerminalRecordOptions): SubagentTranscriptRecord {
  return {
    ...createBase(metadata, options.text ?? ''),
    event: {
      kind,
      durationMs: Math.max(0, Math.floor(options.durationMs)),
      ...(options.workspace === undefined ? {} : {workspace: options.workspace})
    }
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

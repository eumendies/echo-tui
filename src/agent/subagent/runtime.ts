import {randomUUID} from 'node:crypto';

import {normalizeError} from '../agent-errors';
import {AgentAbortError} from '../../types/agent';
import {MAX_SUBAGENT_CALLS_PER_RUN, getSubagentDefinition, listSubagentDefinitions} from './definition';
import {
  createSubagentAssistantRecord,
  createSubagentReasoningRecord,
  createSubagentStartRecord,
  createSubagentTerminalRecord,
  createSubagentToolCallRecord,
  createSubagentToolResultRecord
} from './transcript-record';

import type {InheritedAgentRunContext, SubagentLoopCallbacks, SubagentLoopRuntimeFactory} from '../loop-runtime/types';
import type {
  AgentCallbacks,
  AgentExecutionMode,
  AgentUserConfigSnapshot,
  LlmConfig,
  SubagentRunMetadata,
  SubagentToolPort
} from '../../types/agent';
import type {SubagentTranscriptRecord} from '../../types/transcript';

type SubagentToolPortOptions = {
  callbacks: AgentCallbacks; // 父 run 的观察回调，承载审批和 TUI 活动投影。
  configSnapshot: AgentUserConfigSnapshot; // 父 run 捕获的配置 revision，子运行不得重新读取其他 revision。
  createRuntime: SubagentLoopRuntimeFactory; // 为每次委派创建拥有独立装配状态的 loop runtime 实例。
  executionMode: AgentExecutionMode; // 父 run 的 interactive/headless 安全边界。
  getInheritedContext: () => InheritedAgentRunContext; // 延迟读取父 run 已初始化的完整上下文快照。
  modelProfileId?: string; // 父 run 已解析选择的模型 profile。
  publishRecords: (records: SubagentTranscriptRecord[]) => void; // 把稳定过程同步提交到父 runtime 与 app transcript。
  reasoningEffortOverride?: LlmConfig['reasoningEffort']; // 父 run 本轮固定的推理强度覆盖。
};

/**
 * 创建父 run专属的委派端口，按定义解析子 Agent并集中管理预算、隔离 session、回调桥接和终态归一化。
 * 端口同步等待子运行结束；稳定过程由 publishRecords 增量提交，瞬时活动只通过父 callbacks 投影。
 */
function createSubagentToolPort(options: SubagentToolPortOptions): SubagentToolPort {
  let callCount = 0;

  return {
    listDefinitions() {
      return listSubagentDefinitions().map(({name, description}) => ({name, description}));
    },
    async run(agentName, task, call, executionOptions = {}) {
      const definition = getSubagentDefinition(agentName);
      if (!definition) {
        return {ok: false, text: `Unknown subagent: ${agentName}`};
      }
      if (callCount >= MAX_SUBAGENT_CALLS_PER_RUN) {
        return {ok: false, text: `Delegation limit reached (${MAX_SUBAGENT_CALLS_PER_RUN} per parent run).`};
      }
      callCount += 1;

      const startedAt = Date.now();
      const metadata: SubagentRunMetadata = {
        agentName: definition.name,
        depth: 1,
        parentToolCallId: call.callId,
        runId: randomUUID()
      };
      options.publishRecords([createSubagentStartRecord(metadata, task)]);
      publishActivity(options.callbacks, metadata, task, 'thinking');

      try {
        const inherited = options.getInheritedContext();
        const runAgent = options.createRuntime(inherited, definition);
        const answer = await runAgent({
          abortSignal: executionOptions.abortSignal,
          configSnapshot: options.configSnapshot,
          executionMode: options.executionMode,
          metadata,
          modelProfileId: options.modelProfileId,
          reasoningEffortOverride: options.reasoningEffortOverride,
          task
        }, createChildCallbacks(options, metadata, task, executionOptions.changeRecorder));

        options.publishRecords([createSubagentTerminalRecord(metadata, 'completed', Date.now() - startedAt)]);
        return {ok: true, text: answer};
      } catch (error: unknown) {
        const cancelled = error instanceof AgentAbortError || executionOptions.abortSignal?.aborted === true;
        const label = definition.name.charAt(0).toUpperCase() + definition.name.slice(1);
        const message = cancelled ? `${label} cancelled.` : normalizeError(error, `${label} failed`).message;
        options.publishRecords([createSubagentTerminalRecord(metadata, cancelled ? 'cancelled' : 'failed', Date.now() - startedAt, message)]);
        return {ok: false, text: message};
      }
    }
  };
}

/** 把子 loop 的稳定协议事件和瞬时活动翻译到父 run，不向子层暴露 app 状态对象。 */
function createChildCallbacks(
  options: SubagentToolPortOptions,
  metadata: SubagentRunMetadata,
  task: string,
  changeRecorder: AgentCallbacks['changeRecorder']
): SubagentLoopCallbacks {
  return {
    changeRecorder,
    onAssistantSegment(text) {
      if (text.trim()) {
        options.publishRecords([createSubagentAssistantRecord(metadata, text)]);
      }
      publishActivity(options.callbacks, metadata, task, 'thinking');
    },
    onComplete(text) {
      if (text.trim()) {
        options.publishRecords([createSubagentAssistantRecord(metadata, text)]);
      }
    },
    onReasoningUpdate(update) {
      publishActivity(options.callbacks, metadata, task, update.kind === 'draft' ? 'reasoning' : 'thinking', undefined, update.text);
      if (update.kind === 'complete' && update.text.trim()) {
        options.publishRecords([createSubagentReasoningRecord(metadata, update.text)]);
        publishActivity(options.callbacks, metadata, task, 'thinking');
      }
    },
    onThinking() {
      publishActivity(options.callbacks, metadata, task, 'thinking');
    },
    onToken(_token, draft) {
      publishActivity(options.callbacks, metadata, task, 'streaming', undefined, draft);
    },
    onToolCall(call) {
      options.publishRecords([createSubagentToolCallRecord(metadata, call)]);
      publishActivity(options.callbacks, metadata, task, 'tool', call);
    },
    onToolResult(result) {
      options.publishRecords([createSubagentToolResultRecord(metadata, result)]);
      publishActivity(options.callbacks, metadata, task, 'thinking');
    },
    async onToolApprovalRequest(call, approval) {
      if (!options.callbacks.onToolApprovalRequest) {
        return {kind: 'deny'};
      }
      const decision = await options.callbacks.onToolApprovalRequest(call, approval);
      publishActivity(options.callbacks, metadata, task, 'thinking');
      return decision;
    },
    onWaitingApproval(call) {
      publishActivity(options.callbacks, metadata, task, 'waiting_approval', call);
    }
  };
}

/** 发布子运行 footer 活动；稳定记录的提交由独立 sink 负责。 */
function publishActivity(
  callbacks: AgentCallbacks,
  metadata: SubagentRunMetadata,
  task: string,
  phase: 'thinking' | 'reasoning' | 'streaming' | 'tool' | 'waiting_approval',
  toolCall?: Parameters<NonNullable<AgentCallbacks['onToolCall']>>[0],
  draft?: string
): void {
  callbacks.onSubagentActivity?.({
    agentName: metadata.agentName,
    argumentsText: toolCall?.argumentsText,
    draft,
    phase,
    runId: metadata.runId,
    task,
    toolName: toolCall?.toolName
  });
}

export {createSubagentToolPort};

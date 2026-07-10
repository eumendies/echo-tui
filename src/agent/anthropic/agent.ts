import Anthropic from '@anthropic-ai/sdk';

import {LlmAgentError, normalizeError, redactSensitiveText} from '../agent-errors';
import {convertToolDefinitionsToAnthropicTools} from './tool-converter';
import {convertTranscriptToAnthropicMessages, createAnthropicThinkingRecord} from './transcript-converter';

import {isAbortError, throwIfAborted} from '../../types/agent';
import type {AgentTurnCallbacks, AgentTurnOptions, AgentTurnResult, AnthropicAgentDependencies, LlmConfig, ProviderAgent, ProviderUsage} from '../../types/agent';
import type {ReasoningEffort} from '../../types/agent';
import type {ToolCall, ToolRegistry} from '../../types/tool';
import type {TranscriptRecord} from '../../types/transcript';
import type {AnthropicTool} from './tool-converter';
import type {AnthropicMessage, AnthropicProviderThinkingBlock} from './transcript-converter';

type AnthropicCreateRequest = {
  cache_control: {
    type: 'ephemeral';
  };
  max_tokens: number;
  messages: AnthropicMessage[];
  model: string;
  output_config?: {
    effort: AnthropicEffort;
  };
  stream: true;
  system?: string;
  thinking?: {
    display: 'summarized';
    type: 'adaptive';
  };
  tools?: AnthropicTool[];
};

type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

type AnthropicStream = AsyncIterable<unknown>;

type AnthropicClient = {
  messages: {
    create: (request: AnthropicCreateRequest, options?: {signal?: AbortSignal}) => Promise<AnthropicStream>;
  };
};

type AnthropicStreamEvent = {
  content_block?: {
    data?: unknown;
    id?: unknown;
    input?: unknown;
    name?: unknown;
    signature?: unknown;
    text?: unknown;
    thinking?: unknown;
    type?: unknown;
  };
  delta?: {
    partial_json?: unknown;
    signature?: unknown;
    stop_reason?: unknown;
    text?: unknown;
    thinking?: unknown;
    type?: unknown;
  };
  error?: {message?: unknown};
  index?: unknown;
  message?: {usage?: AnthropicUsage};
  type?: unknown;
  usage?: AnthropicUsage;
};

type AnthropicUsage = {
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  input_tokens?: unknown;
  output_tokens?: unknown;
};

type PartialToolCall = {
  argumentsText: string;
  callId?: string;
  toolIndex: number;
  toolName?: string;
};

type PartialThinkingBlock =
  | {blockIndex: number; signature?: string; thinking: string; type: 'thinking'}
  | {blockIndex: number; data?: string; type: 'redacted_thinking'};

type AnthropicStreamState = {
  draft: string;
  stopReason?: string;
  thinkingParts: Map<number, PartialThinkingBlock>;
  toolCallParts: Map<number, PartialToolCall>;
};

const ANTHROPIC_MAX_RETRIES = 3;
const ANTHROPIC_DEFAULT_MAX_TOKENS = 32768;

function mapReasoningEffortToAnthropicEffort(effort: ReasoningEffort | undefined): AnthropicEffort | undefined {
  switch (effort) {
    case 'minimal':
      return 'low';
    case 'low':
      return 'medium';
    case 'medium':
      return 'high';
    case 'high':
      return 'xhigh';
    case 'xhigh':
      return 'max';
    case 'none':
    default:
      return undefined;
  }
}

function createClient(config: LlmConfig, AnthropicClient: new (options: {apiKey: string; baseURL?: string; defaultHeaders?: Record<string, string>; maxRetries?: number}) => unknown): unknown {
  return new AnthropicClient({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: config.headers,
    maxRetries: ANTHROPIC_MAX_RETRIES
  });
}

/**
 * 根据当前 transcript 快照创建 Anthropic Messages API 请求；registry 非空时暴露本地工具定义。
 */
function createAnthropicRequest(records: TranscriptRecord[], config: LlmConfig, registry?: ToolRegistry): AnthropicCreateRequest {
  const projection = convertTranscriptToAnthropicMessages(records);
  const effort = mapReasoningEffortToAnthropicEffort(config.reasoningEffort);
  const request: AnthropicCreateRequest = {
    cache_control: {type: 'ephemeral'},
    max_tokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
    messages: projection.messages,
    model: config.model,
    stream: true,
    ...(projection.system ? {system: projection.system} : {})
  };

  if (effort) {
    request.thinking = {type: 'adaptive', display: 'summarized'};
    request.output_config = {effort};
  }

  if (registry && !registry.isEmpty()) {
    request.tools = convertToolDefinitionsToAnthropicTools(registry.listDefinitions());
  }

  return request;
}

function assertAnthropicClient(value: unknown): asserts value is AnthropicClient {
  const candidate = value as {messages?: {create?: unknown}};

  if (typeof candidate?.messages?.create !== 'function') {
    throw new LlmAgentError('无法启动模型响应');
  }
}

function isAnthropicEvent(value: unknown): value is AnthropicStreamEvent {
  return typeof value === 'object' && value !== null;
}

function summarizeFailureEvent(event: unknown): string {
  if (!isAnthropicEvent(event) || typeof event.error?.message !== 'string') {
    return '模型服务返回失败事件';
  }

  return event.error.message;
}

function extractProviderUsage(event: unknown): ProviderUsage | undefined {
  if (!isAnthropicEvent(event)) {
    return undefined;
  }

  const usage = event.message?.usage ?? event.usage;

  if (!usage) {
    return undefined;
  }

  const inputTokens = typeof usage.input_tokens === 'number' && Number.isFinite(usage.input_tokens) ? usage.input_tokens : undefined;
  const cacheCreationInputTokens = typeof usage.cache_creation_input_tokens === 'number' && Number.isFinite(usage.cache_creation_input_tokens) ? usage.cache_creation_input_tokens : undefined;
  const cacheReadInputTokens = typeof usage.cache_read_input_tokens === 'number' && Number.isFinite(usage.cache_read_input_tokens) ? usage.cache_read_input_tokens : undefined;
  const outputTokens = typeof usage.output_tokens === 'number' && Number.isFinite(usage.output_tokens) ? usage.output_tokens : undefined;
  const totalInputTokens = [inputTokens, cacheCreationInputTokens, cacheReadInputTokens]
    .filter((value): value is number => typeof value === 'number')
    .reduce((sum, value) => sum + value, 0);

  return totalInputTokens > 0 || outputTokens !== undefined ? {
    ...(totalInputTokens > 0 ? {inputTokens: totalInputTokens} : {}),
    ...(cacheCreationInputTokens !== undefined ? {cacheCreationInputTokens} : {}),
    ...(cacheReadInputTokens !== undefined ? {cacheReadInputTokens} : {}),
    ...(outputTokens !== undefined ? {outputTokens} : {})
  } : undefined;
}

function getEventIndex(event: AnthropicStreamEvent): number {
  return typeof event.index === 'number' ? event.index : 0;
}

function getOrCreateToolCallPart(parts: Map<number, PartialToolCall>, toolIndex: number): PartialToolCall {
  const current = parts.get(toolIndex) || {argumentsText: '', toolIndex};
  parts.set(toolIndex, current);
  return current;
}

function getOrCreateThinkingPart(parts: Map<number, PartialThinkingBlock>, blockIndex: number): Extract<PartialThinkingBlock, {type: 'thinking'}> {
  const current = parts.get(blockIndex);

  if (current?.type === 'thinking') {
    return current;
  }

  const next: PartialThinkingBlock = {blockIndex, thinking: '', type: 'thinking'};
  parts.set(blockIndex, next);

  return next;
}

function getOrCreateRedactedThinkingPart(parts: Map<number, PartialThinkingBlock>, blockIndex: number): Extract<PartialThinkingBlock, {type: 'redacted_thinking'}> {
  const current = parts.get(blockIndex);

  if (current?.type === 'redacted_thinking') {
    return current;
  }

  const next: PartialThinkingBlock = {blockIndex, type: 'redacted_thinking'};
  parts.set(blockIndex, next);

  return next;
}

function mergeContentBlockStart(state: AnthropicStreamState, event: AnthropicStreamEvent): void {
  if (event.content_block?.type === 'thinking') {
    const current = getOrCreateThinkingPart(state.thinkingParts, getEventIndex(event));

    if (typeof event.content_block.thinking === 'string') {
      current.thinking = event.content_block.thinking;
    }

    if (typeof event.content_block.signature === 'string') {
      current.signature = event.content_block.signature;
    }

    return;
  }

  if (event.content_block?.type === 'redacted_thinking') {
    const current = getOrCreateRedactedThinkingPart(state.thinkingParts, getEventIndex(event));

    if (typeof event.content_block.data === 'string') {
      current.data = event.content_block.data;
    }

    return;
  }

  if (event.content_block?.type !== 'tool_use') {
    return;
  }

  const toolIndex = getEventIndex(event);
  const current = getOrCreateToolCallPart(state.toolCallParts, toolIndex);

  if (typeof event.content_block.id === 'string') {
    current.callId = event.content_block.id;
  }

  if (typeof event.content_block.name === 'string') {
    current.toolName = event.content_block.name;
  }

  if (event.content_block.input && typeof event.content_block.input === 'object' && !Array.isArray(event.content_block.input)) {
    const input = event.content_block.input as Record<string, unknown>;
    current.argumentsText = Object.keys(input).length > 0 ? JSON.stringify(input) : '';
  }
}

function mergeContentBlockDelta(state: AnthropicStreamState, event: AnthropicStreamEvent, callbacks: AgentTurnCallbacks): void {
  if (event.delta?.type === 'text_delta' && typeof event.delta.text === 'string' && event.delta.text !== '') {
    state.draft += event.delta.text;
    callbacks.onToken?.(event.delta.text, state.draft);
    return;
  }

  if (event.delta?.type === 'thinking_delta' && typeof event.delta.thinking === 'string') {
    const current = getOrCreateThinkingPart(state.thinkingParts, getEventIndex(event));
    current.thinking += event.delta.thinking;
    return;
  }

  if (event.delta?.type === 'signature_delta' && typeof event.delta.signature === 'string') {
    const current = getOrCreateThinkingPart(state.thinkingParts, getEventIndex(event));
    current.signature = event.delta.signature;
    return;
  }

  if (event.delta?.type !== 'input_json_delta' || typeof event.delta.partial_json !== 'string') {
    return;
  }

  const current = getOrCreateToolCallPart(state.toolCallParts, getEventIndex(event));

  current.argumentsText += event.delta.partial_json;
}

function mergeMessageDelta(state: AnthropicStreamState, event: AnthropicStreamEvent): void {
  if (typeof event.delta?.stop_reason === 'string') {
    state.stopReason = event.delta.stop_reason;
  }
}

function assertSupportedStopReason(state: AnthropicStreamState): void {
  switch (state.stopReason) {
    case 'end_turn':
    case 'stop_sequence':
    case 'tool_use':
      return;
    case 'max_tokens':
      throw new LlmAgentError('模型响应达到 max_tokens 限制，回答已截断');
    case 'pause_turn':
      throw new LlmAgentError('模型响应以 pause_turn 暂停，当前暂不支持自动续传');
    case 'refusal':
      throw new LlmAgentError('模型响应被服务端安全策略拒绝');
    case undefined:
      throw new LlmAgentError('模型响应流缺少停止原因');
    default:
      throw new LlmAgentError(`模型响应以不支持的停止原因结束：${redactSensitiveText(state.stopReason)}`);
  }
}

function finalizeToolCalls(parts: Map<number, PartialToolCall>): ToolCall[] {
  return Array.from(parts.values())
    .sort((left, right) => left.toolIndex - right.toolIndex)
    .map((part) => {
      if (!part.callId || !part.toolName) {
        throw new LlmAgentError('模型服务返回不完整工具调用');
      }

      return {
        callId: part.callId,
        toolName: part.toolName,
        argumentsText: part.argumentsText
      };
    });
}

function orderedThinkingParts(parts: Map<number, PartialThinkingBlock>): PartialThinkingBlock[] {
  return Array.from(parts.values())
    .sort((left, right) => left.blockIndex - right.blockIndex);
}

function readReasoningSummary(parts: PartialThinkingBlock[]): string | undefined {
  const summary = parts
    .filter((part): part is Extract<PartialThinkingBlock, {type: 'thinking'}> => part.type === 'thinking' && part.thinking.trim() !== '')
    .map((part) => part.thinking)
    .join('\n\n')
    .trim();

  return summary === '' ? undefined : summary;
}

function finalizeThinkingRecords(parts: PartialThinkingBlock[]): TranscriptRecord[] {
  return parts
    .map((part): AnthropicProviderThinkingBlock | null => {
      if (part.type === 'thinking' && part.thinking !== '' && part.signature) {
        return {type: 'thinking', thinking: part.thinking, signature: part.signature};
      }

      if (part.type === 'redacted_thinking' && part.data) {
        return {type: 'redacted_thinking', data: part.data};
      }

      return null;
    })
    .filter((block): block is AnthropicProviderThinkingBlock => block !== null)
    .map((block) => createAnthropicThinkingRecord(block));
}

/**
 * 消费一次 Anthropic stream：累积 assistant 文本，同时聚合 tool_use 输入分片。
 */
async function readAnthropicStream(stream: AnthropicStream, callbacks: AgentTurnCallbacks = {}, options: AgentTurnOptions = {}): Promise<AgentTurnResult> {
  let completed = false;
  let usage: ProviderUsage | undefined;
  let usageInputTokens: number | undefined;
  const state: AnthropicStreamState = {
    draft: '',
    thinkingParts: new Map(),
    toolCallParts: new Map()
  };

  try {
    for await (const event of stream) {
      throwIfAborted(options.abortSignal);

      if (isAnthropicEvent(event) && event.error) {
        throw new LlmAgentError(`模型服务响应失败：${redactSensitiveText(summarizeFailureEvent(event))}`);
      }

      const eventUsage = extractProviderUsage(event);

      if (eventUsage) {
        usage = eventUsage;
        usageInputTokens = eventUsage.inputTokens;
      }

      if (!isAnthropicEvent(event)) {
        continue;
      }

      if (event.type === 'content_block_start') {
        mergeContentBlockStart(state, event);
        continue;
      }

      if (event.type === 'content_block_delta') {
        mergeContentBlockDelta(state, event, callbacks);
        continue;
      }

      if (event.type === 'message_delta') {
        mergeMessageDelta(state, event);
        continue;
      }

      if (event.type === 'message_stop') {
        completed = true;
      }
    }
  } catch (error: unknown) {
    if (isAbortError(error) || options.abortSignal?.aborted) {
      throwIfAborted(options.abortSignal);
    }

    throw normalizeError(error, '模型响应流异常');
  }

  if (!completed) {
    throw new LlmAgentError('模型响应流未完成');
  }

  assertSupportedStopReason(state);

  const thinkingParts = orderedThinkingParts(state.thinkingParts);
  const providerRecords = finalizeThinkingRecords(thinkingParts);
  const reasoningSummary = readReasoningSummary(thinkingParts);

  return {
    draft: state.draft,
    ...(providerRecords.length > 0 ? {providerRecords} : {}),
    ...(reasoningSummary ? {reasoningSummary} : {}),
    toolCalls: finalizeToolCalls(state.toolCallParts),
    ...(usage ? {usage} : {}),
    usageInputTokens
  };
}

/**
 * 创建基于 Anthropic SDK Messages API 的单次 provider turn agent；tool loop 由外层编排。
 */
class AnthropicAgent implements ProviderAgent {
  private client: AnthropicClient | null = null;
  private config: LlmConfig | null = null;
  private makeClient: (config: LlmConfig) => unknown;
  private registry: ToolRegistry | null = null;

  constructor(dependencies: AnthropicAgentDependencies = {}) {
    const AnthropicClient = dependencies.AnthropicClient || Anthropic;
    this.makeClient = dependencies.createClient || ((config: LlmConfig) => createClient(config, AnthropicClient));
  }

  /**
   * 使用当前配置初始化 Anthropic client 和本轮可用工具定义。
   */
  initialize(config: LlmConfig, registry: ToolRegistry): void {
    const client = this.makeClient(config);
    assertAnthropicClient(client);

    this.client = client;
    this.config = config;
    this.registry = registry;
  }

  /**
   * 执行一次 Anthropic provider turn；工具循环由外层 runtime 继续编排。
   */
  async runTurn(records: TranscriptRecord[], callbacks: AgentTurnCallbacks = {}, options: AgentTurnOptions = {}): Promise<AgentTurnResult> {
    if (!this.client || !this.config || !this.registry) {
      throw new LlmAgentError('模型运行时尚未初始化');
    }

    let stream: AnthropicStream;

    try {
      stream = await this.client.messages.create(createAnthropicRequest(records, this.config, this.registry), {signal: options.abortSignal});
    } catch (error: unknown) {
      if (isAbortError(error) || options.abortSignal?.aborted) {
        throwIfAborted(options.abortSignal);
      }

      throw normalizeError(error, '无法启动模型响应');
    }

    return readAnthropicStream(stream, callbacks, options);
  }
}

function createAnthropicAgent(dependencies: AnthropicAgentDependencies = {}): ProviderAgent {
  return new AnthropicAgent(dependencies);
}

export {
  ANTHROPIC_DEFAULT_MAX_TOKENS,
  createAnthropicAgent,
  createAnthropicRequest,
  readAnthropicStream
};

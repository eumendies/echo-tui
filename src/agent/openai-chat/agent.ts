import OpenAI from 'openai';

import {LlmAgentError, normalizeError, redactSensitiveText} from '../agent-errors';
import {createPromptCacheKey} from '../prompt-cache';
import {convertTranscriptToOpenAiChatMessages, createOpenAiChatReasoningRecord} from './transcript-converter';
import {convertToolDefinitionsToOpenAiChatTools} from './tool-converter';

import {isAbortError, throwIfAborted} from '../../types/agent';
import type {AgentTurnCallbacks, AgentTurnOptions, AgentTurnResult, LlmConfig, OpenAiChatAgentDependencies, ProviderAgent, ProviderUsage} from '../../types/agent';
import type {ToolCall, ToolRegistry} from '../../types/tool';
import type {TranscriptRecord} from '../../types/transcript';
import type {OpenAiChatMessage} from './transcript-converter';
import type {OpenAiChatFunctionTool} from './tool-converter';

type ChatCreateRequest = {
  messages: OpenAiChatMessage[];
  model: string;
  parallel_tool_calls?: false;
  prompt_cache_key: string;
  reasoning_effort?: NonNullable<LlmConfig['reasoningEffort']>;
  stream: true;
  stream_options?: {
    include_usage: true;
  };
  tools?: OpenAiChatFunctionTool[];
};

type ChatStream = AsyncIterable<unknown>;

type ChatClient = {
  chat: {
    completions: {
      create: (request: ChatCreateRequest, options?: {signal?: AbortSignal}) => Promise<ChatStream>;
    };
  };
};

type ChatStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: unknown;
      reasoning_content?: unknown;
      tool_calls?: unknown;
    };
    finish_reason?: unknown;
  }>;
  error?: {message?: unknown};
  usage?: {
    completion_tokens?: unknown;
    prompt_tokens?: unknown;
    prompt_tokens_details?: {
      cached_tokens?: unknown;
    };
  };
};

type ChatToolCallDelta = {
  function?: {
    arguments?: unknown;
    name?: unknown;
  };
  id?: unknown;
  index?: unknown;
};

type PartialToolCall = {
  argumentsText: string;
  callId?: string;
  toolIndex: number;
  toolName?: string;
};

const OPENAI_MAX_RETRIES = 3;

function createClient(config: LlmConfig, OpenAIClient: new (options: {apiKey: string; baseURL?: string; defaultHeaders?: Record<string, string>; maxRetries?: number}) => unknown): unknown {
  return new OpenAIClient({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: config.headers,
    maxRetries: OPENAI_MAX_RETRIES
  });
}

/**
 * 根据当前 transcript 快照创建 Chat Completions 请求；压缩用途不暴露工具或 reasoning 配置。
 */
function createChatRequest(records: TranscriptRecord[], config: LlmConfig, registry?: ToolRegistry, options: AgentTurnOptions = {}): ChatCreateRequest {
  const toolDefinitions = !options.isCompaction && registry && !registry.isEmpty() ? registry.listDefinitions() : [];
  const request: ChatCreateRequest = {
    messages: convertTranscriptToOpenAiChatMessages(records),
    model: config.model,
    prompt_cache_key: createPromptCacheKey(records, config, toolDefinitions),
    stream: true,
    stream_options: {include_usage: true}
  };

  if (!options.isCompaction && config.reasoningEffort && config.reasoningEffort !== 'none') {
    request.reasoning_effort = config.reasoningEffort;
  }

  if (toolDefinitions.length > 0) {
    request.tools = convertToolDefinitionsToOpenAiChatTools(toolDefinitions);
    request.parallel_tool_calls = false;
  }

  return request;
}

function assertChatClient(value: unknown): asserts value is ChatClient {
  const candidate = value as {chat?: {completions?: {create?: unknown}}};

  if (typeof candidate?.chat?.completions?.create !== 'function') {
    throw new LlmAgentError('无法启动模型响应');
  }
}

function isChatChunk(value: unknown): value is ChatStreamChunk {
  return typeof value === 'object' && value !== null;
}

function summarizeFailureChunk(chunk: unknown): string {
  if (!isChatChunk(chunk) || typeof chunk.error?.message !== 'string') {
    return '模型服务返回失败事件';
  }

  return chunk.error.message;
}

function extractProviderUsage(chunk: unknown): ProviderUsage | undefined {
  if (!isChatChunk(chunk)) {
    return undefined;
  }

  const promptTokens = chunk.usage?.prompt_tokens;
  const cachedTokens = chunk.usage?.prompt_tokens_details?.cached_tokens;
  const completionTokens = chunk.usage?.completion_tokens;
  const inputTokens = typeof promptTokens === 'number' && Number.isFinite(promptTokens) ? promptTokens : undefined;
  const cacheReadInputTokens = typeof cachedTokens === 'number' && Number.isFinite(cachedTokens) ? cachedTokens : undefined;
  const outputTokens = typeof completionTokens === 'number' && Number.isFinite(completionTokens) ? completionTokens : undefined;

  return inputTokens !== undefined || cacheReadInputTokens !== undefined || outputTokens !== undefined ? {
    ...(inputTokens !== undefined ? {inputTokens} : {}),
    ...(cacheReadInputTokens !== undefined ? {cacheReadInputTokens} : {}),
    ...(outputTokens !== undefined ? {outputTokens} : {})
  } : undefined;
}

function readToolCallDeltas(value: unknown): ChatToolCallDelta[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'object' && entry !== null) as ChatToolCallDelta[] : [];
}

function mergeToolCallDelta(parts: Map<number, PartialToolCall>, delta: ChatToolCallDelta): void {
  const toolIndex = typeof delta.index === 'number' ? delta.index : 0;
  const current = parts.get(toolIndex) || {argumentsText: '', toolIndex};

  if (typeof delta.id === 'string') {
    current.callId = delta.id;
  }

  if (typeof delta.function?.name === 'string') {
    current.toolName = delta.function.name;
  }

  if (typeof delta.function?.arguments === 'string') {
    current.argumentsText += delta.function.arguments;
  }

  parts.set(toolIndex, current);
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

/**
 * 消费一次 Chat Completions stream：累积 assistant 文本，同时聚合工具调用参数分片。
 */
async function readChatCompletionStream(stream: ChatStream, callbacks: AgentTurnCallbacks = {}, options: AgentTurnOptions = {}): Promise<AgentTurnResult> {
  let completed = false;
  let draft = '';
  let reasoningSummary = '';
  let usage: ProviderUsage | undefined;
  let usageInputTokens: number | undefined;
  const toolCallParts = new Map<number, PartialToolCall>();

  try {
    for await (const chunk of stream) {
      throwIfAborted(options.abortSignal);

      if (isChatChunk(chunk) && chunk.error) {
        throw new LlmAgentError(`模型服务响应失败：${redactSensitiveText(summarizeFailureChunk(chunk))}`);
      }

      const chunkUsage = extractProviderUsage(chunk);

      if (chunkUsage) {
        usage = chunkUsage;
        usageInputTokens = chunkUsage.inputTokens;
      }

      if (!isChatChunk(chunk) || !Array.isArray(chunk.choices)) {
        continue;
      }

      chunk.choices.forEach((choice) => {
        const content = choice.delta?.content;
        const reasoningContent = choice.delta?.reasoning_content;

        if (typeof content === 'string' && content !== '') {
          draft += content;
          callbacks.onToken?.(content, draft);
        }

        if (typeof reasoningContent === 'string' && reasoningContent !== '') {
          reasoningSummary += reasoningContent;
        }

        for (const toolDelta of readToolCallDeltas(choice.delta?.tool_calls)) {
          mergeToolCallDelta(toolCallParts, toolDelta);
        }

        if (choice.finish_reason === 'stop' || choice.finish_reason === 'tool_calls') {
          completed = true;
        }
      });
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

  const normalizedReasoningSummary = reasoningSummary.trim();

  return {
    draft,
    ...(normalizedReasoningSummary !== '' ? {providerRecords: [createOpenAiChatReasoningRecord(normalizedReasoningSummary)]} : {}),
    ...(normalizedReasoningSummary !== '' ? {reasoningSummary: normalizedReasoningSummary} : {}),
    toolCalls: finalizeToolCalls(toolCallParts),
    ...(usage ? {usage} : {}),
    usageInputTokens
  };
}

/**
 * 创建基于 OpenAI SDK Chat Completions 的单次 provider turn agent；tool loop 由外层编排。
 */
class OpenAiChatAgent implements ProviderAgent {
  private readonly client: ChatClient;
  private readonly config: LlmConfig;
  private readonly registry: ToolRegistry;

  constructor(config: LlmConfig, registry: ToolRegistry, dependencies: OpenAiChatAgentDependencies = {}) {
    const OpenAIClient = dependencies.OpenAIClient || OpenAI;
    const makeClient = dependencies.createClient || ((clientConfig: LlmConfig) => createClient(clientConfig, OpenAIClient));
    const client = makeClient(config);
    assertChatClient(client);

    this.client = client;
    this.config = config;
    this.registry = registry;
  }

  /**
   * 执行一次 Chat Completions provider turn；工具循环由外层 runtime 继续编排。
   */
  async runTurn(records: TranscriptRecord[], callbacks: AgentTurnCallbacks = {}, options: AgentTurnOptions = {}): Promise<AgentTurnResult> {
    let stream: ChatStream;

    try {
      stream = await this.client.chat.completions.create(createChatRequest(records, this.config, this.registry, options), {signal: options.abortSignal});
    } catch (error: unknown) {
      if (isAbortError(error) || options.abortSignal?.aborted) {
        throwIfAborted(options.abortSignal);
      }

      throw normalizeError(error, '无法启动模型响应');
    }

    return readChatCompletionStream(stream, callbacks, options);
  }
}

function createOpenAiChatAgent(config: LlmConfig, registry: ToolRegistry, dependencies: OpenAiChatAgentDependencies = {}): ProviderAgent {
  return new OpenAiChatAgent(config, registry, dependencies);
}

export {
  createChatRequest,
  createOpenAiChatAgent,
  readChatCompletionStream
};

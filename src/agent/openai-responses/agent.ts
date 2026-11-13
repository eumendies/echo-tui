import OpenAI from 'openai';

import {LlmAgentError, normalizeError, redactSensitiveText} from '../agent-errors';
import {createPromptCacheKey} from '../prompt-cache';
import {ProviderError, annotateProviderError, classifyProviderError, createProviderError} from '../provider-error';
import {runProviderStreamWithRetry} from '../provider-stream-retry';
import {convertTranscriptToOpenAiInput, createOpenAiReasoningRecord} from './transcript-converter';
import {convertToolDefinitionsToOpenAiTools, extractFunctionToolCall} from './tool-converter';

import {AgentAbortError, isAbortError, throwIfAborted} from '../../types/agent';
import type {AgentTurnCallbacks, AgentTurnOptions, AgentTurnResult, LlmConfig, OpenAiAgentDependencies, ProviderAgent, ProviderUsage} from '../../types/agent';
import type {ToolCall, ToolRegistry} from '../../types/tool';
import type {TranscriptRecord} from '../../types/transcript';
import type {OpenAiFunctionTool} from './tool-converter';
import type {OpenAiInputItem} from './transcript-converter';
import type {ProviderStreamAttemptObserver} from '../provider-stream-retry';

type ResponseEventDetails = {
  code?: unknown;
  error?: {code?: unknown; message?: unknown};
  incomplete_details?: {reason?: unknown};
  message?: unknown;
  requestID?: unknown;
  response?: {incomplete_details?: {reason?: unknown}; error?: {code?: unknown; message?: unknown}};
};

type ResponseCreateRequest = {
  input: OpenAiInputItem[];
  model: string;
  parallel_tool_calls?: true;
  prompt_cache_key: string;
  reasoning?: {effort?: NonNullable<LlmConfig['reasoningEffort']>; summary?: NonNullable<LlmConfig['reasoningSummary']>};
  stream: true;
  tools?: OpenAiFunctionTool[];
};

type ResponseStreamEvent = {
  type?: unknown;
  delta?: unknown;
  error?: {message?: unknown};
  response?: {error?: {message?: unknown}};
};

type ReasoningSummaryEvent = {
  output_index?: unknown;
  summary_index?: unknown;
  text?: unknown;
};

type ResponseStream = AsyncIterable<unknown>;

type ResponseClient = {
  responses: {
    create: (request: ResponseCreateRequest, options?: {signal?: AbortSignal}) => Promise<ResponseStream>;
  };
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
 * 根据当前 transcript 快照创建 Responses API 请求；摘要请求按 `includeToolDefinitions` 决定是否携带工具定义
 * （压缩摘要携带以对齐前缀缓存），始终剥离仅供展示的 reasoning summary 与工具调用控制参数；
 * reasoning effort 与普通 turn 同规则携带（含显式 none 的禁用语义）。
 */
function createRequest(records: TranscriptRecord[], config: LlmConfig, registry?: ToolRegistry, options: AgentTurnOptions = {}): ResponseCreateRequest {
  const toolDefinitions = registry && !registry.isEmpty() ? registry.listDefinitions() : [];
  const request: ResponseCreateRequest = {
    input: convertTranscriptToOpenAiInput(records),
    model: config.model,
    // 键材料始终包含工具目录：摘要请求据此路由到普通请求已建立的缓存分片。
    prompt_cache_key: createPromptCacheKey(records, config, toolDefinitions),
    stream: true
  };
  const reasoningSummary = options.isCompaction ? undefined : config.reasoningSummary;

  // 显式 none 也必须发送：思考模型缺省按模型默认 effort（如 medium）思考，省略参数无法表达禁用。
  if (config.reasoningEffort || reasoningSummary) {
    request.reasoning = {
      ...(config.reasoningEffort ? {effort: config.reasoningEffort} : {}),
      ...(reasoningSummary ? {summary: reasoningSummary} : {})
    };
  }

  // 压缩摘要携带同源工具目录以对齐前缀缓存；引用总结等一次性摘要请求缺省保持剥离。
  const includeToolDefinitions = !options.isCompaction || options.includeToolDefinitions === true;

  if (includeToolDefinitions && toolDefinitions.length > 0) {
    request.tools = convertToolDefinitionsToOpenAiTools(toolDefinitions);

    // 工具调用控制参数仍只在普通 turn 发送：摘要请求不需要触发工具调用。
    if (!options.isCompaction) {
      request.parallel_tool_calls = true;
    }
  }

  return request;
}

function isStreamEvent(value: unknown): value is ResponseStreamEvent {
  return typeof value === 'object' && value !== null;
}

/**
 * 从 OpenAI streaming 事件中提取文本增量，非文本事件返回空字符串。
 */
function extractTextDelta(event: unknown): string {
  if (!isStreamEvent(event) || event.type !== 'response.output_text.delta') {
    return '';
  }

  return typeof event.delta === 'string' ? event.delta : '';
}

function extractReasoningSummaryDelta(event: unknown): {key: string; delta: string; order: [number, number]} | null {
  if (!isStreamEvent(event) || event.type !== 'response.reasoning_summary_text.delta' || typeof event.delta !== 'string') {
    return null;
  }

  const order = getReasoningSummaryOrder(event);

  if (!order) {
    return null;
  }

  return {key: createReasoningSummaryKey(order), delta: event.delta, order};
}

function extractReasoningSummaryDone(event: unknown): {key: string; text: string; order: [number, number]} | null {
  if (!isStreamEvent(event) || event.type !== 'response.reasoning_summary_text.done') {
    return null;
  }

  const text = (event as ReasoningSummaryEvent).text;
  const order = getReasoningSummaryOrder(event);

  if (typeof text !== 'string' || !order) {
    return null;
  }

  return {key: createReasoningSummaryKey(order), text, order};
}

function getReasoningSummaryOrder(event: unknown): [number, number] | null {
  const candidate = event as ReasoningSummaryEvent;
  const outputIndex = candidate.output_index;
  const summaryIndex = candidate.summary_index;

  if (typeof outputIndex !== 'number' || typeof summaryIndex !== 'number') {
    return null;
  }

  return [outputIndex, summaryIndex];
}

function createReasoningSummaryKey(order: [number, number]): string {
  return `${order[0]}:${order[1]}`;
}

function readReasoningSummaryText(parts: Map<string, {order: [number, number]; text: string}>): string | undefined {
  const text = Array.from(parts.values())
    .sort((left, right) => left.order[0] - right.order[0] || left.order[1] - right.order[1])
    .map((part) => part.text.trim())
    .filter((part) => part !== '')
    .join('\n\n');

  return text === '' ? undefined : text;
}

function extractCompletedReasoningSummary(event: unknown): {outputIndex: number; texts: string[]} | null {
  if (!isStreamEvent(event) || event.type !== 'response.output_item.done') {
    return null;
  }

  const candidate = event as {item?: {status?: unknown; summary?: unknown; type?: unknown}; output_index?: unknown};

  if (candidate.item?.type !== 'reasoning' ||
    candidate.item.status === 'incomplete' ||
    !Array.isArray(candidate.item.summary) ||
    typeof candidate.output_index !== 'number') {
    return null;
  }

  const texts = candidate.item.summary
    .map((part) => {
      const summaryPart = part as {text?: unknown; type?: unknown};
      return summaryPart?.type === 'summary_text' && typeof summaryPart.text === 'string' ? summaryPart.text : null;
    })
    .filter((text): text is string => text !== null);

  return {outputIndex: candidate.output_index, texts};
}

function replaceCompletedReasoningParts(parts: Map<string, {order: [number, number]; text: string}>, completed: {outputIndex: number; texts: string[]}): string | undefined {
  for (const [key, part] of parts) {
    if (part.order[0] === completed.outputIndex) {
      parts.delete(key);
    }
  }

  completed.texts.forEach((text, summaryIndex) => {
    const order: [number, number] = [completed.outputIndex, summaryIndex];
    parts.set(createReasoningSummaryKey(order), {order, text});
  });

  return readReasoningSummaryText(parts);
}

function extractReasoningOutputItem(event: unknown): TranscriptRecord | null {
  if (!isStreamEvent(event) || event.type !== 'response.output_item.done') {
    return null;
  }

  const item = (event as {item?: unknown}).item;

  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }

  const candidate = item as {encrypted_content?: unknown; type?: unknown};

  if (candidate.type !== 'reasoning' || typeof candidate.encrypted_content !== 'string' || candidate.encrypted_content.trim() === '') {
    return null;
  }

  // 只有带 encrypted_content 的 reasoning item 才能跨请求安全回传；仅有 id 的 item 可能触发服务端 not found。
  return createOpenAiReasoningRecord(item as {type: 'reasoning'; encrypted_content: string; [key: string]: unknown});
}

function isCompletedEvent(event: unknown): boolean {
  return isStreamEvent(event) && event.type === 'response.completed';
}

function isIncompleteEvent(event: unknown): boolean {
  return isStreamEvent(event) && event.type === 'response.incomplete';
}

function isFailureEvent(event: unknown): boolean {
  return isStreamEvent(event) && (event.type === 'response.failed' || event.type === 'error');
}

function readResponseErrorCode(value: unknown): string | null {
  if (!isStreamEvent(value)) {
    return null;
  }

  const candidate = value as ResponseEventDetails;
  const code = candidate.code ?? candidate.error?.code ?? candidate.response?.error?.code;
  return typeof code === 'string' && code !== '' ? code : null;
}

function readResponseErrorMessage(value: unknown): string | null {
  if (!isStreamEvent(value)) {
    return null;
  }

  const candidate = value as ResponseEventDetails;
  const message = candidate.message ?? candidate.error?.message ?? candidate.response?.error?.message;
  return typeof message === 'string' && message.trim() !== '' ? message : null;
}

function summarizeFailureEvent(event: unknown): string {
  return readResponseErrorMessage(event) || '模型服务返回失败事件';
}

function summarizeIncompleteEvent(event: unknown): string {
  if (!isStreamEvent(event)) {
    return '服务端未完整结束响应';
  }

  const candidate = event as ResponseEventDetails;
  const reason = candidate.response?.incomplete_details?.reason || candidate.incomplete_details?.reason;

  if (typeof reason === 'string' && reason.trim() !== '') {
    return `服务端未完整结束响应：${reason}`;
  }

  return '服务端未完整结束响应';
}

function readResponseRequestId(error: unknown): string | null {
  if (!isStreamEvent(error)) {
    return null;
  }

  const requestId = (error as ResponseEventDetails).requestID;
  return typeof requestId === 'string' && requestId.trim() !== '' ? requestId : null;
}

/** 归一化迭代期抛出的任意异常，并补上可用的 request ID。 */
function normalizeResponseStreamError(error: unknown): ProviderError {
  return annotateProviderError(classifyProviderError(error), {requestId: readResponseRequestId(error)});
}

function assertResponseClient(value: unknown): asserts value is ResponseClient {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('responses' in value) ||
    typeof value.responses !== 'object' ||
    value.responses === null ||
    !('create' in value.responses) ||
    typeof value.responses.create !== 'function'
  ) {
    throw new LlmAgentError('无法启动模型响应');
  }
}

/**
 * 从 `response.completed` 事件中提取 provider usage，缺失时返回 undefined。
 */
function extractProviderUsage(event: unknown): ProviderUsage | undefined {
  if (!isStreamEvent(event)) {
    return undefined;
  }

  const response = (event as {response?: {usage?: {input_tokens?: unknown; input_tokens_details?: {cached_tokens?: unknown}; output_tokens?: unknown}}}).response;
  const inputTokens = response?.usage?.input_tokens;
  const cachedTokens = response?.usage?.input_tokens_details?.cached_tokens;
  const outputTokens = response?.usage?.output_tokens;
  const normalizedInputTokens = typeof inputTokens === 'number' && Number.isFinite(inputTokens) ? inputTokens : undefined;
  const cacheReadInputTokens = typeof cachedTokens === 'number' && Number.isFinite(cachedTokens) ? cachedTokens : undefined;
  const normalizedOutputTokens = typeof outputTokens === 'number' && Number.isFinite(outputTokens) ? outputTokens : undefined;

  return normalizedInputTokens !== undefined || cacheReadInputTokens !== undefined || normalizedOutputTokens !== undefined ? {
    ...(normalizedInputTokens !== undefined ? {inputTokens: normalizedInputTokens} : {}),
    ...(cacheReadInputTokens !== undefined ? {cacheReadInputTokens} : {}),
    ...(normalizedOutputTokens !== undefined ? {outputTokens: normalizedOutputTokens} : {})
  } : undefined;
}

/**
 * 消费一次 Responses stream：累积 assistant 文本，同时收集已完成的 function tool calls。
 */
async function readResponseStream(
  stream: ResponseStream,
  callbacks: AgentTurnCallbacks = {},
  options: AgentTurnOptions = {},
  observer?: ProviderStreamAttemptObserver
): Promise<AgentTurnResult> {
  let draft = '';
  let completed = false;
  let usage: ProviderUsage | undefined;
  let usageInputTokens: number | undefined;
  const providerRecords: TranscriptRecord[] = [];
  const reasoningSummaryParts = new Map<string, {order: [number, number]; text: string}>();
  const toolCalls: ToolCall[] = [];
  const seenToolCallIds = new Set<string>();

  try {
    for await (const event of stream) {
      // 完成标记已确认的响应即使遇到尾部取消，也保留完整结果。
      if (completed && options.abortSignal?.aborted) break;
      throwIfAborted(options.abortSignal);

      if (isFailureEvent(event)) {
        throw createProviderError({
          message: `模型服务响应失败：${redactSensitiveText(summarizeFailureEvent(event))}`,
          code: readResponseErrorCode(event) ?? undefined,
          requestId: readResponseRequestId(event) ?? undefined
        });
      }

      if (isIncompleteEvent(event)) {
        throw new ProviderError({
          kind: 'provider_incomplete',
          message: redactSensitiveText(summarizeIncompleteEvent(event))
        });
      }

      const delta = extractTextDelta(event);

      if (delta) {
        draft += delta;
        callbacks.onToken?.(delta, draft);
      }

      const reasoningSummaryDelta = extractReasoningSummaryDelta(event);

      if (reasoningSummaryDelta) {
        const current = reasoningSummaryParts.get(reasoningSummaryDelta.key);
        reasoningSummaryParts.set(reasoningSummaryDelta.key, {
          order: reasoningSummaryDelta.order,
          text: `${current?.text || ''}${reasoningSummaryDelta.delta}`
        });
        const reasoningDraft = readReasoningSummaryText(reasoningSummaryParts);

        if (reasoningDraft) {
          callbacks.onReasoningUpdate?.({kind: 'draft', text: reasoningDraft});
        }
      }

      const reasoningSummaryDone = extractReasoningSummaryDone(event);

      if (reasoningSummaryDone) {
        reasoningSummaryParts.set(reasoningSummaryDone.key, {
          order: reasoningSummaryDone.order,
          text: reasoningSummaryDone.text
        });
        const reasoningDraft = readReasoningSummaryText(reasoningSummaryParts);

        if (reasoningDraft) {
          callbacks.onReasoningUpdate?.({kind: 'draft', text: reasoningDraft});
        }
      }

      const completedReasoning = extractCompletedReasoningSummary(event);

      if (completedReasoning) {
        const reasoningDraft = replaceCompletedReasoningParts(reasoningSummaryParts, completedReasoning);

        if (reasoningDraft) {
          // output item 完成只校正当前预览；整个 provider turn 结束前不能把累计全文当作最终摘要落盘。
          callbacks.onReasoningUpdate?.({kind: 'draft', text: reasoningDraft});
        }
      }

      const reasoningRecord = extractReasoningOutputItem(event);

      if (reasoningRecord) {
        // provider-private record 一旦落盘无法回滚，后续失败不得自动重试。
        observer?.markProviderRecord();
        providerRecords.push(reasoningRecord);
      }

      const toolCall = extractFunctionToolCall(event);

      if (toolCall && !seenToolCallIds.has(toolCall.callId)) {
        // 同一 tool call 可能通过多个完成事件露出，按 call_id 去重避免重复执行。
        observer?.markToolCall();
        seenToolCallIds.add(toolCall.callId);
        toolCalls.push(toolCall);
      }

      if (isCompletedEvent(event)) {
        completed = true;
        // 完成事件可能携带 usage，用作上下文长度真值校准；缺失时不阻断。
        usage = extractProviderUsage(event);
        usageInputTokens = usage?.inputTokens;
      }
    }
  } catch (error: unknown) {
    if (isAbortError(error) || error instanceof OpenAI.APIUserAbortError) {
      if (!completed) throw new AgentAbortError();
    } else {
      throw normalizeResponseStreamError(error);
    }
  }

  if (!completed) {
    throwIfAborted(options.abortSignal);
    throw new ProviderError({kind: 'stream_incomplete', message: '模型响应流未完成'});
  }

  const reasoningSummary = readReasoningSummaryText(reasoningSummaryParts);

  if (reasoningSummary) {
    // 只有 response.completed 确认整个 provider turn 完成后，才提交一次可持久化摘要。
    callbacks.onReasoningUpdate?.({kind: 'complete', text: reasoningSummary});
  }

  return {
    draft,
    ...(providerRecords.length > 0 ? {providerRecords} : {}),
    toolCalls,
    ...(usage ? {usage} : {}),
    usageInputTokens
  };
}

/**
 * 创建基于 OpenAI SDK 的单次 provider turn agent；tool loop 由 agent-loop-runtime 编排。
 */
class OpenAiAgent implements ProviderAgent {
  private readonly client: ResponseClient;
  private readonly config: LlmConfig;
  private readonly registry?: ToolRegistry;

  constructor(config: LlmConfig, registry: ToolRegistry | undefined, dependencies: OpenAiAgentDependencies = {}) {
    const OpenAIClient = dependencies.OpenAIClient || OpenAI;
    const makeClient = dependencies.createClient || ((clientConfig: LlmConfig) => createClient(clientConfig, OpenAIClient));
    const client = makeClient(config);
    assertResponseClient(client);

    this.client = client;
    this.config = config;
    this.registry = registry;
  }

  /**
   * 执行一次 OpenAI provider turn；工具循环由外层 runtime 继续编排。
   */
  async runTurn(records: TranscriptRecord[], callbacks: AgentTurnCallbacks = {}, options: AgentTurnOptions = {}): Promise<AgentTurnResult> {
    const request = createRequest(records, this.config, this.registry, options);

    try {
      return await runProviderStreamWithRetry({
        createStream: (signal) => this.client.responses.create(request, {signal}),
        readStream: (stream, attemptCallbacks, attemptOptions, observer) => readResponseStream(stream, attemptCallbacks, attemptOptions, observer),
        callbacks,
        options,
        maxRetries: this.config.streamMaxRetries,
        idleTimeoutMs: this.config.streamIdleTimeoutMs
      });
    } catch (error: unknown) {
      if (isAbortError(error) || error instanceof OpenAI.APIUserAbortError) {
        throw new AgentAbortError();
      }

      throw normalizeError(error, '无法启动模型响应');
    }
  }
}

function createOpenAiAgent(config: LlmConfig, registry?: ToolRegistry, dependencies: OpenAiAgentDependencies = {}): ProviderAgent {
  return new OpenAiAgent(config, registry, dependencies);
}

export {
  createOpenAiAgent,
  createRequest,
  extractTextDelta,
  isCompletedEvent,
  readResponseStream
};

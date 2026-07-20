import OpenAI from 'openai';

import {LlmAgentError, normalizeError, redactSensitiveText} from '../agent-errors';
import {createPromptCacheKey} from '../prompt-cache';
import {convertTranscriptToOpenAiInput, createOpenAiReasoningRecord} from './transcript-converter';
import {convertToolDefinitionsToOpenAiTools, extractFunctionToolCall} from './tool-converter';

import {AgentAbortError, isAbortError, throwIfAborted} from '../../types/agent';
import type {AgentTurnCallbacks, AgentTurnOptions, AgentTurnResult, LlmConfig, OpenAiAgentDependencies, ProviderAgent, ProviderUsage} from '../../types/agent';
import type {ToolCall, ToolRegistry} from '../../types/tool';
import type {TranscriptRecord} from '../../types/transcript';
import type {OpenAiFunctionTool} from './tool-converter';
import type {OpenAiInputItem} from './transcript-converter';

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
type ResponseStreamFactory = () => Promise<ResponseStream>;

type ResponseClient = {
  responses: {
    create: (request: ResponseCreateRequest, options?: {signal?: AbortSignal}) => Promise<ResponseStream>;
  };
};

const OPENAI_MAX_RETRIES = 3;
const RESPONSE_STREAM_RETRY_DELAY_MS = 100;
const RETRYABLE_PROCESSING_ERROR_TEXT = 'An error occurred while processing your request. You can retry your request';

class RetryableResponseStreamError extends LlmAgentError {}

function createClient(config: LlmConfig, OpenAIClient: new (options: {apiKey: string; baseURL?: string; defaultHeaders?: Record<string, string>; maxRetries?: number}) => unknown): unknown {
  return new OpenAIClient({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: config.headers,
    maxRetries: OPENAI_MAX_RETRIES
  });
}

/**
 * 根据当前 transcript 快照创建 Responses API 请求；压缩用途不暴露工具或 reasoning 配置。
 */
function createRequest(records: TranscriptRecord[], config: LlmConfig, registry?: ToolRegistry, options: AgentTurnOptions = {}): ResponseCreateRequest {
  const toolDefinitions = !options.isCompaction && registry && !registry.isEmpty() ? registry.listDefinitions() : [];
  const request: ResponseCreateRequest = {
    input: convertTranscriptToOpenAiInput(records),
    model: config.model,
    prompt_cache_key: createPromptCacheKey(records, config, toolDefinitions),
    stream: true
  };

  if (!options.isCompaction && (config.reasoningEffort || config.reasoningSummary)) {
    request.reasoning = {
      ...(config.reasoningEffort ? {effort: config.reasoningEffort} : {}),
      ...(config.reasoningSummary ? {summary: config.reasoningSummary} : {})
    };
  }

  if (toolDefinitions.length > 0) {
    request.tools = convertToolDefinitionsToOpenAiTools(toolDefinitions);
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

function isRetryableResponseStreamError(error: unknown): boolean {
  return error instanceof RetryableResponseStreamError ||
    readResponseErrorCode(error) === 'server_error' ||
    readResponseErrorMessage(error)?.includes(RETRYABLE_PROCESSING_ERROR_TEXT) === true;
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

function normalizeResponseStreamError(error: unknown): LlmAgentError {
  const normalized = normalizeError(error, '模型响应流异常');
  const requestId = readResponseRequestId(error);
  const message = requestId && !normalized.message.includes(requestId)
    ? `${normalized.message}（request ID: ${redactSensitiveText(requestId)}）`
    : normalized.message;

  if (isRetryableResponseStreamError(error)) {
    return new RetryableResponseStreamError(message);
  }

  return message === normalized.message ? normalized : new LlmAgentError(message);
}

function createFailureEventError(event: unknown): LlmAgentError {
  const message = `模型服务响应失败：${redactSensitiveText(summarizeFailureEvent(event))}`;
  return isRetryableResponseStreamError(event)
    ? new RetryableResponseStreamError(message)
    : new LlmAgentError(message);
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
async function readResponseStream(stream: ResponseStream, callbacks: AgentTurnCallbacks = {}, options: AgentTurnOptions = {}): Promise<AgentTurnResult> {
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
      throwIfAborted(options.abortSignal);

      if (isFailureEvent(event)) {
        throw createFailureEventError(event);
      }

      if (isIncompleteEvent(event)) {
        throw new LlmAgentError(redactSensitiveText(summarizeIncompleteEvent(event)));
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
      }

      const reasoningSummaryDone = extractReasoningSummaryDone(event);

      if (reasoningSummaryDone) {
        reasoningSummaryParts.set(reasoningSummaryDone.key, {
          order: reasoningSummaryDone.order,
          text: reasoningSummaryDone.text
        });
      }

      const reasoningRecord = extractReasoningOutputItem(event);

      if (reasoningRecord) {
        providerRecords.push(reasoningRecord);
      }

      const toolCall = extractFunctionToolCall(event);

      if (toolCall && !seenToolCallIds.has(toolCall.callId)) {
        // 同一 tool call 可能通过多个完成事件露出，按 call_id 去重避免重复执行。
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
    if (isAbortError(error) || options.abortSignal?.aborted) {
      throwIfAborted(options.abortSignal);
    }

    throw normalizeResponseStreamError(error);
  }

  if (!completed) {
    throw new LlmAgentError('模型响应流未完成');
  }

  const reasoningSummary = readReasoningSummaryText(reasoningSummaryParts);

  return {
    draft,
    ...(providerRecords.length > 0 ? {providerRecords} : {}),
    ...(reasoningSummary ? {reasoningSummary} : {}),
    toolCalls,
    ...(usage ? {usage} : {}),
    usageInputTokens
  };
}

/**
 * 等待一次短暂重试退避，并让 turn 级取消信号立即中断等待。
 */
function waitForResponseStreamRetry(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      reject(new AgentAbortError());
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, RESPONSE_STREAM_RETRY_DELAY_MS);

    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

/**
 * 创建并消费 Responses stream，在无文本输出的指定服务端临时错误后最多重新创建一次 stream。
 */
async function runResponseStreamWithRetry(createStream: ResponseStreamFactory, callbacks: AgentTurnCallbacks = {}, options: AgentTurnOptions = {}): Promise<AgentTurnResult> {
  let retried = false;

  while (true) {
    throwIfAborted(options.abortSignal);
    const stream = await createStream();
    let emittedText = false;
    const attemptCallbacks: AgentTurnCallbacks = {
      onToken(delta, draft) {
        if (delta !== '') {
          emittedText = true;
        }

        callbacks.onToken?.(delta, draft);
      }
    };

    try {
      return await readResponseStream(stream, attemptCallbacks, options);
    } catch (error: unknown) {
      const canRetry = !retried &&
        !emittedText &&
        !options.isCompaction &&
        !options.abortSignal?.aborted &&
        isRetryableResponseStreamError(error);

      if (!canRetry) {
        throw error;
      }

      retried = true;
      await waitForResponseStreamRetry(options.abortSignal);
    }
  }
}

/**
 * 创建基于 OpenAI SDK 的单次 provider turn agent；tool loop 由 agent-loop-runtime 编排。
 */
class OpenAiAgent implements ProviderAgent {
  private readonly client: ResponseClient;
  private readonly config: LlmConfig;
  private readonly registry: ToolRegistry;

  constructor(config: LlmConfig, registry: ToolRegistry, dependencies: OpenAiAgentDependencies = {}) {
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
      return await runResponseStreamWithRetry(
        () => this.client.responses.create(request, {signal: options.abortSignal}),
        callbacks,
        options
      );
    } catch (error: unknown) {
      if (isAbortError(error) || options.abortSignal?.aborted) {
        throwIfAborted(options.abortSignal);
      }

      throw normalizeError(error, '无法启动模型响应');
    }
  }
}

function createOpenAiAgent(config: LlmConfig, registry: ToolRegistry, dependencies: OpenAiAgentDependencies = {}): ProviderAgent {
  return new OpenAiAgent(config, registry, dependencies);
}

export {
  createOpenAiAgent,
  createRequest,
  extractTextDelta,
  isCompletedEvent,
  readResponseStream,
  runResponseStreamWithRetry
};

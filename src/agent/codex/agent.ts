import OpenAI from 'openai';

import {LlmAgentError, normalizeError} from '../agent-errors';
import {createPromptCacheKey} from '../prompt-cache';
import {readResponseStream} from '../openai-responses/agent';
import {convertToolDefinitionsToOpenAiTools} from '../openai-responses/tool-converter';
import {convertTranscriptToOpenAiInput} from '../openai-responses/transcript-converter';

import {resolveCodexOAuthCredential} from '../../config/codex-oauth';
import {isAbortError, throwIfAborted} from '../../types/agent';
import type {AgentTurnCallbacks, AgentTurnOptions, AgentTurnResult, CodexAgentDependencies, CodexOAuthCredential, CodexOAuthRuntimeConfig, LlmConfig, ProviderAgent} from '../../types/agent';
import type {ToolRegistry} from '../../types/tool';
import type {TranscriptRecord} from '../../types/transcript';
import type {OpenAiFunctionTool} from '../openai-responses/tool-converter';
import type {OpenAiInputItem} from '../openai-responses/transcript-converter';

type CodexCreateRequest = {
  include: string[];
  input: OpenAiInputItem[];
  instructions: string;
  model: string;
  parallel_tool_calls?: boolean;
  prompt_cache_key: string;
  reasoning?: {effort?: NonNullable<LlmConfig['reasoningEffort']>};
  stream: true;
  store: false;
  text: {verbosity: 'low'};
  tool_choice?: 'auto';
  tools?: OpenAiFunctionTool[];
};

type CodexStream = AsyncIterable<unknown>;

type CodexResponseClient = {
  responses: {
    create: (request: CodexCreateRequest, options?: {signal?: AbortSignal}) => Promise<CodexStream>;
  };
};

const CODEX_MAX_RETRIES = 3;

function createClient(config: LlmConfig, OpenAIClient: new (options: {apiKey: string; baseURL?: string; defaultHeaders?: Record<string, string>; maxRetries?: number}) => unknown): unknown {
  return new OpenAIClient({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: config.headers,
    maxRetries: CODEX_MAX_RETRIES
  });
}

function assertCodexResponseClient(value: unknown): asserts value is CodexResponseClient {
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
 * 创建 ChatGPT Codex 后端接受的 Responses 请求形态。
 */
function createCodexRequest(records: TranscriptRecord[], config: LlmConfig, registry?: ToolRegistry): CodexCreateRequest {
  const toolDefinitions = registry && !registry.isEmpty() ? registry.listDefinitions() : [];
  const input = convertTranscriptToOpenAiInput(records).filter((item) => !('role' in item) || item.role !== 'system');
  const instructions = records.find((record) => record.role === 'system')?.text.trim();
  const request: CodexCreateRequest = {
    input,
    model: config.model,
    prompt_cache_key: createPromptCacheKey(records, config, toolDefinitions),
    stream: true,
    store: false,
    instructions: instructions || 'You are a helpful assistant.',
    text: {verbosity: 'low'},
    include: ['reasoning.encrypted_content']
  };

  if (config.reasoningEffort) {
    request.reasoning = {effort: config.reasoningEffort};
  }

  if (toolDefinitions.length > 0) {
    request.tools = convertToolDefinitionsToOpenAiTools(toolDefinitions, {strict: undefined});
    request.tool_choice = 'auto';
    request.parallel_tool_calls = true;
  }

  return request;
}

/**
 * 基于本机 Codex OAuth auth.json 创建 ChatGPT Codex provider turn。
 */
class CodexAgent implements ProviderAgent {
  private readonly config: LlmConfig;
  private readonly makeClient: (config: LlmConfig) => unknown;
  private readonly registry: ToolRegistry;
  private readonly resolveCredential: (config: CodexOAuthRuntimeConfig) => Promise<CodexOAuthCredential>;

  constructor(config: LlmConfig, registry: ToolRegistry, dependencies: CodexAgentDependencies = {}) {
    const OpenAIClient = dependencies.OpenAIClient || OpenAI;
    this.config = config;
    this.makeClient = dependencies.createClient || ((config: LlmConfig) => createClient(config, OpenAIClient));
    this.registry = registry;
    this.resolveCredential = dependencies.resolveCodexOAuthCredential || resolveCodexOAuthCredential;
  }

  /**
   * 执行一次 Codex provider turn，并复用 Responses stream 事件读取逻辑。
   */
  async runTurn(records: TranscriptRecord[], callbacks: AgentTurnCallbacks = {}, options: AgentTurnOptions = {}): Promise<AgentTurnResult> {
    let stream: CodexStream;

    try {
      const {client, config} = await this.resolveRuntimeClient();
      stream = await client.responses.create(createCodexRequest(records, config, this.registry), {signal: options.abortSignal});
    } catch (error: unknown) {
      if (isAbortError(error) || options.abortSignal?.aborted) {
        throwIfAborted(options.abortSignal);
      }

      throw normalizeError(error, '无法启动模型响应');
    }

    return readResponseStream(stream, callbacks, options);
  }

  private async resolveRuntimeClient(): Promise<{client: CodexResponseClient; config: LlmConfig}> {
    if (!this.config.codexOAuth) {
      throw new LlmAgentError('Codex OAuth 配置缺失');
    }

    const credential = await this.resolveCredential(this.config.codexOAuth);
    const runtimeConfig: LlmConfig = {
      ...this.config,
      apiKey: credential.accessToken,
      headers: {
        ...(this.config.headers || {}),
        'OpenAI-Beta': 'responses=experimental',
        originator: 'echo-tui',
        ...(credential.accountId ? {'ChatGPT-Account-ID': credential.accountId} : {})
      }
    };
    const client = this.makeClient(runtimeConfig);
    assertCodexResponseClient(client);

    return {client, config: runtimeConfig};
  }
}

function createCodexAgent(config: LlmConfig, registry: ToolRegistry, dependencies: CodexAgentDependencies = {}): ProviderAgent {
  return new CodexAgent(config, registry, dependencies);
}

export {
  createCodexAgent,
  createCodexRequest
};

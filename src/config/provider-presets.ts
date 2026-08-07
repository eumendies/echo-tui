import {CODEX_OAUTH_BACKEND_BASE_URL} from './codex-oauth';
import type {AgentType} from '../types/agent';

type ProviderBaseUrlMode = 'hidden' | 'optional' | 'required' | 'fixed';

type ProviderPreset = {
  id: string;
  label: string;
  description: string;
  agentType: AgentType;
  apiKeyRequired?: boolean;
  defaultApiKey?: string; // 免 key preset 的运行时占位 key；openai SDK 不接受空字符串。
  baseURLMode: ProviderBaseUrlMode;
  baseURL?: string;
  codexOAuth?: boolean;
  headers?: Record<string, string>;
  suggestedModels?: string[];
};

const DEFAULT_PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'fake-agent',
    label: 'Fake Agent',
    description: 'echo-tui 内置 fake agent；无需 API key，用于首次启动和本地演示。',
    agentType: 'fake',
    baseURLMode: 'hidden',
    suggestedModels: ['echo-fake-agent']
  },
  {
    id: 'openai-responses-api',
    label: 'OpenAI Responses API',
    description: '官方 OpenAI Responses API 或兼容 Responses 协议的服务。',
    agentType: 'openai',
    baseURLMode: 'optional',
    suggestedModels: ['gpt-4.1', 'gpt-4o']
  },
  {
    id: 'openai-codex-oauth',
    label: 'OpenAI Codex OAuth',
    description: '读取本机 Codex auth.json，通过 ChatGPT Codex 后端使用订阅模型。',
    agentType: 'codex',
    apiKeyRequired: false,
    baseURLMode: 'fixed',
    baseURL: CODEX_OAUTH_BACKEND_BASE_URL,
    codexOAuth: true,
    suggestedModels: ['gpt-5.5', 'gpt-5.4']
  },
  {
    id: 'openai-chat-compatible-api',
    label: 'OpenAI Chat Compatible API',
    description: 'OpenAI Chat Completions 兼容接口，例如内部网关或本地服务。',
    agentType: 'openai-chat',
    baseURLMode: 'optional',
    suggestedModels: ['gpt-4o', 'qwen2.5-coder']
  },
  {
    id: 'ollama',
    label: 'Ollama (Local)',
    description: '本机 Ollama 服务，走 OpenAI 兼容端点调用本地模型；无需 API key。',
    agentType: 'openai-chat',
    apiKeyRequired: false,
    defaultApiKey: 'ollama',
    baseURLMode: 'fixed',
    baseURL: 'http://localhost:11434/v1',
    suggestedModels: ['llama3.1:8b', 'qwen2.5-coder:7b', 'deepseek-r1:7b']
  },
  {
    id: 'anthropic-compatible-api',
    label: 'Anthropic Compatible API',
    description: 'Anthropic Messages API 或兼容 Anthropic 协议的服务。',
    agentType: 'anthropic',
    baseURLMode: 'optional',
    suggestedModels: ['claude-sonnet-4', 'claude-opus-4']
  },
  {
    id: 'xiaomi-api',
    label: 'Xiaomi API',
    description: '小米 API 服务。',
    agentType: 'openai-chat',
    baseURLMode: 'fixed',
    baseURL: 'https://api.xiaomimimo.com/v1'
  },
  {
    id: 'xiaomi-mimo-token-plan',
    label: 'Xiaomi Mimo Token Plan',
    description: '小米 Mimo token plan 服务。',
    agentType: 'openai-chat',
    baseURLMode: 'fixed',
    baseURL: 'https://token-plan-cn.xiaomimimo.com/v1'
  },
  {
    id: 'deepseek-api',
    label: 'DeepSeek API',
    description: 'DeepSeek API 服务。',
    agentType: 'openai-chat',
    baseURLMode: 'fixed',
    baseURL: 'https://api.deepseek.com'
  },
  {
    id: "z.ai-api-cn",
    label: "Z.ai API (CN)",
    description: "智谱 API 服务 (CN)。",
    agentType: "openai-chat",
    baseURLMode: "fixed",
    baseURL: "https://open.bigmodel.cn/api/paas/v4"
  },
  {
    id: "z.ai-coding-plan-cn",
    label: "Z.ai Coding Plan (CN)",
    description: "智谱 Coding Plan 服务 (CN)。",
    agentType: "openai-chat",
    baseURLMode: "fixed",
    baseURL: "https://open.bigmodel.cn/api/coding/paas/v4"
  },
  {
    id: "z.ai-api",
    label: "Z.ai API",
    description: "智谱 API 服务。",
    agentType: "openai-chat",
    baseURLMode: "fixed",
    baseURL: "https://api.z.ai/api/paas/v4"
  },
  {
    id: "z.ai-coding-plan",
    label: "Z.ai Coding Plan",
    description: "智谱 Coding Plan 服务。",
    agentType: "openai-chat",
    baseURLMode: "fixed",
    baseURL: "https://api.z.ai/api/coding/paas/v4"
  },
  {
    id: "kimi-api-cn",
    label: "Kimi API (CN)",
    description: "Kimi API 服务 (CN)。",
    agentType: "openai-chat",
    baseURLMode: "fixed",
    baseURL: "https://api.moonshot.cn/v1"
  },
  {
    id: "kimi-api",
    label: "Kimi API",
    description: "Kimi API 服务。",
    agentType: "openai-chat",
    baseURLMode: "fixed",
    baseURL: "https://api.moonshot.ai/v1"
   },
   {
    id: "minimax-api",
    label: "Minimax API",
    description: "Minimax API 服务。",
    agentType: "openai-chat",
    baseURLMode: "fixed",
    baseURL: "https://api.minimaxi.com/v1"
   },
   {
    id: "minimax-token-plan",
    label: "Minimax Token Plan",
    description: "Minimax Token Plan 服务。",
    agentType: "openai-chat",
    baseURLMode: "fixed",
    baseURL: "https://api.minimaxi.com/v1"
   },
   {
    id: "stepfun-api",
    label: "StepFun API",
    description: "阶跃星辰 API 服务。",
    agentType: "openai-chat",
    baseURLMode: "fixed",
    baseURL: "https://api.stepfun.com/v1"
   },
   {
    id: "stepfun-step-plan",
    label: "StepFun Step Plan",
    description: "阶跃星辰 Step Plan 服务。",
    agentType: "openai-chat",
    baseURLMode: "fixed",
    baseURL: "https://api.stepfun.com/step_plan/v1/"
   },
   {
    id: "openrouter-api",
    label: "OpenRouter API",
    description: "OpenRouter API 服务。",
    agentType: "openai-chat",
    baseURLMode: "fixed",
    baseURL: "https://openrouter.ai/api/v1"
   }
];

function listProviderPresets(): ProviderPreset[] {
  return DEFAULT_PROVIDER_PRESETS.filter((preset) => preset.agentType !== 'fake').map((preset) => ({
    ...preset,
    headers: preset.headers ? {...preset.headers} : undefined,
    suggestedModels: preset.suggestedModels ? [...preset.suggestedModels] : undefined
  }));
}

function getProviderPreset(presetId: string): ProviderPreset | undefined {
  const preset = DEFAULT_PROVIDER_PRESETS.find((candidate) => candidate.id === presetId);

  return preset ? {
    ...preset,
    headers: preset.headers ? {...preset.headers} : undefined,
    suggestedModels: preset.suggestedModels ? [...preset.suggestedModels] : undefined
  } : undefined;
}

function providerRequiresApiKey(preset: ProviderPreset): boolean {
  return preset.apiKeyRequired ?? preset.agentType !== 'fake';
}

export {
  getProviderPreset,
  listProviderPresets,
  providerRequiresApiKey
};

export type {
  ProviderBaseUrlMode,
  ProviderPreset
};

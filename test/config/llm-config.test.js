const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_BASH_TOOL_MAX_OUTPUT_BYTES,
  DEFAULT_BASH_TOOL_TIMEOUT_MS,
  DEFAULT_CONTEXT_WINDOW,
  LlmConfigError,
  readLlmConfig,
  readLlmModelConfigInfo,
  resolveContextWindow
} = require('../../src/config/llm-config');

const DEFAULT_TOOLS = {
  bash: {
    timeoutMs: DEFAULT_BASH_TOOL_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_BASH_TOOL_MAX_OUTPUT_BYTES
  }
};

const OPENAI_PRESET = 'openai-responses-api';
const CODEX_OAUTH_PRESET = 'openai-codex-oauth';
const OPENAI_CHAT_PRESET = 'openai-chat-compatible-api';
const ANTHROPIC_PRESET = 'anthropic-compatible-api';
const XIAOMI_MIMO_TOKEN_PLAN_PRESET = 'xiaomi-mimo-token-plan';
const FAKE_PRESET = 'fake-agent';

function readConfigFrom(value) {
  return () => value;
}

function readConfigError(error) {
  return () => {
    throw error;
  };
}

test('resolveContextWindow prefers explicit model configuration', () => {
  assert.equal(resolveContextWindow({ model: 'gpt-5', contextWindow: 64_000 }), 64_000);
});

test('resolveContextWindow matches built-in model names exactly and case-insensitively', () => {
  assert.equal(resolveContextWindow({ model: 'GPT-5.4' }), 1_050_000);
  assert.equal(resolveContextWindow({ model: 'gpt-5.4-2026-03-05' }), 1_050_000);
  assert.equal(resolveContextWindow({ model: 'claude-sonnet-4' }), 1_000_000);
  assert.equal(resolveContextWindow({ model: 'claude-sonnet-4-6' }), 1_000_000);
  assert.equal(resolveContextWindow({ model: 'gemini-3.1-pro-preview' }), 1_048_576);
  assert.equal(resolveContextWindow({ model: 'deepseek-chat' }), 131_072);
  assert.equal(resolveContextWindow({ model: 'qwen3-coder-plus' }), 997_952);
  assert.equal(resolveContextWindow({ model: 'glm-5' }), 200_000);
  assert.equal(resolveContextWindow({ model: 'kimi-k2.5' }), 262_144);
  assert.equal(resolveContextWindow({ model: 'MiniMax-M2.5' }), 1_000_000);
  assert.equal(resolveContextWindow({ model: 'mimo-v2.5' }), 1_048_576);
  assert.equal(resolveContextWindow({ model: 'doubao-seed-2-0-pro-260215' }), 256_000);
});

test('resolveContextWindow no longer uses broad family substring matches', () => {
  assert.equal(resolveContextWindow({ model: 'gpt-4-custom' }), DEFAULT_CONTEXT_WINDOW);
  assert.equal(resolveContextWindow({ model: 'qwen-unknown-model' }), DEFAULT_CONTEXT_WINDOW);
  assert.equal(resolveContextWindow({ model: 'gateway/deepseek-chat' }), DEFAULT_CONTEXT_WINDOW);
});

test('readLlmConfig reads selected profile values without touching the real path', () => {
  const config = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'default',
        providers: {
          default: {
            preset: OPENAI_PRESET,
            apiKey: 'test-api-key',
            baseURL: 'https://example.invalid/v1'
          }
        },
        models: [
          { id: 'default', provider: 'default', model: 'test-model' }
        ]
      }
    }))
  });

  assert.deepEqual(config, {
    apiKey: 'test-api-key',
    agentType: 'openai',
    baseURL: 'https://example.invalid/v1',
    model: 'test-model',
    contextWindow: undefined,
    tools: DEFAULT_TOOLS
  });
});

test('readLlmConfig accepts fake-agent provider without API key', () => {
  const config = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'default',
        providers: {
          default: { preset: FAKE_PRESET, label: 'Fake Agent' }
        },
        models: [
          { id: 'default', provider: 'default', model: 'echo-fake-agent', contextWindow: 128000 }
        ]
      }
    }))
  });

  assert.deepEqual(config, {
    apiKey: '',
    agentType: 'fake',
    baseURL: undefined,
    model: 'echo-fake-agent',
    contextWindow: 128000,
    tools: DEFAULT_TOOLS
  });
});

test('readLlmConfig accepts Codex OAuth provider without API key', () => {
  const config = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'codex',
        providers: {
          codex: {
            preset: CODEX_OAUTH_PRESET,
            codexAuthFile: '/tmp/codex-auth.json'
          }
        },
        models: [
          { id: 'codex', provider: 'codex', model: 'gpt-5.5' }
        ]
      }
    }))
  });

  assert.deepEqual(config, {
    apiKey: '',
    agentType: 'codex',
    baseURL: 'https://chatgpt.com/backend-api/codex',
    codexOAuth: {authFilePath: '/tmp/codex-auth.json'},
    model: 'gpt-5.5',
    contextWindow: undefined,
    tools: DEFAULT_TOOLS
  });
});

test('readLlmConfig reads Codex OAuth reasoning effort', () => {
  const config = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'codex',
        providers: {
          codex: {
            preset: CODEX_OAUTH_PRESET,
            codexAuthFile: '/tmp/codex-auth.json'
          }
        },
        models: [
          { id: 'codex', provider: 'codex', model: 'gpt-5.5', reasoning: {effort: 'high'} }
        ]
      }
    }))
  });

  assert.equal(config.reasoningEffort, 'high');
});

test('readLlmConfig allows omitted baseURL and output length limit', () => {
  const config = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        providers: {
          default: { preset: OPENAI_PRESET, apiKey: 'test-api-key' }
        },
        models: [
          { id: 'default', provider: 'default', model: 'test-model' }
        ]
      }
    }))
  });

  assert.equal(config.baseURL, undefined);
  assert.deepEqual(config, {
    apiKey: 'test-api-key',
    agentType: 'openai',
    baseURL: undefined,
    model: 'test-model',
    contextWindow: undefined,
    tools: DEFAULT_TOOLS
  });
});

test('readLlmConfig resolves selected multi-model profile with referenced provider config', () => {
  const config = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'deep',
        providers: {
          shared: {
            preset: OPENAI_PRESET,
            apiKey: 'shared-api-key',
            baseURL: 'https://shared.example/v1'
          }
        },
        models: [
          { id: 'fast', provider: 'shared', model: 'gpt-fast' },
          { id: 'deep', provider: 'shared', model: 'gpt-deep' }
        ]
      }
    }))
  });

  assert.deepEqual(config, {
    apiKey: 'shared-api-key',
    agentType: 'openai',
    baseURL: 'https://shared.example/v1',
    model: 'gpt-deep',
    contextWindow: undefined,
    tools: DEFAULT_TOOLS
  });
});

test('readLlmConfig supports multiple provider configs', () => {
  const config = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'other-provider',
        providers: {
          shared: {
            preset: OPENAI_PRESET,
            apiKey: 'shared-api-key',
            baseURL: 'https://shared.example/v1'
          },
          other: {
            preset: OPENAI_PRESET,
            apiKey: 'profile-api-key',
            baseURL: 'https://profile.example/v1'
          }
        },
        models: [
          { id: 'fast', provider: 'shared', model: 'gpt-fast' },
          {
            id: 'other-provider',
            provider: 'other',
            model: 'provider-model'
          }
        ]
      }
    }))
  });

  assert.deepEqual(config, {
    apiKey: 'profile-api-key',
    agentType: 'openai',
    baseURL: 'https://profile.example/v1',
    model: 'provider-model',
    contextWindow: undefined,
    tools: DEFAULT_TOOLS
  });
});

test('readLlmConfig ignores user configured system prompt fields', () => {
  const config = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'custom',
        systemPrompt: 'user prompt must be ignored',
        prompt: 'user prompt must also be ignored',
        providers: {
          shared: {
            preset: OPENAI_PRESET,
            apiKey: 'shared-api-key',
            baseURL: 'https://shared.example/v1'
          }
        },
        models: [
          {
            id: 'custom',
            provider: 'shared',
            model: 'provider-model',
            systemPrompt: 'profile system prompt must be ignored',
            prompt: 'profile prompt must be ignored'
          }
        ]
      }
    }))
  });

  assert.deepEqual(config, {
    apiKey: 'shared-api-key',
    agentType: 'openai',
    baseURL: 'https://shared.example/v1',
    model: 'provider-model',
    contextWindow: undefined,
    tools: DEFAULT_TOOLS
  });
  assert.equal('systemPrompt' in config, false);
  assert.equal('prompt' in config, false);
});

test('readLlmConfig uses the first profile when selectedModel is omitted', () => {
  const config = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        providers: {
          shared: { preset: OPENAI_PRESET, apiKey: 'shared-api-key' }
        },
        models: [
          { id: 'fast', provider: 'shared', model: 'gpt-fast' },
          { id: 'deep', provider: 'shared', model: 'gpt-deep' }
        ]
      }
    }))
  });

  assert.deepEqual(config, {
    apiKey: 'shared-api-key',
    agentType: 'openai',
    baseURL: undefined,
    model: 'gpt-fast',
    contextWindow: undefined,
    tools: DEFAULT_TOOLS
  });
});

test('readLlmConfig uses the first profile when selectedModel points to a removed profile', () => {
  const config = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'missing',
        providers: {
          shared: { preset: OPENAI_PRESET, apiKey: 'shared-api-key' }
        },
        models: [
          { id: 'fast', provider: 'shared', model: 'gpt-fast' },
          { id: 'deep', provider: 'shared', model: 'gpt-deep' }
        ]
      }
    }))
  });

  assert.deepEqual(config, {
    apiKey: 'shared-api-key',
    agentType: 'openai',
    baseURL: undefined,
    model: 'gpt-fast',
    contextWindow: undefined,
    tools: DEFAULT_TOOLS
  });
});

test('readLlmConfig reads explicit bash tool limits', () => {
  const config = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        providers: {
          shared: { preset: OPENAI_PRESET, apiKey: 'shared-api-key' }
        },
        models: [
          { id: 'fast', provider: 'shared', model: 'gpt-fast' }
        ]
      },
      tools: {
        bash: {
          timeoutMs: 2000,
          maxOutputBytes: 4096
        }
      }
    }))
  });

  assert.deepEqual(config.tools, {
    bash: {
      timeoutMs: 2000,
      maxOutputBytes: 4096
    }
  });
});

test('readLlmConfig normalizes invalid bash tool settings to safe defaults', () => {
  const config = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        providers: {
          shared: { preset: OPENAI_PRESET, apiKey: 'shared-api-key' }
        },
        models: [
          { id: 'fast', provider: 'shared', model: 'gpt-fast' }
        ]
      },
      tools: {
        bash: {
          timeoutMs: 100,
          maxOutputBytes: 1
        }
      }
    }))
  });

  assert.deepEqual(config.tools, DEFAULT_TOOLS);
});

test('readLlmConfig resolves selected provider-backed model config', () => {
  const config = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'openai-deep',
        providers: {
          example: {
            preset: OPENAI_PRESET,
            apiKey: 'example-api-key',
            baseURL: 'https://provider.example/v1'
          },
          openai: {
            preset: OPENAI_PRESET,
            apiKey: 'openai-api-key'
          }
        },
        models: [
          { id: 'example-fast', provider: 'example', model: 'example-fast' },
          { id: 'openai-deep', provider: 'openai', model: 'gpt-4.1', contextWindow: 1000000 }
        ]
      }
    }))
  });

  assert.deepEqual(config, {
    apiKey: 'openai-api-key',
    agentType: 'openai',
    baseURL: undefined,
    model: 'gpt-4.1',
    contextWindow: 1000000,
    tools: DEFAULT_TOOLS
  });
});

test('readLlmConfig resolves selected model reasoning effort', () => {
  const config = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'deep',
        providers: {
          openai: { preset: OPENAI_PRESET, apiKey: 'openai-api-key' }
        },
        models: [
          {
            id: 'deep',
            provider: 'openai',
            model: 'gpt-deep',
            reasoning: { effort: 'high' }
          }
        ]
      }
    }))
  });

  assert.equal(config.reasoningEffort, 'high');
});

test('readLlmConfig resolves selected model reasoning summary', () => {
  const config = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'deep',
        providers: {
          openai: { preset: OPENAI_PRESET, apiKey: 'openai-api-key' }
        },
        models: [
          {
            id: 'deep',
            provider: 'openai',
            model: 'gpt-deep',
            reasoning: { effort: 'high', summary: 'auto' }
          }
        ]
      }
    }))
  });

  assert.equal(config.reasoningEffort, 'high');
  assert.equal(config.reasoningSummary, 'auto');
});

test('readLlmConfig resolves provider-backed headers', () => {
  const config = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'llmbox-gpt55',
        providers: {
          llmbox: {
            preset: OPENAI_PRESET,
            apiKey: 'llmbox-api-key',
            baseURL: 'https://llmbox.example/v1',
            headers: {
              'x-source': 'echo-tui'
            }
          }
        },
        models: [
          { id: 'llmbox-gpt55', provider: 'llmbox', model: 'gpt-5.5' }
        ]
      }
    }))
  });

  assert.deepEqual(config.headers, {'x-source': 'echo-tui'});
  assert.equal(config.baseURL, 'https://llmbox.example/v1');
  assert.equal(config.model, 'gpt-5.5');
});

test('readLlmConfig resolves openai-chat provider-backed model config', () => {
  const config = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'chat',
        providers: {
          chat: {
            preset: OPENAI_CHAT_PRESET,
            apiKey: 'chat-api-key',
            baseURL: 'https://chat.example/v1'
          }
        },
        models: [
          { id: 'chat', provider: 'chat', model: 'gpt-chat', contextWindow: 64000 }
        ]
      }
    }))
  });

  assert.deepEqual(config, {
    apiKey: 'chat-api-key',
    agentType: 'openai-chat',
    baseURL: 'https://chat.example/v1',
    model: 'gpt-chat',
    contextWindow: 64000,
    tools: DEFAULT_TOOLS
  });
});

test('readLlmConfig resolves Xiaomi Mimo token plan preset with fixed OpenAI Chat base URL', () => {
  const config = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'mimo',
        providers: {
          mimo: {
            preset: XIAOMI_MIMO_TOKEN_PLAN_PRESET,
            apiKey: 'mimo-api-key',
            baseURL: 'https://ignored.example/v1'
          }
        },
        models: [
          { id: 'mimo', provider: 'mimo', model: 'mimo-model', contextWindow: 128000 }
        ]
      }
    }))
  });

  assert.deepEqual(config, {
    apiKey: 'mimo-api-key',
    agentType: 'openai-chat',
    baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    model: 'mimo-model',
    contextWindow: 128000,
    tools: DEFAULT_TOOLS
  });
});

test('readLlmConfig resolves anthropic provider-backed model config', () => {
  const config = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'claude',
        providers: {
          anthropic: {
            preset: ANTHROPIC_PRESET,
            apiKey: 'anthropic-api-key',
            baseURL: 'https://anthropic.example/v1'
          },
          openai: {
            preset: OPENAI_PRESET,
            apiKey: 'openai-api-key'
          }
        },
        models: [
          { id: 'gpt', provider: 'openai', model: 'gpt-4.1' },
          { id: 'claude', provider: 'anthropic', model: 'claude-sonnet-4', contextWindow: 200000 }
        ]
      }
    }))
  });

  assert.deepEqual(config, {
    apiKey: 'anthropic-api-key',
    agentType: 'anthropic',
    baseURL: 'https://anthropic.example/v1',
    model: 'claude-sonnet-4',
    contextWindow: 200000,
    tools: DEFAULT_TOOLS
  });
});

test('readLlmConfig keeps Chat and Anthropic effort while ignoring OpenAI-only reasoning summary', () => {
  const chatConfig = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'chat',
        providers: {
          chat: { preset: OPENAI_CHAT_PRESET, apiKey: 'chat-api-key' }
        },
        models: [
          { id: 'chat', provider: 'chat', model: 'gpt-chat', reasoning: { effort: 'high', summary: 'auto' } }
        ]
      }
    }))
  });
  const anthropicConfig = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'claude',
        providers: {
          anthropic: { preset: ANTHROPIC_PRESET, apiKey: 'anthropic-api-key' }
        },
        models: [
          { id: 'claude', provider: 'anthropic', model: 'claude-sonnet-4', reasoning: { effort: 'high', summary: 'auto' } }
        ]
      }
    }))
  });

  const responsesConfig = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'gpt',
        providers: {
          openai: { preset: OPENAI_PRESET, apiKey: 'openai-api-key' }
        },
        models: [
          { id: 'gpt', provider: 'openai', model: 'gpt-4.1', reasoning: { effort: 'medium', summary: 'auto' } }
        ]
      }
    }))
  });

  assert.equal(chatConfig.agentType, 'openai-chat');
  assert.equal(chatConfig.reasoningEffort, 'high');
  assert.equal(chatConfig.reasoningSummary, undefined);
  assert.equal(responsesConfig.agentType, 'openai');
  assert.equal(responsesConfig.reasoningEffort, 'medium');
  assert.equal(responsesConfig.reasoningSummary, 'auto');
  assert.equal(anthropicConfig.agentType, 'anthropic');
  assert.equal(anthropicConfig.reasoningEffort, 'high');
  assert.equal(anthropicConfig.reasoningSummary, undefined);
});

test('readLlmConfig uses provider-backed first profile when selectedModel is omitted or stale', () => {
  const configWithoutSelection = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        providers: {
          example: { preset: OPENAI_PRESET, apiKey: 'example-api-key', baseURL: 'https://provider.example/v1' },
          openai: { preset: OPENAI_PRESET, apiKey: 'openai-api-key' }
        },
        models: [
          { id: 'example-fast', provider: 'example', model: 'example-fast' },
          { id: 'openai-deep', provider: 'openai', model: 'gpt-4.1' }
        ]
      }
    }))
  });
  const configWithStaleSelection = readLlmConfig({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'removed',
        providers: {
          example: { preset: OPENAI_PRESET, apiKey: 'example-api-key', baseURL: 'https://provider.example/v1' },
          openai: { preset: OPENAI_PRESET, apiKey: 'openai-api-key' }
        },
        models: [
          { id: 'example-fast', provider: 'example', model: 'example-fast' },
          { id: 'openai-deep', provider: 'openai', model: 'gpt-4.1' }
        ]
      }
    }))
  });

  assert.equal(configWithoutSelection.model, 'example-fast');
  assert.equal(configWithoutSelection.apiKey, 'example-api-key');
  assert.equal(configWithoutSelection.baseURL, 'https://provider.example/v1');
  assert.equal(configWithStaleSelection.model, 'example-fast');
  assert.equal(configWithStaleSelection.apiKey, 'example-api-key');
});

test('readLlmModelConfigInfo returns model list and selected profile for /model', () => {
  const info = readLlmModelConfigInfo({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'deep',
        providers: {
          fixture: { preset: OPENAI_CHAT_PRESET, apiKey: 'fixture-api-key' },
          openai: { preset: OPENAI_PRESET, apiKey: 'shared-api-key' }
        },
        models: [
          { id: 'fast', provider: 'fixture', model: 'gpt-fast' },
          { id: 'deep', provider: 'openai', model: 'gpt-deep' }
        ]
      }
    }))
  });

  assert.deepEqual(info, {
    kind: 'profiles',
    selectedModelId: 'deep',
    models: [
      { id: 'fast', provider: 'fixture', model: 'gpt-fast', contextWindow: undefined },
      { id: 'deep', provider: 'openai', model: 'gpt-deep', contextWindow: undefined }
    ]
  });
});

test('readLlmModelConfigInfo returns provider-backed models for /model', () => {
  const info = readLlmModelConfigInfo({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'deep',
        providers: {
          example: { preset: OPENAI_PRESET, apiKey: 'example-api-key', baseURL: 'https://provider.example/v1' },
          openai: { preset: OPENAI_PRESET, apiKey: 'openai-api-key' }
        },
        models: [
          { id: 'fast', provider: 'example', model: 'example-fast' },
          { id: 'deep', provider: 'openai', model: 'gpt-4.1', contextWindow: 1000000 }
        ]
      }
    }))
  });

  assert.deepEqual(info, {
    kind: 'profiles',
    selectedModelId: 'deep',
    models: [
      { id: 'fast', provider: 'example', model: 'example-fast', contextWindow: undefined },
      { id: 'deep', provider: 'openai', model: 'gpt-4.1', contextWindow: 1000000 }
    ]
  });
});

test('readLlmConfig reports provider-backed configuration errors safely', () => {
  assert.throws(
    () => readLlmConfig({
      configPath: '/tmp/echo-config.json',
      readFile: readConfigFrom(JSON.stringify({
        llm: {
          providers: { openai: { preset: OPENAI_PRESET, apiKey: 'secret-value' } },
          models: [
            { id: 'default', model: 'test-model' }
          ]
        }
      }))
    }),
    /LLM 模型 default 缺少 provider/
  );

  assert.throws(
    () => readLlmConfig({
      configPath: '/tmp/echo-config.json',
      readFile: readConfigFrom(JSON.stringify({
        llm: {
          providers: { openai: { preset: OPENAI_PRESET, apiKey: 'secret-value' } },
          models: [
            { id: 'default', provider: 'missing', model: 'test-model' }
          ]
        }
      }))
    }),
    /LLM 模型 default 引用了不存在的 provider：missing/
  );

  assert.throws(
    () => readLlmConfig({
      configPath: '/tmp/echo-config.json',
      readFile: readConfigFrom(JSON.stringify({
        llm: {
          providers: { openai: { preset: OPENAI_PRESET, apiKey: 'secret-value' } },
          models: [
            { id: 'default', provider: 123, model: 'test-model' }
          ]
        }
      }))
    }),
    /LLM 模型 default 的 provider 必须是字符串/
  );

  assert.throws(
    () => readLlmConfig({
      configPath: '/tmp/echo-config.json',
      readFile: readConfigFrom(JSON.stringify({
        llm: {
          providers: [],
          models: [
            { id: 'default', provider: 'openai', model: 'test-model' }
          ]
        }
      }))
    }),
    /LLM 配置 providers 必须是对象/
  );

  assert.throws(
    () => readLlmConfig({
      configPath: '/tmp/echo-config.json',
      readFile: readConfigFrom(JSON.stringify({
        llm: {
          providers: { openai: { preset: OPENAI_PRESET, apiKey: 123 } },
          models: [
            { id: 'default', provider: 'openai', model: 'test-model' }
          ]
        }
      }))
    }),
    /LLM provider openai 的 apiKey 必须是字符串/
  );

  assert.throws(
    () => readLlmConfig({
      configPath: '/tmp/echo-config.json',
      readFile: readConfigFrom(JSON.stringify({
        llm: {
          providers: { openai: { preset: 'missing-preset', apiKey: 'secret-value' } },
          models: [
            { id: 'default', provider: 'openai', model: 'test-model' }
          ]
        }
      }))
    }),
    /LLM provider openai 的 preset 不存在：missing-preset/
  );

  assert.throws(
    () => readLlmConfig({
      configPath: '/tmp/echo-config.json',
      readFile: readConfigFrom(JSON.stringify({
        llm: {
          providers: { openai: { preset: OPENAI_PRESET, apiKey: 'secret-value' } },
          models: [
            { id: 'default', provider: 'openai', model: 'test-model', reasoning: { effort: 'extreme' } }
          ]
        }
      }))
    }),
    /LLM 模型 default 的 reasoning\.effort 必须是/
  );

  assert.throws(
    () => readLlmConfig({
      configPath: '/tmp/echo-config.json',
      readFile: readConfigFrom(JSON.stringify({
        llm: {
          providers: { openai: { preset: OPENAI_PRESET, apiKey: 'secret-value' } },
          models: [
            { id: 'default', provider: 'openai', model: 'test-model', reasoning: { summary: 'verbose' } }
          ]
        }
      }))
    }),
    /LLM 模型 default 的 reasoning\.summary 必须是/
  );

  assert.throws(
    () => readLlmConfig({
      configPath: '/tmp/echo-config.json',
      readFile: readConfigFrom(JSON.stringify({
        llm: {
          providers: { openai: { preset: OPENAI_PRESET } },
          models: [
            { id: 'default', provider: 'openai', model: 'test-model' }
          ]
        }
      }))
    }),
    (thrown) => {
      assert.match(thrown.message, /LLM provider openai 缺少 apiKey/);
      assert.doesNotMatch(thrown.message, /secret-value/);
      return true;
    }
  );
});

test('readLlmModelConfigInfo selects the first profile when selectedModel was removed', () => {
  const info = readLlmModelConfigInfo({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(JSON.stringify({
      llm: {
        selectedModel: 'missing',
        providers: {
          shared: { preset: OPENAI_PRESET, apiKey: 'shared-api-key' }
        },
        models: [
          { id: 'fast', provider: 'shared', model: 'gpt-fast' },
          { id: 'deep', provider: 'shared', model: 'gpt-deep' }
        ]
      }
    }))
  });

  assert.equal(info.selectedModelId, 'fast');
});

test('readLlmConfig reports missing config file without leaking credential-like content', () => {
  const fakeApiKey = `sk-${'secret'}`;
  const error = new Error(`missing ${fakeApiKey}`);
  error.code = 'ENOENT';

  assert.throws(
    () => readLlmConfig({
      configPath: '/tmp/echo-config.json',
      readFile: readConfigError(error)
    }),
    (thrown) => {
      assert.equal(thrown instanceof LlmConfigError, true);
      assert.match(thrown.message, /LLM 配置文件不存在/);
      assert.doesNotMatch(thrown.message, new RegExp(fakeApiKey));
      return true;
    }
  );

  assert.throws(
    () => readLlmConfig({
      configPath: '/tmp/echo-config.json',
      readFile: readConfigFrom(JSON.stringify({
        llm: {
          providers: {
            bad: { apiKey: 'secret-value' }
          },
          models: [
            { id: 'default', provider: 'bad', model: 'test-model' }
          ]
        }
      }))
    }),
    /LLM provider bad 缺少 preset/
  );
});

test('readLlmModelConfigInfo keeps openai-chat effort and ignores summary', () => {
  const configText = JSON.stringify({
    llm: {
      selectedModel: 'chat',
      providers: {
        chat: { preset: OPENAI_CHAT_PRESET, apiKey: 'chat-api-key' }
      },
      models: [
        { id: 'chat', provider: 'chat', model: 'gpt-chat', reasoning: { effort: 'high', summary: 'auto' } }
      ]
    }
  });

  const info = readLlmModelConfigInfo({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(configText)
  });

  assert.deepEqual(info.models, [
    { id: 'chat', provider: 'chat', model: 'gpt-chat', reasoningEffort: 'high', contextWindow: undefined }
  ]);
});

test('readLlmModelConfigInfo keeps codex effort for status line', () => {
  const configText = JSON.stringify({
    llm: {
      selectedModel: 'codex',
      providers: {
        codex: { preset: CODEX_OAUTH_PRESET, codexAuthFile: '/tmp/codex-auth.json' }
      },
      models: [
        { id: 'codex', provider: 'codex', model: 'gpt-5.5', reasoning: { effort: 'high' } }
      ]
    }
  });

  const info = readLlmModelConfigInfo({
    configPath: '/tmp/echo-config.json',
    readFile: readConfigFrom(configText)
  });

  assert.deepEqual(info.models, [
    { id: 'codex', provider: 'codex', model: 'gpt-5.5', reasoningEffort: 'high', contextWindow: undefined }
  ]);
});

test('readLlmConfig reports invalid JSON', () => {
  assert.throws(
    () => readLlmConfig({
      configPath: '/tmp/echo-config.json',
      readFile: readConfigFrom('{not-json')
    }),
    /LLM 配置文件不是有效 JSON/
  );
});

test('readLlmConfig validates required fields without echoing field values', () => {
  assert.throws(
    () => readLlmConfig({
      configPath: '/tmp/echo-config.json',
      readFile: readConfigFrom(JSON.stringify({
        llm: {
          models: [
            { id: 'default', provider: 'default', model: 'test-model' }
          ]
        }
      }))
    }),
    /LLM 配置缺少 providers/
  );

  assert.throws(
    () => readLlmConfig({
      configPath: '/tmp/echo-config.json',
      readFile: readConfigFrom(JSON.stringify({ llm: { providers: { default: { preset: OPENAI_PRESET, apiKey: 'secret-value' } }, model: 'removed-model' } }))
    }),
    (thrown) => {
      assert.match(thrown.message, /LLM 配置缺少 models/);
      assert.doesNotMatch(thrown.message, /secret-value/);
      return true;
    }
  );
});

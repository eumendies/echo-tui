const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildProviderRecords, createAgentLoopRuntime } = require('../../src/agent/agent-loop-runtime');
const {formatAgentMemoryCatalogPrompt, formatUserMemoriesPrompt} = require('../../src/agent/context/memory-prompt');
const { createBuiltInSystemPrompt } = require('../../src/agent/context/system-prompt');
const llmConfigModule = require('../../src/config/llm-config');
const agentSetupModule = require('../../src/agent/agent-setup');
const {createUserMemory, updateUserMemory} = require('../../src/memory/memory-store');
const {addAgentMemory, setAgentMemoryCatalogEnabled, updateAgentMemoryCatalog} = require('../../src/memory/agent-memory-store');

const TEST_CWD = '/tmp/echo_tui';
const TEST_CONFIG = {
  agentType: 'fake',
  apiKey: '',
  model: 'fake',
  contextWindow: 128000,
  tools: {
    bash: {
      timeoutMs: 1000,
      maxOutputBytes: 1024
    }
  }
};

async function withPatchedAgentRuntime(agent, callback, config = TEST_CONFIG) {
  const originalReadLlmConfig = llmConfigModule.readLlmConfig;
  const originalCreateConfiguredAgent = agentSetupModule.createConfiguredAgent;

  llmConfigModule.readLlmConfig = typeof config === 'function' ? config : () => config;
  agentSetupModule.createConfiguredAgent = () => agent;

  try {
    return await callback();
  } finally {
    llmConfigModule.readLlmConfig = originalReadLlmConfig;
    agentSetupModule.createConfiguredAgent = originalCreateConfiguredAgent;
  }
}

async function withTemporaryMemoryHome(callback) {
  const originalHomedir = os.homedir;
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-agent-memory-'));
  os.homedir = () => homeDir;

  try {
    return await callback();
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(homeDir, {recursive: true, force: true});
  }
}

function createHookRecorder() {
  const events = [];

  return {
    events,
    dispatcher: {
      emit(event, payload) {
        events.push({event, payload});
      },
      async flush() {}
    }
  };
}

function createDebugRecorder() {
  const events = [];

  return {
    events,
    context: {
      enabled: true,
      logPath: '/tmp/debug.jsonl',
      emit(event, payload) {
        events.push({event, payload});
      },
      close() {}
    }
  };
}

test('buildProviderRecords includes skill catalog without skill body', () => {
  const records = buildProviderRecords([{ role: 'user', text: 'review this' }], TEST_CWD, undefined, [
    {
      name: 'code-review',
      description: 'Review code changes',
      sourceKind: 'project',
      sourcePath: '/repo/.echo/skills/code-review/SKILL.md',
      resources: ['reference/checklist.md']
    }
  ]);

  assert.equal(records[0].role, 'system');
  assert.match(records[0].text, /Available Skills/);
  assert.match(records[0].text, /code-review: Review code changes/);
  assert.match(records[0].text, /use_skill/);
  assert.doesNotMatch(records[0].text, /SKILL\.md/);
  assert.doesNotMatch(records[0].text, /reference\/checklist\.md/);
  assert.deepEqual(records.slice(1), [{ role: 'user', text: 'review this' }]);
});

test('buildProviderRecords includes AGENTS instructions with precedence text', () => {
  const records = buildProviderRecords([{ role: 'user', text: 'follow repo rules' }], TEST_CWD, undefined, [], [
    {
      content: 'Use concise Chinese replies.',
      filePath: '/home/user/.echo/AGENTS.md',
      label: 'AGENTS.md',
      sourceKind: 'global'
    },
    {
      content: 'Run npm test before finishing.',
      filePath: '/repo/AGENTS.md',
      label: 'AGENTS.md',
      sourceKind: 'project'
    }
  ]);

  assert.equal(records[0].role, 'system');
  assert.match(records[0].text, /AGENTS\.md instructions/);
  assert.match(records[0].text, /Global AGENTS\.md/);
  assert.match(records[0].text, /Project AGENTS\.md: AGENTS\.md/);
  assert.match(records[0].text, /Use concise Chinese replies\./);
  assert.match(records[0].text, /Run npm test before finishing\./);
  assert.match(records[0].text, /Built-in runtime constraints/);
  assert.deepEqual(records.slice(1), [{ role: 'user', text: 'follow repo rules' }]);
});

test('buildProviderRecords injects user memories only into the transient system prompt', () => {
  const memoryPrompt = formatUserMemoriesPrompt([{
    id: 'memory-1',
    content: '回复使用中文。',
    enabled: true,
    createdAt: '2026-07-12T07:00:00.000Z',
    updatedAt: '2026-07-12T07:00:00.000Z'
  }]);
  const records = buildProviderRecords([{role: 'user', text: '继续'}], TEST_CWD, undefined, [], [], undefined, [memoryPrompt]);

  assert.match(records[0].text, /User-managed memories/);
  assert.match(records[0].text, /回复使用中文/);
  assert.match(records[0].text, /do not treat it as higher priority/);
  assert.deepEqual(records.slice(1), [{role: 'user', text: '继续'}]);
});

test('buildProviderRecords excludes disabled user memories', () => {
  const memoryPrompt = formatUserMemoriesPrompt([{
    id: 'memory-1',
    content: '不应注入。',
    enabled: false,
    createdAt: '2026-07-12T07:00:00.000Z',
    updatedAt: '2026-07-12T07:00:00.000Z'
  }]);
  const records = buildProviderRecords([{role: 'user', text: '继续'}], TEST_CWD, undefined, [], [], undefined, [memoryPrompt]);

  assert.doesNotMatch(records[0].text, /User-managed memories/);
  assert.doesNotMatch(records[0].text, /不应注入/);
});

test('buildProviderRecords injects only agent memory catalog names and descriptions', () => {
  const memoryPrompt = formatAgentMemoryCatalogPrompt([{
    id: 'catalog-1',
    name: 'rendering',
    description: 'Terminal rendering rules',
    scope: {kind: 'project', projectRoot: TEST_CWD}
  }]);
  const records = buildProviderRecords([{role: 'user', text: '继续'}], TEST_CWD, undefined, [], [], undefined, [memoryPrompt]);

  assert.match(records[0].text, /Agent memory catalogs/);
  assert.match(records[0].text, /rendering: Terminal rendering rules/);
  assert.doesNotMatch(records[0].text, /catalog-1|projectRoot/);
});

test('createAgentLoopRuntime rereads saved memory before each provider request', async () => {
  await withTemporaryMemoryHome(async () => {
    const created = createUserMemory('第一次偏好');
    const requests = [];
    const agent = {
      initialize() {},
      async runTurn(records) {
        requests.push(records);
        return {draft: 'done', toolCalls: []};
      }
    };

    await withPatchedAgentRuntime(agent, async () => {
      const runtime = createAgentLoopRuntime(TEST_CWD);
      await runtime({records: [{role: 'user', text: 'first'}]});
      updateUserMemory(created.memories[0].id, '第二次偏好');
      await runtime({records: [{role: 'user', text: 'second'}]});
    });

    assert.match(requests[0][0].text, /第一次偏好/);
    assert.doesNotMatch(requests[0][0].text, /第二次偏好/);
    assert.match(requests[1][0].text, /第二次偏好/);
    assert.doesNotMatch(requests[1][0].text, /第一次偏好/);
  });
});

test('createAgentLoopRuntime rereads and expands small agent memory before each provider request', async () => {
  await withTemporaryMemoryHome(async () => {
    addAgentMemory(TEST_CWD, {catalog: 'rendering', description: 'First description', content: 'private item'});
    const requests = [];
    const agent = {initialize() {}, async runTurn(records) { requests.push(records); return {draft: 'done', toolCalls: []}; }};
    await withPatchedAgentRuntime(agent, async () => {
      const runtime = createAgentLoopRuntime(TEST_CWD);
      await runtime({records: [{role: 'user', text: 'first'}]});
      updateAgentMemoryCatalog(TEST_CWD, 'rendering', {description: 'Second description'});
      await runtime({records: [{role: 'user', text: 'second'}]});
    });
    assert.match(requests[0][0].text, /First description/);
    assert.match(requests[0][0].text, /private item/);
    assert.doesNotMatch(requests[0][0].text, /Second description/);
    assert.match(requests[1][0].text, /Second description/);
    assert.match(requests[1][0].text, /private item/);
  });
});

test('createAgentLoopRuntime falls back to the complete catalog index when one item file is unreadable', async () => {
  await withTemporaryMemoryHome(async () => {
    const first = addAgentMemory(TEST_CWD, {catalog: 'first', description: 'First description', content: 'first item'});
    const second = addAgentMemory(TEST_CWD, {catalog: 'second', description: 'Second description', content: 'second item'});
    fs.writeFileSync(path.join(os.homedir(), '.echo', 'agent-memory', 'catalogs', `${second.catalog.id}.json`), '{bad', 'utf8');
    const requests = [];
    const agent = {initialize() {}, async runTurn(records) { requests.push(records); return {draft: 'done', toolCalls: []}; }};

    await withPatchedAgentRuntime(agent, () => {
      const runtime = createAgentLoopRuntime(TEST_CWD);
      return runtime({records: [{role: 'user', text: 'first'}]});
    });

    assert.match(requests[0][0].text, /First description/);
    assert.match(requests[0][0].text, /Second description/);
    assert.doesNotMatch(requests[0][0].text, /first item|second item/);
    assert.equal(first.ok, true);
  });
});

test('createAgentLoopRuntime counts the selected expanded agent memory prompt as memory context', async () => {
  await withTemporaryMemoryHome(async () => {
    addAgentMemory(TEST_CWD, {catalog: 'rendering', description: 'Terminal rules', content: 'Use real cursors.'});
    const providerRecords = [];
    const contextUsages = [];
    const agent = {
      initialize() {},
      async runTurn(records) {
        providerRecords.push(records);
        return {draft: 'done', toolCalls: [], usageInputTokens: 10_000};
      }
    };

    await withPatchedAgentRuntime(agent, () => {
      const runtime = createAgentLoopRuntime(TEST_CWD);
      return runtime({records: [{role: 'user', text: 'first'}]}, {onContextUsage(usage) { contextUsages.push(usage); }});
    });

    assert.match(providerRecords[0][0].text, /Use real cursors/);
    assert.ok(contextUsages[0].segments.find((segment) => segment.category === 'memory').tokens > 0);
  });
});

test('createAgentLoopRuntime records a non-sensitive agent memory prompt summary in debug context', async () => {
  await withTemporaryMemoryHome(async () => {
    addAgentMemory(TEST_CWD, {catalog: 'rendering', description: 'Private description', content: 'private memory content'});
    const debug = createDebugRecorder();
    const agent = {initialize() {}, async runTurn() { return {draft: 'done', toolCalls: []}; }};

    await withPatchedAgentRuntime(agent, () => {
      const runtime = createAgentLoopRuntime(TEST_CWD, undefined, undefined, debug.context);
      return runtime({records: [{role: 'user', text: 'first'}]});
    });

    const request = debug.events.find((event) => event.event === 'provider_request_built');
    assert.equal(request.payload.agentMemoryMode, 'expanded');
    assert.equal(request.payload.agentMemoryCatalogCount, 1);
    assert.equal(request.payload.agentMemoryItemCount, 1);
    assert.equal(request.payload.agentMemoryTokens > 0, true);
    assert.doesNotMatch(JSON.stringify(request.payload), /Private description|private memory content/);
  });
});

test('createAgentLoopRuntime excludes disabled catalogs and falls back to enabled global catalogs', async () => {
  await withTemporaryMemoryHome(async () => {
    addAgentMemory(TEST_CWD, {catalog: 'shared', description: 'Global description', content: 'global item', scope: 'global'});
    addAgentMemory(TEST_CWD, {catalog: 'shared', description: 'Project description', content: 'project item'});
    const requests = [];
    const agent = {initialize() {}, async runTurn(records) { requests.push(records); return {draft: 'done', toolCalls: []}; }};
    await withPatchedAgentRuntime(agent, async () => {
      const runtime = createAgentLoopRuntime(TEST_CWD);
      await runtime({records: [{role: 'user', text: 'first'}]});
      setAgentMemoryCatalogEnabled(TEST_CWD, 'shared', false, 'project');
      await runtime({records: [{role: 'user', text: 'second'}]});
      setAgentMemoryCatalogEnabled(TEST_CWD, 'shared', false, 'global');
      await runtime({records: [{role: 'user', text: 'third'}]});
    });

    assert.match(requests[0][0].text, /Project description/);
    assert.doesNotMatch(requests[0][0].text, /Global description/);
    assert.match(requests[1][0].text, /Global description/);
    assert.doesNotMatch(requests[1][0].text, /Project description/);
    assert.doesNotMatch(requests[2][0].text, /Global description|Project description/);
  });
});

test('buildProviderRecords does not inject mode runtime context', () => {
  const records = buildProviderRecords([{ role: 'user', text: 'plan this' }], TEST_CWD);

  assert.deepEqual(records, [
    { role: 'system', text: createBuiltInSystemPrompt({ cwd: TEST_CWD }) },
    { role: 'user', text: 'plan this' }
  ]);
  assert.equal(records.some((record) => record.text.includes('## Mode')), false);
  assert.equal(records.some((record) => record.text.includes('/mode normal')), false);
});

test('buildProviderRecords injects todo runtime context without changing system prompt', () => {
  const todoState = {
    updatedAt: '2026-06-30T00:00:00.000Z',
    items: [
      {id: 'todo_1', text: 'first task', status: 'open'},
      {id: 'todo_2', text: 'done task', status: 'completed'}
    ]
  };
  const normalRecords = buildProviderRecords([{ role: 'user', text: 'continue' }], TEST_CWD);
  const todoRecords = buildProviderRecords([{ role: 'user', text: 'continue' }], TEST_CWD, undefined, [], [], todoState);

  assert.equal(todoRecords[0].text, normalRecords[0].text);
  assert.deepEqual(todoRecords.slice(0, normalRecords.length), normalRecords);
  assert.equal(todoRecords.at(-1).role, 'user');
  assert.match(todoRecords.at(-1).text, /# Echo Runtime Context/);
  assert.match(todoRecords.at(-1).text, /Not a user request/);
  assert.match(todoRecords.at(-1).text, /## Todos/);
  assert.match(todoRecords.at(-1).text, /Open:/);
  assert.match(todoRecords.at(-1).text, /\[todo_1\] first task/);
  assert.equal(todoRecords.at(-1).text.includes('Done:'), false);
  assert.equal(todoRecords.at(-1).text.includes('[todo_2] done task'), false);
});

test('buildProviderRecords omits completed-only todo state from runtime context', () => {
  const records = buildProviderRecords([{ role: 'user', text: 'continue' }], TEST_CWD, undefined, [], [], {
    updatedAt: '2026-06-30T00:00:00.000Z',
    items: [{id: 'todo_1', text: 'done task', status: 'completed'}]
  });

  assert.deepEqual(records.slice(1), [{ role: 'user', text: 'continue' }]);
});

test('buildProviderRecords omits runtime context when no runtime state exists', () => {
  const records = buildProviderRecords([{ role: 'user', text: 'continue' }], TEST_CWD, undefined, [], [], {
    updatedAt: '2026-06-30T00:00:00.000Z',
    items: []
  });

  assert.deepEqual(records.slice(1), [{ role: 'user', text: 'continue' }]);
});

test('buildProviderRecords does not append mode context after compacted active records', () => {
  const records = buildProviderRecords([{role: 'user', text: 'next task'}], TEST_CWD, {
    summaryText: 'Earlier context.',
    activeStartIndex: 4,
    createdAt: '2026-06-29T00:00:00.000Z'
  });

  assert.deepEqual(records.map((record) => record.role), ['system', 'user', 'user']);
  assert.equal(records[1].text, 'Here is a structured summary of the earlier conversation:\nEarlier context.');
  assert.equal(records[2].text, 'next task');
  assert.equal(records.some((record) => record.text.includes('# Echo Runtime Context')), false);
});

test('built-in system prompt distinguishes directory reading from path and content search', () => {
  const prompt = createBuiltInSystemPrompt({ cwd: TEST_CWD });

  assert.match(prompt, /glob to discover local files by name or path pattern/);
  assert.match(prompt, /grep for general text search/);
  assert.match(prompt, /read_files to read known files or list the direct children/);
  assert.match(prompt, /directory reads are non-recursive/);
});

test('built-in system prompt guides todo tools for long-running tasks only', () => {
  const prompt = createBuiltInSystemPrompt({ cwd: TEST_CWD });

  assert.match(prompt, /multi-step or long-running tasks/);
  assert.match(prompt, /use the todo tools/);
  assert.match(prompt, /mark items complete promptly/);
  assert.match(prompt, /loop until every todo is complete/);
  assert.match(prompt, /Do not create todos for trivial one-step requests/);
});

test('buildProviderRecords sends slash skill invocation as ordinary user record', () => {
  const skillRecord = {
    role: 'user',
    text: '[Skill Invocation]\nskill: review\n\n# Review',
    skillInvocation: { source: 'slash', skillName: 'review' }
  };
  const records = buildProviderRecords([skillRecord], TEST_CWD);

  assert.deepEqual(records.slice(1), [skillRecord]);
});

test('buildProviderRecords filters visible reasoning summary records', () => {
  const records = buildProviderRecords([
    { role: 'user', text: 'inspect' },
    { role: 'reasoning_summary', text: 'I will inspect first.' },
    { role: 'assistant', text: 'done' }
  ], TEST_CWD);

  assert.deepEqual(records.slice(1), [
    { role: 'user', text: 'inspect' },
    { role: 'assistant', text: 'done' }
  ]);
});

test('buildProviderRecords keeps chat reasoning content records', () => {
  const reasoningRecord = {
    role: 'openai_chat_reasoning',
    text: '',
    reasoningContent: 'hidden'
  };
  const records = buildProviderRecords([
    { role: 'user', text: 'inspect' },
    reasoningRecord,
    { role: 'assistant', text: 'done' }
  ], TEST_CWD);

  assert.deepEqual(records.slice(1), [
    { role: 'user', text: 'inspect' },
    reasoningRecord,
    { role: 'assistant', text: 'done' }
  ]);
});

test('createAgentLoopRuntime emits provider records callback before visible completion', async () => {
  const callbackEvents = [];
  const reasoningContentRecord = {
    role: 'openai_chat_reasoning',
    text: '',
    reasoningContent: 'hidden'
  };
  const agent = {
    initialize() {},
    async runTurn() {
      return {
        draft: 'done',
        providerRecords: [reasoningContentRecord],
        reasoningSummary: 'visible',
        toolCalls: []
      };
    }
  };

  await withPatchedAgentRuntime(agent, async () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD);
    await runAgent({records: [{role: 'user', text: 'hello'}]}, {
      onProviderRecords(records) {
        callbackEvents.push(['providerRecords', records]);
      },
      onReasoningSummary(text) {
        callbackEvents.push(['summary', text]);
      },
      onComplete(text) {
        callbackEvents.push(['complete', text]);
      }
    });
  });

  assert.deepEqual(callbackEvents, [
    ['providerRecords', [reasoningContentRecord]],
    ['summary', 'visible'],
    ['complete', 'done']
  ]);
});

test('createAgentLoopRuntime uses one overridden config for provider, context, usage, and continuation', async () => {
  const initialized = [];
  const contextUsages = [];
  const usageEvents = [];
  let turnCount = 0;
  const agent = {
    initialize(config) {
      initialized.push(config);
    },
    async runTurn() {
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [{callId: 'todo', toolName: 'create_todos', argumentsText: JSON.stringify({items: ['continue']})}],
          usageInputTokens: 50,
          usage: {outputTokens: 2}
        };
      }

      return {draft: 'done', toolCalls: [], usageInputTokens: 60, usage: {outputTokens: 3}};
    }
  };
  const overrideConfig = {
    ...TEST_CONFIG,
    model: 'override-model',
    contextWindow: 777,
    tools: {bash: {timeoutMs: 4321, maxOutputBytes: 2048}}
  };

  await withPatchedAgentRuntime(agent, async () => {
    const runtime = createAgentLoopRuntime(TEST_CWD, undefined, undefined, undefined, {
      appendEvent(event) {
        usageEvents.push(event);
      }
    });
    await runtime({records: [{role: 'user', text: 'work'}], modelProfileId: 'override-profile'}, {
      onContextUsage(usage) {
        contextUsages.push(usage);
      }
    });
  }, (options) => {
    assert.equal(options.modelProfileId, 'override-profile');
    return overrideConfig;
  });

  assert.equal(initialized.length, 1);
  assert.equal(initialized[0].model, 'override-model');
  assert.equal(initialized[0].tools.bash.timeoutMs, 4321);
  assert.deepEqual(contextUsages.map((usage) => usage.contextWindow), [777, 777]);
  assert.deepEqual(usageEvents.map((event) => [event.model, event.contextWindow]), [
    ['override-model', 777],
    ['override-model', 777]
  ]);
});

test('createAgentLoopRuntime reports the model resolved for the current run', async () => {
  const resolvedModels = [];
  const agent = {
    initialize() {},
    async runTurn() {
      return {draft: 'done', toolCalls: []};
    }
  };

  await withPatchedAgentRuntime(agent, async () => {
    const runtime = createAgentLoopRuntime(TEST_CWD);

    await runtime({records: [{role: 'user', text: 'work'}]}, {
      onModelResolved(model) {
        resolvedModels.push(model);
      }
    });
  }, () => ({...TEST_CONFIG, model: 'resolved-model', reasoningEffort: 'high'}));

  assert.deepEqual(resolvedModels, [{model: 'resolved-model', reasoningEffort: 'high'}]);
});

test('autonomous use_skill keeps the model initialized for normal and slash override turns', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-skill-model-runtime-'));
  const skillDir = path.join(cwd, '.echo', 'skills', 'loaded-skill');
  const initializedModels = [];
  const configOptions = [];
  const toolResults = [];
  let turnCount = 0;

  fs.mkdirSync(skillDir, {recursive: true});
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: loaded-skill\ndescription: Loaded skill\n---\n# Loaded\n', 'utf8');
  fs.writeFileSync(path.join(cwd, '.echo', 'skills', 'skills.json'), JSON.stringify({
    schemaVersion: 2,
    disabled: [],
    modelOverrides: {'loaded-skill': 'different-profile'}
  }), 'utf8');

  const agent = {
    initialize(config) {
      initializedModels.push(config.model);
    },
    async runTurn() {
      turnCount += 1;
      return turnCount % 2 === 1
        ? {draft: '', toolCalls: [{callId: `skill-${turnCount}`, toolName: 'use_skill', argumentsText: JSON.stringify({name: 'loaded-skill'})}]}
        : {draft: 'done', toolCalls: []};
    }
  };

  try {
    await withPatchedAgentRuntime(agent, async () => {
      const runtime = createAgentLoopRuntime(cwd);
      const callbacks = {onToolResult(result) { toolResults.push(result); }};

      await runtime({records: [{role: 'user', text: 'normal'}]}, callbacks);
      await runtime({records: [{role: 'user', text: 'slash'}], modelProfileId: 'slash-profile'}, callbacks);
    }, (options) => {
      configOptions.push(options.modelProfileId);
      return {...TEST_CONFIG, model: options.modelProfileId === 'slash-profile' ? 'slash-model' : 'current-model'};
    });
  } finally {
    fs.rmSync(cwd, {recursive: true, force: true});
  }

  assert.deepEqual(configOptions, [undefined, 'slash-profile']);
  assert.deepEqual(initializedModels, ['current-model', 'slash-model']);
  assert.equal(toolResults.length, 2);
  assert.equal(toolResults.every((result) => result.ok), true);
});

test('createAgentLoopRuntime keeps provider-visible tool definitions stable across normal and plan modes', async () => {
  const captured = [];
  const agent = {
    initialize(_config, registry) {
      captured.push(registry.listDefinitions().map((definition) => definition.name));
    },
    async runTurn() {
      return {draft: 'done', toolCalls: []};
    }
  };
  const mcpManager = {
    listTools() {
      return [{
        serverName: 'docs',
        toolName: 'search',
        namespacedName: 'mcp__docs__search',
        approval: 'always',
        description: 'Search docs',
        inputSchema: {type: 'object'}
      }];
    },
    getToolReference() {
      return {serverName: 'docs', toolName: 'search', namespacedName: 'mcp__docs__search', approval: 'always'};
    }
  };

  await withPatchedAgentRuntime(agent, async () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD, mcpManager);
    await runAgent({records: [{role: 'user', text: 'normal'}], interactionMode: 'normal'});
    await runAgent({records: [{role: 'user', text: 'plan'}], interactionMode: 'plan'});
  });

  assert.equal(captured.length, 2);
  assert.deepEqual(captured[1], captured[0]);
  assert.ok(captured[1].includes('apply_patch'));
  assert.ok(captured[1].includes('create_todos'));
  assert.ok(captured[1].includes('complete_todo'));
  assert.ok(captured[1].includes('mcp__docs__search'));
});

test('createAgentLoopRuntime rejects write tools in plan mode without approval', async () => {
  let turnCount = 0;
  const approvals = [];
  const results = [];
  const agent = {
    initialize() {},
    async runTurn() {
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [
            {callId: 'call_patch', toolName: 'apply_patch', argumentsText: JSON.stringify({patch: '*** Begin Patch\n*** Add File: a.txt\n+hi\n*** End Patch\n'})}
          ]
        };
      }

      return {draft: 'done', toolCalls: []};
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD);
    return runAgent({records: [{role: 'user', text: 'edit'}], interactionMode: 'plan'}, {
      onToolApprovalRequest() {
        approvals.push('approval');
        return {kind: 'allow_once'};
      },
      onToolResult(toolResult) {
        results.push(toolResult);
      }
    });
  });

  assert.equal(result, 'done');
  assert.deepEqual(approvals, []);
  assert.equal(results.length, 1);
  assert.equal(results[0].toolName, 'apply_patch');
  assert.equal(results[0].ok, false);
  assert.match(results[0].text, /plan mode/);
});

test('createAgentLoopRuntime immediately denies approval-required tools in headless mode', async () => {
  let turnCount = 0;
  let approvalCount = 0;
  const results = [];
  const agent = {
    initialize() {},
    async runTurn() {
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [{
            callId: 'headless-patch',
            toolName: 'apply_patch',
            argumentsText: JSON.stringify({patch: '*** Begin Patch\n*** Add File: denied.txt\n+denied\n*** End Patch\n'})
          }]
        };
      }

      return {draft: 'done', toolCalls: []};
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD);
    return runAgent({
      records: [{role: 'user', text: 'edit'}],
      executionMode: {kind: 'headless', approvalPolicy: 'deny'}
    }, {
      onToolApprovalRequest() {
        approvalCount += 1;
        throw new Error('headless mode must not request approval');
      },
      onToolResult(toolResult) {
        results.push(toolResult);
      }
    });
  });

  assert.equal(result, 'done');
  assert.equal(approvalCount, 0);
  assert.equal(results[0].ok, false);
  assert.match(results[0].text, /--full-access/);
});

test('createAgentLoopRuntime full-access executes registered patch tools without approval callback', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-full-access-'));
  let turnCount = 0;
  const results = [];
  const agent = {
    initialize() {},
    async runTurn() {
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [{
            callId: 'full-patch',
            toolName: 'apply_patch',
            argumentsText: JSON.stringify({patch: '*** Begin Patch\n*** Add File: allowed.txt\n+allowed\n*** End Patch\n'})
          }]
        };
      }

      return {draft: 'done', toolCalls: []};
    }
  };

  try {
    const result = await withPatchedAgentRuntime(agent, () => {
      const runAgent = createAgentLoopRuntime(cwd);
      return runAgent({
        records: [{role: 'user', text: 'edit'}],
        executionMode: {kind: 'headless', approvalPolicy: 'full-access'}
      }, {
        onToolApprovalRequest() {
          throw new Error('full-access must not request approval');
        },
        onToolResult(toolResult) {
          results.push(toolResult);
        }
      });
    });

    assert.equal(result, 'done');
    assert.equal(results[0].ok, true);
    assert.equal(fs.readFileSync(path.join(cwd, 'allowed.txt'), 'utf8'), 'allowed\n');
  } finally {
    fs.rmSync(cwd, {recursive: true, force: true});
  }
});

test('createAgentLoopRuntime cancels ask_user_questions when no interactive callback exists', async () => {
  let turnCount = 0;
  const results = [];
  const agent = {
    initialize() {},
    async runTurn() {
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [{
            callId: 'question-call',
            toolName: 'ask_user_questions',
            argumentsText: JSON.stringify({questions: [{question: 'Continue?', options: [{label: 'yes'}]}]})
          }]
        };
      }

      return {draft: 'cancelled and done', toolCalls: []};
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD);
    return runAgent({
      records: [{role: 'user', text: 'ask'}],
      executionMode: {kind: 'headless', approvalPolicy: 'deny'}
    }, {
      onToolResult(toolResult) {
        results.push(toolResult);
      }
    });
  });

  assert.equal(result, 'cancelled and done');
  assert.deepEqual(JSON.parse(results[0].text), {cancelled: true, reason: 'User cancelled ask_user_questions'});
});

test('createAgentLoopRuntime creates todos, persists state, and injects suffix on continuation', async () => {
  const providerRecords = [];
  const todoStates = [];
  const toolResults = [];
  let turnCount = 0;
  const agent = {
    initialize() {},
    async runTurn(records) {
      providerRecords.push(records);
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [
            {callId: 'todo-call', toolName: 'create_todos', argumentsText: JSON.stringify({items: ['inspect state', 'write tests']})}
          ]
        };
      }

      return {draft: 'done', toolCalls: []};
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD);
    return runAgent({records: [{role: 'user', text: 'work'}], interactionMode: 'plan'}, {
      onTodoStateChange(todoState) {
        todoStates.push(todoState);
      },
      onToolResult(toolResult) {
        toolResults.push(toolResult);
      },
      onToolApprovalRequest() {
        throw new Error('todo tools should not request approval');
      }
    });
  });

  assert.equal(result, 'done');
  assert.deepEqual(todoStates, [{
    updatedAt: todoStates[0].updatedAt,
    items: [
      {id: 'todo_1', text: 'inspect state', status: 'open'},
      {id: 'todo_2', text: 'write tests', status: 'open'}
    ]
  }]);
  assert.equal(toolResults[0].toolName, 'create_todos');
  assert.equal(toolResults[0].ok, true);
  assert.match(providerRecords[1].at(-1).text, /# Echo Runtime Context/);
  assert.match(providerRecords[1].at(-1).text, /Not a user request/);
  assert.doesNotMatch(providerRecords[1].at(-1).text, /## Mode/);
  assert.equal(providerRecords[1].at(-1).text.includes('/mode normal'), false);
  assert.match(providerRecords[1].at(-1).text, /## Todos/);
  assert.match(providerRecords[1].at(-1).text, /\[todo_1\] inspect state/);
});

test('createAgentLoopRuntime completes todos with partial not-found result and omits completed todo suffix', async () => {
  const providerRecords = [];
  const todoStates = [];
  const toolResults = [];
  let turnCount = 0;
  const agent = {
    initialize() {},
    async runTurn(records) {
      providerRecords.push(records);
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [
            {callId: 'complete-call', toolName: 'complete_todo', argumentsText: JSON.stringify({ids: ['todo_1', 'missing']})}
          ]
        };
      }

      return {draft: 'done', toolCalls: []};
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD);
    return runAgent({
      records: [{role: 'user', text: 'finish'}],
      todoState: {
        updatedAt: '2026-06-30T00:00:00.000Z',
        items: [{id: 'todo_1', text: 'only task', status: 'open'}]
      }
    }, {
      onTodoStateChange(todoState) {
        todoStates.push(todoState);
      },
      onToolResult(toolResult) {
        toolResults.push(toolResult);
      }
    });
  });

  assert.equal(result, 'done');
  assert.deepEqual(todoStates[0].items, [{id: 'todo_1', text: 'only task', status: 'completed'}]);
  assert.deepEqual(JSON.parse(toolResults[0].text).notFoundIds, ['missing']);
  assert.equal(providerRecords[0].some((record) => record.text.includes('# Echo Runtime Context')), true);
  assert.equal(providerRecords[1].some((record) => record.text.includes('# Echo Runtime Context')), false);
  assert.equal(providerRecords[1].some((record) => record.text.includes('[todo_1] only task')), false);
});

test('createAgentLoopRuntime keeps active todo suffix after compaction removes old todo tool records', async () => {
  const providerRecords = [];
  let turnCount = 0;
  const agent = {
    initialize() {},
    async runTurn(records) {
      providerRecords.push(records);
      turnCount += 1;

      if (turnCount === 1) {
        return {draft: 'summary', toolCalls: []};
      }

      return {draft: 'done', toolCalls: []};
    }
  };
  const records = Array.from({length: 30}, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `message ${index} `.repeat(10)
  }));

  await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD);
    return runAgent({
      records,
      todoState: {
        updatedAt: '2026-06-30T00:00:00.000Z',
        items: [{id: 'todo_1', text: 'survive compaction', status: 'open'}]
      }
    });
  }, {...TEST_CONFIG, contextWindow: 20});

  assert.equal(providerRecords.length, 2);
  assert.match(providerRecords[1].at(-1).text, /\[todo_1\] survive compaction/);
});

test('createAgentLoopRuntime emits tool lifecycle hooks without changing continuation', async () => {
  const hooks = createHookRecorder();
  const callbacks = [];
  let turnCount = 0;
  const agent = {
    initialize() {},
    async runTurn(_records, providerCallbacks) {
      turnCount += 1;

      if (turnCount === 1) {
        providerCallbacks.onToken?.('x', 'x');
        return {
          draft: '',
          toolCalls: [
            {callId: 'call-1', toolName: 'missing_tool', argumentsText: '{"value":1}'}
          ]
        };
      }

      return {draft: 'done', toolCalls: []};
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD, undefined, hooks.dispatcher);
    return runAgent({records: [{role: 'user', text: 'use tool'}]}, {
      onToolCall(call) {
        callbacks.push(['call', call.toolName]);
      },
      onToolResult(toolResult) {
        callbacks.push(['result', toolResult.toolName, toolResult.ok]);
      }
    });
  });

  assert.equal(result, 'done');
  assert.deepEqual(callbacks, [
    ['call', 'missing_tool'],
    ['result', 'missing_tool', false]
  ]);
  assert.deepEqual(hooks.events, [
    {
      event: 'tool_call_start',
      payload: {
        interactionMode: 'normal',
        toolCallId: 'call-1',
        toolName: 'missing_tool',
        argumentsText: '{"value":1}'
      }
    },
    {
      event: 'tool_call_end',
      payload: {
        interactionMode: 'normal',
        toolCallId: 'call-1',
        toolName: 'missing_tool',
        ok: false
      }
    }
  ]);
});

test('createAgentLoopRuntime emits compaction hook and no token hook', async () => {
  const hooks = createHookRecorder();
  let turnCount = 0;
  const agent = {
    initialize() {},
    async runTurn(_records, providerCallbacks) {
      turnCount += 1;

      if (turnCount === 1) {
        return {draft: 'summary', toolCalls: []};
      }

      providerCallbacks.onToken?.('d', 'd');
      return {draft: 'done', toolCalls: []};
    }
  };
  const records = Array.from({length: 30}, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `message ${index} `.repeat(10)
  }));

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD, undefined, hooks.dispatcher);
    return runAgent({records});
  }, {...TEST_CONFIG, contextWindow: 20});

  assert.equal(result, 'done');
  assert.equal(hooks.events.length, 1);
  assert.equal(hooks.events[0].event, 'compaction_end');
  assert.equal(hooks.events[0].payload.interactionMode, 'normal');
  assert.equal(typeof hooks.events[0].payload.activeStartIndex, 'number');
  assert.equal(typeof hooks.events[0].payload.createdAt, 'string');
});

test('createAgentLoopRuntime emits debug provider and tool summaries without changing provider records', async () => {
  const debug = createDebugRecorder();
  const providerRecordSnapshots = [];
  let turnCount = 0;
  const agent = {
    initialize() {},
    async runTurn(records) {
      providerRecordSnapshots.push(records);
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [
            {callId: 'call-1', toolName: 'missing_tool', argumentsText: '{"secret":"value"}'}
          ],
          usageInputTokens: 42
        };
      }

      return {draft: 'done', toolCalls: [], usageInputTokens: 43};
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD, undefined, undefined, debug.context);
    return runAgent({records: [{role: 'user', text: 'use tool'}]});
  });

  assert.equal(result, 'done');
  assert.equal(providerRecordSnapshots.length, 2);
  assert.equal(providerRecordSnapshots[0].some((record) => record.text.includes('debug')), false);
  assert.deepEqual(debug.events.map((event) => event.event), [
    'provider_request_built',
    'provider_usage',
    'tool_call_start',
    'tool_call_risk',
    'tool_call_approval',
    'tool_call_end',
    'provider_request_built',
    'provider_usage'
  ]);

  const requestEvent = debug.events.find((event) => event.event === 'provider_request_built');
  assert.deepEqual(requestEvent.payload.recordRoles, ['system', 'user']);
  assert.equal(requestEvent.payload.recordCount, 2);
  assert.equal(typeof requestEvent.payload.providerInputHash, 'string');
  assert.equal(typeof requestEvent.payload.toolSchemaHash, 'string');
  assert.equal(Array.isArray(requestEvent.payload.toolNames), true);

  const resultEvent = debug.events.find((event) => event.event === 'tool_call_end');
  assert.equal(resultEvent.payload.toolName, 'missing_tool');
  assert.equal(resultEvent.payload.ok, false);
  assert.equal(resultEvent.payload.resultText.length > 0, true);
});

test('createAgentLoopRuntime records provider usage events without changing context usage callback', async () => {
  const events = [];
  const contextUsages = [];
  let turnCount = 0;
  const agent = {
    initialize() {},
    async runTurn() {
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [
            {callId: 'call-1', toolName: 'missing_tool', argumentsText: '{}'}
          ],
          usage: {
            inputTokens: 42,
            cacheReadInputTokens: 10,
            outputTokens: 6
          },
          usageInputTokens: 42
        };
      }

      return {
        draft: 'done',
        toolCalls: [],
        usage: {
          inputTokens: 50,
          cacheCreationInputTokens: 12,
          outputTokens: 7
        },
        usageInputTokens: 50
      };
    }
  };
  const usageStore = {
    appendEvent(event) {
      events.push(event);
      return null;
    },
    listDailyUsage() {
      return [];
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD, undefined, undefined, undefined, usageStore);
    return runAgent({records: [{role: 'user', text: 'use tool'}]}, {
      onContextUsage(usage) {
        contextUsages.push(usage);
      }
    });
  });

  assert.equal(result, 'done');
  assert.equal(contextUsages.length, 2);
  assert.equal(contextUsages[0].usedTokens, 42);
  assert.equal(contextUsages[1].usedTokens, 50);
  assert.equal(events.length, 2);
  assert.equal(events[0].cwdHash.length, 40);
  assert.deepEqual(events.map((event) => ({
    providerType: event.providerType,
    model: event.model,
    interactionMode: event.interactionMode,
    inputTokens: event.inputTokens,
    cacheReadInputTokens: event.cacheReadInputTokens,
    cacheCreationInputTokens: event.cacheCreationInputTokens,
    outputTokens: event.outputTokens,
    contextWindow: event.contextWindow
  })), [
    {
      providerType: 'fake',
      model: 'fake',
      interactionMode: 'normal',
      inputTokens: 42,
      cacheReadInputTokens: 10,
      cacheCreationInputTokens: undefined,
      outputTokens: 6,
      contextWindow: 128000
    },
    {
      providerType: 'fake',
      model: 'fake',
      interactionMode: 'normal',
      inputTokens: 50,
      cacheReadInputTokens: undefined,
      cacheCreationInputTokens: 12,
      outputTokens: 7,
      contextWindow: 128000
    }
  ]);
});

test('createAgentLoopRuntime skips absent usage and isolates usage store failures', async () => {
  const debug = createDebugRecorder();
  const agent = {
    initialize() {},
    async runTurn() {
      return {draft: 'done', toolCalls: [], usage: {outputTokens: 5}};
    }
  };
  const usageStore = {
    appendEvent() {
      throw new Error('disk full');
    },
    listDailyUsage() {
      return [];
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD, undefined, undefined, debug.context, usageStore);
    return runAgent({records: [{role: 'user', text: 'hello'}]});
  });

  assert.equal(result, 'done');
  assert.ok(debug.events.some((event) => event.event === 'provider_usage_store_error'));

  const skippedEvents = [];
  const noUsageAgent = {
    initialize() {},
    async runTurn() {
      return {draft: 'done', toolCalls: []};
    }
  };

  await withPatchedAgentRuntime(noUsageAgent, async () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD, undefined, undefined, undefined, {
      appendEvent(event) {
        skippedEvents.push(event);
      },
      listDailyUsage() {
        return [];
      }
    });
    await runAgent({records: [{role: 'user', text: 'hello'}]});
  });

  assert.deepEqual(skippedEvents, []);
});

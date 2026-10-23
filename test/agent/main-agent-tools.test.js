const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {prepareAgent} = require('../../src/agent/agent-setup');
const {createMainAgentToolCatalog} = require('../../src/tools/main-agent-tool-catalog');
const {createAgentLoopRuntime} = require('../../src/agent/loop-runtime/agent-loop-runtime');
const {UserConfigContext} = require('../../src/config/user-config-context');
const fakeAgentModule = require('../../src/agent/fake/agent');
const {createObservation} = require('../../src/observation/observation-projector');
const {runOnce} = require('../../src/cli/one-shot');

const CONFIG = {
  agentType: 'fake', apiKey: '', model: 'echo-fake', contextWindow: 128000,
  tools: {
    autoCompressImages: true,
    bash: {timeoutMs: 1000, maxOutputBytes: 4096},
    sandbox: {mode: 'off', network: false, extraWritablePaths: []}
  }
};

function names(registry) {
  return registry.listDefinitions().map(({name}) => name);
}

test('main registry supports every independent editor combination', () => {
  for (const disabledTools of [[], ['apply_patch'], ['edit_file'], ['apply_patch', 'edit_file']]) {
    const prepared = prepareAgent({config: CONFIG, mainAgentTools: {disabledTools}});
    for (const name of ['apply_patch', 'edit_file']) {
      const enabled = !disabledTools.includes(name);
      assert.equal(names(prepared.registry).includes(name), enabled);
      assert.equal(Boolean(prepared.registry.getHandler(name)), enabled);
    }
    assert.ok(prepared.registry.getHandler('run_bash_command'));
  }
});

test('only Bash survives a complete deny preference, and unknown preferences create no handler', () => {
  const disabledTools = createMainAgentToolCatalog({disabledTools: []}).map(({name}) => name);
  disabledTools.push('unknown', 'mcp__offline__search');
  const prepared = prepareAgent({config: CONFIG, mainAgentTools: {disabledTools}});
  assert.deepEqual(names(prepared.registry), ['run_bash_command']);
  assert.equal(prepared.registry.getHandler('unknown'), undefined);
  assert.equal(prepared.registry.getHandler('mcp__offline__search'), undefined);
});

test('main Todo handlers and schemas are paired even when just one real name is disabled', () => {
  for (const disabledTools of [[], ['create_todos'], ['complete_todo'], ['create_todos', 'complete_todo']]) {
    const prepared = prepareAgent({config: CONFIG, mainAgentTools: {disabledTools}});
    for (const name of ['create_todos', 'complete_todo']) {
      assert.equal(names(prepared.registry).includes(name), disabledTools.length === 0);
      assert.equal(Boolean(prepared.registry.getHandler(name)), disabledTools.length === 0);
    }
  }
});

test('MCP preferences match exact merged names without changing manager or child visibility', () => {
  const mcpManager = {
    listServerNames: () => ['docs'],
    listTools: () => ['search', 'search_more'].map((toolName) => ({
      namespacedName: `mcp__docs__${toolName}`, serverName: 'docs', toolName, inputSchema: {type: 'object'}
    }))
  };
  const mainAgentTools = {disabledTools: ['mcp__docs__search', 'mcp__docs__*', 'read_files', 'apply_patch', 'edit_file']};
  const parent = prepareAgent({config: CONFIG, mcpManager, mainAgentTools});
  assert.equal(parent.registry.getHandler('mcp__docs__search'), undefined);
  assert.ok(parent.registry.getHandler('mcp__docs__search_more'));
  assert.equal(mcpManager.listTools().length, 2);

  const child = prepareAgent({config: CONFIG, mcpManager, allowedToolNames: new Set(['read_files', 'apply_patch', 'edit_file'])});
  assert.ok(child.registry.getHandler('read_files'));
  assert.ok(child.registry.getHandler('mcp__docs__search'));
  assert.ok(child.registry.getHandler('edit_file'));
  assert.ok(child.registry.getHandler('apply_patch'));
  assert.equal(child.registry.getHandler('run_bash_command'), undefined);
});

test('prepared main registries freeze the preference array and reject malformed values', () => {
  const mainAgentTools = {disabledTools: ['read_files']};
  const current = prepareAgent({config: CONFIG, mainAgentTools});
  mainAgentTools.disabledTools.splice(0);
  assert.equal(current.registry.getHandler('read_files'), undefined);
  assert.ok(prepareAgent({config: CONFIG, mainAgentTools}).registry.getHandler('read_files'));
  for (const disabledTools of [null, 'read_files', [false], ['']]) {
    assert.throws(() => prepareAgent({config: CONFIG, mainAgentTools: {disabledTools}}), /disabledTools/);
  }
});

/** 使用真实 snapshot 与装配，只有 provider 输出由脚本控制；隔离真实用户目录和联网工具副作用。 */
async function withWorkspace(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-main-tools-'));
  const cwd = path.join(root, 'project');
  const home = path.join(root, 'home');
  fs.mkdirSync(cwd);
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(cwd, 'sample.txt'), 'original\n');
  const originalHomedir = os.homedir;
  os.homedir = () => home;
  try {
    return await callback({cwd, home, root});
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(root, {recursive: true, force: true});
  }
}

function createContext(root, disabledTools) {
  let text = JSON.stringify({
    llm: {
      selectedModel: 'fake', providers: {fake: {preset: 'fake-agent'}},
      models: [{id: 'fake', provider: 'fake', model: 'echo-fake'}]
    },
    mcp: {enabled: false},
    tools: {mainAgent: {disabledTools}, sandbox: {mode: 'off'}}
  });
  const context = new UserConfigContext({configPath: path.join(root, 'config.json'), readFile: () => text});
  return {context, update(nextDisabledTools) {
    const next = JSON.parse(text);
    next.tools.mainAgent.disabledTools = nextDisabledTools;
    text = JSON.stringify(next);
    context.refresh();
  }};
}

/** 在公共 provider factory 处控制输出，真实 registry、特殊分支和 executor 保持运行语义。 */
async function withProvider(factory, callback) {
  const original = fakeAgentModule.createFakeAgent;
  fakeAgentModule.createFakeAgent = factory;
  try { return await callback(); } finally { fakeAgentModule.createFakeAgent = original; }
}

function call(toolName, args, callId = toolName) {
  return {callId, toolName, argumentsText: JSON.stringify(args)};
}

function createMcpManager(effects) {
  return {
    listServerNames: () => ['docs'],
    listReadonlyToolNames: () => new Set(['mcp__docs__search']),
    listTools: () => [{serverName: 'docs', toolName: 'search', namespacedName: 'mcp__docs__search', description: 'Search docs', inputSchema: {type: 'object'}}],
    listResources() { effects.push('resources.list'); return []; },
    listResourceTemplates() { effects.push('resources.templates'); return []; },
    readResource() { effects.push('resources.read'); return {contents: []}; },
    callTool() { effects.push('mcp.call'); return {content: []}; },
    async bootstrap() {},
    async close() {}
  };
}

for (const session of [
  {interactionMode: 'normal'},
  {interactionMode: 'plan'},
  {toolPolicy: 'readonly', conversationKind: 'btw'},
  {executionMode: {kind: 'headless', approvalPolicy: 'deny'}},
  {executionMode: {kind: 'headless', approvalPolicy: 'full-access'}}
]) {
  test(`disabled and unknown calls stop before ordinary, parallel and special side effects: ${JSON.stringify(session)}`, async () => {
    await withWorkspace(async ({cwd, root}) => {
      const calls = [
        call('read_files', {files: [{path: 'sample.txt'}]}),
        call('glob', {pattern: '**/*'}),
        call('web_fetch', {url: 'https://example.com'}),
        call('web_search', {query: 'echo'}),
        call('use_skill', {name: 'alpha'}),
        call('list_mcp_resources', {}),
        call('read_mcp_resource', {server: 'docs', uri: 'docs://secret'}),
        call('create_todos', {items: ['must not appear']}),
        call('complete_todo', {ids: ['todo_1']}),
        call('ask_user_questions', {questions: [{question: 'No?', options: [{label: 'No'}]}]}),
        call('run_subagent', {agent: 'explorer', task: 'Do not run'}, 'parallel-child-1'),
        call('run_subagent', {agent: 'explorer', task: 'Do not run'}, 'parallel-child-2'),
        call('apply_patch', {patch: '*** Begin Patch\n*** Add File: blocked.txt\n+bad\n*** End Patch'}),
        call('edit_file', {path: 'sample.txt', old_string: 'original', new_string: 'changed'}),
        call('mcp__docs__search', {}),
        call('not_registered', {})
      ];
      // 只禁用一个 Todo 名称，运行必须同时拒绝两个真实工具。
      const disabledTools = calls.map(({toolName}) => toolName).filter((name) => name !== 'complete_todo');
      const {context} = createContext(root, disabledTools);
      const effects = [];
      const mcpManager = createMcpManager(effects);
      const results = [];
      const debugEvents = [];
      const observation = createObservation({enabled: true, emit(event) { debugEvents.push(event); }});
      let factories = 0;
      let turns = 0;
      try {
        await withProvider(() => {
          factories += 1;
          return {async runTurn(records) {
            turns += 1;
            if (turns === 1) return {draft: '', toolCalls: calls};
            const continuation = records.filter(({role}) => role === 'tool_result');
            assert.equal(continuation.length, calls.length);
            assert.ok(continuation.every(({ok}) => ok === false));
            return {draft: 'done', toolCalls: []};
          }};
        }, async () => {
          const runtime = createAgentLoopRuntime(cwd, context, mcpManager, observation);
          assert.equal(await runtime({records: [{role: 'user', text: 'test boundary'}], ...session}, {
            onToolResult: (result) => results.push(result),
            onTodoStateChange() { effects.push('todo'); },
            onUserQuestionRequest() { effects.push('question'); },
            onToolApprovalRequest() { effects.push('approval'); return {kind: 'allow_all_for_session'}; },
            onSubagentRecords() { effects.push('subagent'); },
            changeRecorder: {
              captureFileBefore() { effects.push('before'); },
              captureFileAfter() { effects.push('after'); },
              invalidate() { effects.push('invalidate'); }
            }
          }), 'done');
        });
        assert.equal(factories, 1, 'no child provider was created');
        assert.deepEqual(effects, []);
        assert.equal(debugEvents.includes('tool_call_risk'), false);
        assert.equal(debugEvents.includes('tool_call_approval'), false);
        assert.deepEqual(results.map(({callId, toolName, ok}) => ({callId, toolName, ok})),
          calls.map(({callId, toolName}) => ({callId, toolName, ok: false})));
        assert.ok(results.every(({text}) => text.startsWith('Unknown tool:')));
        assert.equal(fs.readFileSync(path.join(cwd, 'sample.txt'), 'utf8'), 'original\n');
        assert.equal(fs.existsSync(path.join(cwd, 'blocked.txt')), false);
      } finally {
        context.close();
      }
    });
  });
}

test('a running continuation keeps the startup selection and the next run uses the refreshed snapshot', async () => {
  await withWorkspace(async ({cwd, root}) => {
    const {context, update} = createContext(root, ['read_files']);
    const events = [];
    const observation = createObservation({enabled: true, emit(event, payload) { events.push({event, payload}); }});
    const results = [];
    let run = 0;
    try {
      await withProvider(() => {
        const currentRun = ++run;
        let turn = 0;
        return {async runTurn() {
          turn += 1;
          if (turn === 1) {
            if (currentRun === 1) update([]);
            return {draft: '', toolCalls: [call('read_files', {files: [{path: 'sample.txt'}]}, `${currentRun}-read-1`)]};
          }
          if (currentRun === 1 && turn === 2) {
            return {draft: '', toolCalls: [call('read_files', {files: [{path: 'sample.txt'}]}, '1-read-2')]};
          }
          return {draft: 'done', toolCalls: []};
        }};
      }, async () => {
        const runtime = createAgentLoopRuntime(cwd, context, undefined, observation);
        await runtime({records: [{role: 'user', text: 'first'}]}, {onToolResult: (result) => results.push(result)});
        await runtime({records: [{role: 'user', text: 'next'}]}, {onToolResult: (result) => results.push(result)});
      });
      assert.deepEqual(results.map(({callId, ok}) => ({callId, ok})), [
        {callId: '1-read-1', ok: false}, {callId: '1-read-2', ok: false}, {callId: '2-read-1', ok: true}
      ]);
      const requests = events.filter(({event}) => event === 'provider_request_built').map(({payload}) => payload);
      assert.equal(requests.length, 5);
      assert.ok(requests.slice(0, 3).every(({toolNames}) => !toolNames.includes('read_files')));
      assert.ok(requests.slice(3).every(({toolNames}) => toolNames.includes('read_files')));
      assert.equal(new Set(requests.slice(0, 3).map(({toolSchemaHash}) => toolSchemaHash)).size, 1);
      assert.notEqual(requests[0].toolSchemaHash, requests[3].toolSchemaHash);
    } finally {
      context.close();
    }
  });
});

test('enabled editors have the same schema in normal, plan and readonly runs but keep write policy enforcement', async () => {
  await withWorkspace(async ({cwd, root}) => {
    const {context} = createContext(root, []);
    const events = [];
    const observation = createObservation({enabled: true, emit(event, payload) { events.push({event, payload}); }});
    const calls = [
      call('apply_patch', {patch: '*** Begin Patch\n*** Add File: blocked.txt\n+bad\n*** End Patch'}),
      call('edit_file', {path: 'sample.txt', old_string: 'original', new_string: 'changed'})
    ];
    const effects = [];
    try {
      await withProvider(() => {
        let turn = 0;
        return {async runTurn() {
          return ++turn === 1 ? {draft: '', toolCalls: calls} : {draft: 'done', toolCalls: []};
        }};
      }, async () => {
        const runtime = createAgentLoopRuntime(cwd, context, undefined, observation);
        for (const session of [{interactionMode: 'normal'}, {interactionMode: 'plan'}, {toolPolicy: 'readonly', conversationKind: 'btw'}]) {
          const results = [];
          await runtime({records: [{role: 'user', text: 'test policy'}], ...session}, {
            onToolApprovalRequest() { effects.push('approval'); return {kind: 'deny'}; },
            onToolResult: (result) => results.push(result),
            changeRecorder: {
              captureFileBefore() { effects.push('before'); },
              captureFileAfter() { effects.push('after'); },
              invalidate() { effects.push('invalidate'); }
            }
          });
          assert.equal(results.length, 2);
          assert.ok(results.every(({ok}) => !ok));
          assert.ok(results.every(({text}) => !text.startsWith('Unknown tool:')));
        }
      });
      assert.deepEqual(effects, ['approval', 'approval']);
      const requests = events.filter(({event}) => event === 'provider_request_built').map(({payload}) => payload);
      // readonly 的 BTW 不暴露委派端口；比较相同主运行可用目录下的其他工具。
      const comparableNames = requests.map(({toolNames}) => toolNames.filter((name) => name !== 'run_subagent'));
      assert.ok(comparableNames.every((toolNames) => toolNames.includes('apply_patch') && toolNames.includes('edit_file')));
      assert.ok(comparableNames.every((toolNames) => JSON.stringify(toolNames) === JSON.stringify(comparableNames[0])));
      assert.equal(fs.readFileSync(path.join(cwd, 'sample.txt'), 'utf8'), 'original\n');
    } finally {
      context.close();
    }
  });
});

test('disabled parent Skill tool retains the enabled snapshot for a real independent child Skill scope', async () => {
  await withWorkspace(async ({cwd, root}) => {
    for (const name of ['alpha', 'beta']) {
      const dir = path.join(cwd, '.echo', 'skills', name);
      fs.mkdirSync(dir, {recursive: true});
      fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} workflow\n---\n# Original ${name} instructions\n`);
    }
    const agentsDir = path.join(cwd, '.echo', 'agents');
    fs.mkdirSync(agentsDir, {recursive: true});
    fs.writeFileSync(path.join(agentsDir, 'scoped-reader.md'), [
      '---', 'description: Read with alpha only.', 'capability: readonly', 'tools:', '  - read_files', '  - use_skill',
      'skills:', '  - alpha', '---', '', 'Use only the scoped workflow.'
    ].join('\n'));
    const {context} = createContext(root, ['use_skill', 'read_files']);
    let factories = 0;
    const requests = [];
    const events = [];
    const results = [];
    const observation = createObservation({enabled: true, emit(event, payload) { events.push({event, payload}); }});
    try {
      await withProvider(() => {
        const child = factories++ > 0;
        let turn = 0;
        return {async runTurn(records) {
          turn += 1;
          requests.push({child, records});
          if (!child && turn === 1) {
            // 子运行必须使用父启动时已冻结的正文，而非重新扫描变化后的文件。
            fs.writeFileSync(path.join(cwd, '.echo', 'skills', 'alpha', 'SKILL.md'), 'changed after snapshot');
            return {draft: '', toolCalls: [
              call('use_skill', {name: 'alpha'}, 'parent-skill'),
              call('run_subagent', {agent: 'scoped-reader', task: 'Load alpha and read sample.txt'}, 'delegate')
            ]};
          }
          if (child && turn === 1) return {draft: '', toolCalls: [
            call('use_skill', {name: 'alpha'}, 'child-alpha'),
            call('use_skill', {name: 'beta'}, 'child-beta'),
            call('read_files', {files: [{path: 'sample.txt'}]}, 'child-read')
          ]};
          if (child) {
            const toolResults = records.filter(({role}) => role === 'tool_result');
            assert.equal(toolResults.find(({toolCallId}) => toolCallId === 'child-alpha').ok, true);
            assert.match(toolResults.find(({toolCallId}) => toolCallId === 'child-alpha').text, /Original alpha instructions/);
            assert.equal(toolResults.find(({toolCallId}) => toolCallId === 'child-beta').ok, false);
            assert.equal(toolResults.find(({toolCallId}) => toolCallId === 'child-read').ok, true);
          }
          return {draft: child ? 'child report' : 'done', toolCalls: []};
        }};
      }, async () => {
        const runtime = createAgentLoopRuntime(cwd, context, undefined, observation);
        assert.equal(await runtime({records: [{role: 'user', text: 'delegate'}]}, {onToolResult: (result) => results.push(result)}), 'done');
      });
      assert.equal(factories, 2);
      for (const {child, records} of requests) {
        if (child) {
          assert.match(records[0].text, /Available Skills:/);
          assert.match(records[0].text, /- alpha: alpha workflow/);
          assert.doesNotMatch(records[0].text, /- beta: beta workflow/);
        } else {
          assert.doesNotMatch(records[0].text, /Available Skills:|when the user request clearly matches/i);
        }
      }
      assert.equal(results.find(({callId}) => callId === 'parent-skill').ok, false);
      assert.equal(results.find(({callId}) => callId === 'delegate').text, 'child report');
      const payloads = events.filter(({event}) => event === 'provider_request_built').map(({payload}) => payload);
      assert.ok(payloads.filter(({conversationKind}) => conversationKind === 'primary').every(({toolNames, skillCatalogCount}) =>
        !toolNames.includes('use_skill') && !toolNames.includes('read_files') && skillCatalogCount === 0));
      assert.ok(payloads.filter(({conversationKind}) => conversationKind === 'subagent').every(({toolNames, skillCatalogCount}) =>
        toolNames.includes('use_skill') && toolNames.includes('read_files') && skillCatalogCount === 1));
    } finally {
      context.close();
    }
  });
});

for (const fullAccess of [false, true]) {
  test(`runOnce applies Todo pairing and cannot restore disabled tools with full-access=${fullAccess}`, async () => {
    await withWorkspace(async ({cwd, root}) => {
      const {context} = createContext(root, ['complete_todo', 'apply_patch']);
      const effects = [];
      const requests = [];
      const output = [];
      await withProvider(() => {
        let turn = 0;
        return {async runTurn(records) {
          requests.push(records);
          return ++turn === 1 ? {draft: '', toolCalls: [
            call('create_todos', {items: ['no']}),
            call('complete_todo', {ids: ['todo_1']}),
            call('apply_patch', {patch: '*** Begin Patch\n*** Add File: blocked.txt\n+bad\n*** End Patch'}),
            call('run_bash_command', {command: 'touch allowed-bash.txt'})
          ]} : {draft: 'done', toolCalls: []};
        }};
      }, () => runOnce({
        cwd, userConfigContext: context, fullAccess, prompt: 'test tools',
        mcpManager: createMcpManager(effects),
        debug: {enabled: false, emit() {}},
        hooks: {emit() {}, async flush() {}},
        process: {once() {}, removeListener() {}},
        stdout: {write: (text) => output.push(text)}
      }));
      assert.deepEqual(output, ['done\n']);
      assert.equal(requests.length, 2);
      const results = requests[1].filter(({role}) => role === 'tool_result');
      assert.deepEqual(results.map(({ok}) => ok), [false, false, false, fullAccess]);
      assert.ok(results.slice(0, 3).every(({text}) => text.startsWith('Unknown tool:')));
      if (!fullAccess) assert.match(results[3].text, /requires approval in headless mode/);
      assert.equal(fs.existsSync(path.join(cwd, 'allowed-bash.txt')), fullAccess);
      assert.equal(fs.existsSync(path.join(cwd, 'blocked.txt')), false);
      assert.deepEqual(effects, []);
    });
  });
}

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {isCodeRuntimeAvailable} = require('../../src/tools/code-mode/execution');
const {createToolRegistry} = require('../../src/tools/tool-registry');
const {createToolApprovalResolver} = require('../../src/app/tool-approval/resolver');
const {ToolApprovalContext} = require('../../src/app/state/tool-approval-context');
const {AgentAbortError} = require('../../src/types/agent');
const {withCodeModeProject, codeCall, toolProvider} = require('../helpers/code-mode-project');
const {canSignalChildProcesses} = require('../helpers/process-signals');

const ready = isCodeRuntimeAvailable();
const runtimeSkip = !ready && 'QuickJS/WASM 不可用；禁止弱隔离替代';
const signalSkip = runtimeSkip || (!canSignalChildProcesses() && '当前沙箱拒绝子进程信号，显式跳过取消测试');
const session = {records: [{role: 'user', text: 'inspect local files'}]};
const forbidden = [
  'run_bash_command', 'apply_patch', 'edit_file', 'mcp__private__read',
  'web_fetch', 'web_search', 'ask_user_questions', 'run_subagent', 'run_code'
];
const forbiddenScript = `
  const denied = [];
  for (const name of ${JSON.stringify(forbidden)}) {
    try {
      await tools[name]({});
    } catch (_) {
      denied.push(name);
    }
  }
  const paths = await tools.glob({pattern: '*.txt'});
  const matches = await tools.grep({pattern: 'needle', paths: paths.data.paths});
  const files = await tools.read_files({files: [{path: 'one.txt'}]});
  return {denied, count: files.data.files[0].returned_lines, matches: matches.data.matches.length};
`;

function resultValue(results) {
  assert.equal(results.length, 1);
  assert.equal(results[0].toolName, 'run_code');
  return JSON.parse(results[0].text);
}

test('real loop preserves native definitions, normal/plan parity and disabled prompt size', {skip: runtimeSkip}, async () => {
  await withCodeModeProject(async (fixture) => {
    const names = [];
    for (const enabled of [false, true]) {
      fixture.config.tools.codeMode.enabled = enabled;
      fixture.refresh();
      for (const interactionMode of ['normal', 'plan']) {
        const requests = [];
        fixture.createProvider = () => toolProvider([], requests);
        await fixture.run({...session, interactionMode});
        const definitions = fixture.preparations.at(-1).registry.listDefinitions();
        names.push(definitions.map(({name}) => name));
        assert.equal(names.at(-1).includes('run_code'), enabled);
        for (const name of ['glob', 'grep', 'read_files', 'run_bash_command', 'apply_patch']) {
          assert.ok(names.at(-1).includes(name));
        }
        assert.doesNotMatch(requests[0][0].text, /Failure recovery:|Single async function body/);
        if (enabled) {
          const description = definitions.find(({name}) => name === 'run_code').description;
          for (const fragment of ['async function BODY', 'JSON only', 'has_more', 'native tools', 'No Node', 'Success:', 'Failure recovery:']) {
            assert.ok(description.includes(fragment), fragment);
          }
        }
      }
    }
    assert.deepEqual(names[0], names[1]);
    assert.deepEqual(names[2], names[3]);
    assert.deepEqual(names[2].filter((name) => name !== 'run_code'), names[0]);
  });
});

test('real loop dispatch obeys mode, readonly and headless boundaries without requesting approval', {skip: runtimeSkip}, async () => {
  await withCodeModeProject(async (fixture) => {
    const cases = [
      {name: 'normal', options: {}},
      {name: 'plan', options: {interactionMode: 'plan'}},
      {name: 'readonly', options: {toolPolicy: 'readonly', conversationKind: 'btw'}},
      {name: 'headless deny', options: {executionMode: {kind: 'headless', approvalPolicy: 'deny'}}},
      {name: 'headless full-access', options: {executionMode: {kind: 'headless', approvalPolicy: 'full-access'}}}
    ];
    for (const scenario of cases) {
      fixture.createProvider = () => toolProvider([codeCall(forbiddenScript)]);
      const results = [];
      await fixture.run({...session, ...scenario.options}, {
        onToolApprovalRequest() { assert.fail('只读脚本不得请求审批'); },
        onUserQuestionRequest() { assert.fail('脚本不得等待用户输入'); },
        onToolResult(result) { results.push(result); }
      });
      const value = resultValue(results);
      assert.equal(value.status, 'succeeded', `${scenario.name}: ${JSON.stringify(value)}`);
      assert.deepEqual(value.result, {denied: forbidden, count: 2, matches: 1});
      assert.equal(value.summary.attempted, 3);
      assert.equal(value.summary.completed, 3);
    }
  });
});

test('real approval resolver manual/auto/session allow-all cannot expand script whitelist', {skip: runtimeSkip}, async () => {
  await withCodeModeProject(async (fixture) => {
    for (const mode of ['manual', 'auto', 'allow-all']) {
      const approval = new ToolApprovalContext(() => {});
      if (mode === 'allow-all') approval.toggleAllowAllForSession();
      let reviews = 0;
      let manual = 0;
      const resolver = createToolApprovalResolver({
        cwd: fixture.cwd,
        observation: fixture.observation,
        currentUserRequest: 'inspect local files',
        getRecords: () => session.records,
        interactionMode: 'normal',
        isCurrentTurn: () => true,
        settings: {mode: mode === 'auto' ? 'auto' : 'manual', modelProfileId: 'default'},
        turnUserRecordIndex: 0,
        reviewer: async () => { reviews += 1; return true; },
        toolApproval: {
          getCachedDecision: (call) => approval.getCachedDecision(call),
          requestManual() { manual += 1; return {kind: 'allow_once'}; }
        }
      });
      fixture.createProvider = () => toolProvider([codeCall(forbiddenScript)]);
      const results = [];
      await fixture.run(session, {
        onToolApprovalRequest: (call, request) => resolver.request(call, request),
        onToolResult: (result) => results.push(result)
      });
      assert.deepEqual(resultValue(results).result.denied, forbidden);
      assert.equal(reviews, 0);
      assert.equal(manual, 0);
      assert.equal(approval.hasActiveRequest(), false);
    }
  });
});

test('allowed registry intersection rejects missing script tools and outer removal is not bypassed', {skip: runtimeSkip}, async () => {
  await withCodeModeProject(async (fixture) => {
    fixture.allowedToolNames = new Set(['run_code', 'glob']);
    fixture.createProvider = () => toolProvider([codeCall(`
      const missing = await tools.read_files({files: [{path: 'one.txt'}]});
      const allowed = await tools.glob({pattern: '*.txt'});
      return {missing: missing.error.code, paths: allowed.data.paths};
    `)]);
    const results = [];
    await fixture.run(session, {onToolResult: (result) => results.push(result)});
    const value = resultValue(results).result;
    assert.equal(value.missing, 'invalid_arguments');
    assert.deepEqual(value.paths.map((entry) => path.basename(entry)).sort(), ['one.txt', 'two.txt']);
    const rejected = fixture.lifecycle.find((event) => event.status === 'rejected');
    assert.equal(rejected.result.toolName, 'read_files');
    assert.equal(rejected.scope.toolOrigin.parentToolCallId, 'outer-code');
    fixture.allowedToolNames = new Set(['read_files']);
    fixture.createProvider = () => toolProvider([codeCall('return 42')]);
    const denied = [];
    await fixture.run(session, {onToolResult: (result) => denied.push(result)});
    assert.equal(denied[0].ok, false);
    assert.match(denied[0].text, /Unknown tool: run_code/);
    assert.deepEqual(fixture.preparations.at(-1).registry.listDefinitions().map(({name}) => name), ['read_files']);
  });
});

test('script reads preserve native absolute and parent-relative path capabilities with the fixed run cwd', {skip: runtimeSkip}, async () => {
  await withCodeModeProject(async (fixture) => {
    const externalPath = path.join(fixture.root, 'sibling.txt');
    fs.writeFileSync(externalPath, 'external line\n');
    const files = [{path: '../sibling.txt'}, {path: externalPath}];
    const calls = [
      {callId: 'native-read', toolName: 'read_files', argumentsText: JSON.stringify({files})},
      codeCall(`
        const result = await tools.read_files({files: ${JSON.stringify(files)}});
        return result.data.files.map((file) => ({path: file.path, ok: file.ok, lines: file.returned_lines}));
      `)
    ];
    fixture.createProvider = () => toolProvider(calls);
    const results = [];
    await fixture.run(session, {onToolResult: (result) => results.push(result)});
    assert.equal(results[0].ok, true);
    assert.match(results[0].text, /external line/);
    assert.deepEqual(JSON.parse(results[1].text).result, files.map(({path: filePath}) => ({
      path: filePath, ok: true, lines: 1
    })));
    assert.equal(fixture.preparations[0].options.cwd, fixture.cwd);
  });
});

test('provider continuation contains only the outer pair and selected result, never scriptResult or file bodies', {skip: runtimeSkip}, async () => {
  await withCodeModeProject(async (fixture) => {
    const requests = [];
    const code = `
      const found = await tools.glob({pattern: '*.txt'});
      const matches = await tools.grep({pattern: 'needle', paths: found.data.paths});
      const text = await tools.read_files({files: [{path: matches.data.matches[0].path}]});
      return {lines: text.data.files[0].returned_lines};
    `;
    fixture.createProvider = () => toolProvider([codeCall(code)], requests);
    const records = [];
    const results = [];
    await fixture.run(session, {
      onCodeExecutionRecords(batch) { records.push(...batch); },
      onToolResult(result) { results.push(result); }
    });
    assert.deepEqual(resultValue(results).result, {lines: 2});
    assert.equal(requests.length, 2);
    const toolRecords = requests[1].filter((record) => ['tool_call', 'tool_result'].includes(record.role));
    assert.deepEqual(toolRecords.map((record) => [record.role, record.toolName, record.toolCallId]), [
      ['tool_call', 'run_code', 'outer-code'], ['tool_result', 'run_code', 'outer-code']
    ]);
    for (const collection of [requests, results, records, fixture.lifecycle, fixture.hookEvents, fixture.debugEvents]) {
      const json = JSON.stringify(collection);
      assert.doesNotMatch(json, /PRIVATE_FILE_BODY|scriptResult/);
    }
    assert.equal(records.filter((record) => record.event === 'start').length, 1);
    assert.equal(records.filter((record) => record.event === 'end').length, 1);
    assert.equal(records.filter((record) => record.event === 'call_start').length, 3);
    const inner = fixture.lifecycle.filter((event) => event.scope.toolOrigin);
    assert.equal(inner.length, 6);
    const executionId = records[0].executionId;
    for (let number = 1; number <= 3; number += 1) {
      const childCallId = `${executionId}:${number}`;
      const events = inner.filter((event) => event.scope.toolOrigin.childCallId === childCallId);
      assert.deepEqual(events.map((event) => event.event), ['start', 'end']);
      assert.deepEqual(events[0].scope.toolOrigin, {
        kind: 'code_execution', executionId, parentToolCallId: 'outer-code', childCallId
      });
      assert.equal(events[1].status, 'succeeded');
    }
    const hooks = fixture.hookEvents.filter((event) => event.payload.toolOrigin);
    assert.equal(hooks.length, 6);
    for (const {payload} of hooks) {
      assert.equal(payload.argumentsText, undefined);
      assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 1024);
    }
    assert.ok(Buffer.byteLength(JSON.stringify(records)) < 32768);
    assert.ok(!requests[1].some((record) => record.role === 'code_execution'));
  });
});

test('inner lifecycle failure is paired once and does not leak thrown host error bodies', {skip: runtimeSkip}, async () => {
  await withCodeModeProject(async (fixture) => {
    fixture.decorateRegistry = (registry) => {
      const handlers = registry.listDefinitions().map(({name}) => registry.getHandler(name));
      const index = handlers.findIndex(({definition}) => definition.name === 'read_files');
      handlers[index] = {
        ...handlers[index],
        async executeScript() { throw new Error('PRIVATE_FILE_BODY authorization: secret'); }
      };
      return createToolRegistry(handlers);
    };
    fixture.createProvider = () => toolProvider([codeCall(`
      const result = await tools.read_files({files: [{path: 'one.txt'}]});
      return {error: result.error.code};
    `)]);
    const results = [];
    await fixture.run(session, {onToolResult: (result) => results.push(result)});
    assert.deepEqual(resultValue(results).result, {error: 'tool_failed'});
    const inner = fixture.lifecycle.filter((event) => event.scope.toolOrigin);
    assert.deepEqual(inner.map((event) => event.event), ['start', 'end']);
    assert.equal(inner[1].status, 'failed');
    assert.doesNotMatch(JSON.stringify([inner, fixture.hookEvents, fixture.debugEvents]), /PRIVATE_FILE_BODY|authorization: secret/);
  });
});

test('abort pairs inner lifecycle once, suppresses provider continuation and isolates the next run', {skip: signalSkip}, async () => {
  await withCodeModeProject(async (fixture) => {
    const controller = new AbortController();
    fixture.decorateRegistry = (registry) => {
      const handlers = registry.listDefinitions().map(({name}) => registry.getHandler(name));
      const index = handlers.findIndex(({definition}) => definition.name === 'read_files');
      handlers[index] = {
        ...handlers[index],
        async executeScript(_args, _call, options) {
          assert.ok(options.abortSignal);
          controller.abort();
          throw new AgentAbortError();
        }
      };
      return createToolRegistry(handlers);
    };
    const requests = [];
    fixture.createProvider = () => toolProvider([codeCall('await tools.read_files({files:[{path:"one.txt"}]}); return 1')], requests);
    await assert.rejects(fixture.run({...session, abortSignal: controller.signal}), {name: 'AgentAbortError'});
    assert.equal(requests.length, 1);
    const inner = fixture.lifecycle.filter((event) => event.scope.toolOrigin);
    assert.deepEqual(inner.map((event) => event.event), ['start', 'end']);
    assert.equal(inner[1].status, 'cancelled');
    fixture.decorateRegistry = undefined;
    fixture.createProvider = () => toolProvider([codeCall('return 2', 'next-run')]);
    const results = [];
    await fixture.run(session, {onToolResult: (result) => results.push(result)});
    assert.equal(resultValue(results).result, 2);
    assert.equal(fixture.lifecycle.filter((event) => event.scope.toolOrigin).length, 2);
  });
});

test('config refresh during execution freezes registry until the next real loop run', {skip: runtimeSkip}, async () => {
  await withCodeModeProject(async (fixture) => {
    const oldSnapshot = fixture.context.capture();
    let changed = false;
    fixture.decorateRegistry = (registry) => {
      const handlers = registry.listDefinitions().map(({name}) => registry.getHandler(name));
      const index = handlers.findIndex(({definition}) => definition.name === 'read_files');
      const original = handlers[index];
      handlers[index] = {
        ...original,
        async executeScript(...args) {
          if (!changed) {
            changed = true;
            fixture.config.tools.codeMode.enabled = false;
            fixture.refresh();
          }
          return original.executeScript(...args);
        }
      };
      return createToolRegistry(handlers);
    };
    fixture.createProvider = () => toolProvider([codeCall(`
      await tools.read_files({files: [{path: 'one.txt'}]});
      const second = await tools.read_files({files: [{path: 'two.txt'}]});
      return second.ok;
    `)]);
    const results = [];
    await fixture.run(session, {onToolResult: (result) => results.push(result)});
    assert.equal(resultValue(results).result, true);
    assert.equal(oldSnapshot.resolveLlmConfig().tools.codeMode.enabled, true);
    assert.equal(fixture.context.capture().resolveLlmConfig().tools.codeMode.enabled, false);
    fixture.createProvider = () => toolProvider([]);
    await fixture.run(session);
    const names = fixture.preparations.at(-1).registry.listDefinitions().map(({name}) => name);
    assert.ok(!names.includes('run_code'));
    assert.ok(names.includes('read_files'));
  });
});

test('enabling Code Mode during a disabled run cannot add a handler until the next run', {skip: runtimeSkip}, async () => {
  await withCodeModeProject(async (fixture) => {
    fixture.config.tools.codeMode.enabled = false;
    fixture.refresh();
    const oldSnapshot = fixture.context.capture();
    fixture.createProvider = () => {
      const provider = toolProvider([codeCall('return 1')]);
      return {
        async runTurn(...args) {
          fixture.config.tools.codeMode.enabled = true;
          fixture.refresh();
          return provider.runTurn(...args);
        }
      };
    };
    const denied = [];
    await fixture.run(session, {onToolResult: (result) => denied.push(result)});
    assert.equal(denied[0].ok, false);
    assert.match(denied[0].text, /Unknown tool: run_code/);
    assert.equal(oldSnapshot.resolveLlmConfig().tools.codeMode.enabled, false);
    assert.ok(!fixture.preparations[0].registry.getHandler('run_code'));
    fixture.createProvider = () => toolProvider([codeCall('return 2')]);
    const enabled = [];
    await fixture.run(session, {onToolResult: (result) => enabled.push(result)});
    assert.equal(resultValue(enabled).result, 2);
    assert.ok(fixture.preparations.at(-1).registry.getHandler('read_files'));
  });
});

test('real subagent loops never inherit run_code and reject provider attempts beyond their ceilings', {skip: runtimeSkip}, async () => {
  await withCodeModeProject(async (fixture) => {
    const childDefinitions = [];
    fixture.createProvider = (prepared, options) => {
      if (options.allowedToolNames) {
        childDefinitions.push(prepared.registry.listDefinitions().map(({name}) => name));
        const requests = [];
        const provider = toolProvider([codeCall('return "unexpected"')], requests);
        return {
          async runTurn(...args) {
            const turn = await provider.runTurn(...args);
            if (requests.length === 2) {
              const result = requests[1].find((record) => record.role === 'tool_result');
              assert.equal(result.ok, false);
              assert.match(result.text, /Unknown tool: run_code/);
            }
            return turn;
          }
        };
      }
      return toolProvider(['explorer', 'worker'].map((agent, index) => ({
        callId: `delegate-${index}`,
        toolName: 'run_subagent',
        argumentsText: JSON.stringify({agent, task: 'inspect without scripts'})
      })));
    };
    await fixture.run(session, {onToolApprovalRequest() { assert.fail('未知子工具不得请求审批'); }});
    assert.equal(childDefinitions.length, 2);
    assert.ok(childDefinitions.every((names) => !names.includes('run_code')));
    assert.ok(childDefinitions.every((names) => names.includes('read_files')));
    assert.ok(!fixture.lifecycle.some((event) => event.scope.toolOrigin));
    const agentsDir = path.join(fixture.cwd, '.echo', 'agents');
    fs.mkdirSync(agentsDir, {recursive: true});
    for (const capability of ['readonly', 'general']) {
      fs.writeFileSync(path.join(agentsDir, `${capability}-bad.md`), [
        '---', 'description: Invalid script escalation', `capability: ${capability}`,
        'tools:', '  - run_code', '---', 'Do not execute.'
      ].join('\n'));
    }
    fixture.createProvider = () => toolProvider([]);
    await fixture.run(session);
    const definition = fixture.preparations.at(-1).registry.getHandler('run_subagent').definition;
    assert.ok(!definition.parameters.properties.agent.enum.includes('readonly-bad'));
    assert.ok(!definition.parameters.properties.agent.enum.includes('general-bad'));
  });
});

test('fresh runtime probe failure hides definitions, emits one notice and fails explicit calls without rewriting config', () => {
  const helper = require.resolve('../helpers/code-mode-project');
  const child = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const cp = require('node:child_process');
    const original = cp.spawnSync;
    let probes = 0;
    cp.spawnSync = (command, args, options) => {
      if (command === process.execPath && args?.at(-1) === '--probe') {
        probes += 1;
        return {status: 1};
      }
      return original(command, args, options);
    };
    const {withCodeModeProject, codeCall, toolProvider} = require(${JSON.stringify(helper)});
    withCodeModeProject(async (fixture) => {
      const before = fs.readFileSync(fixture.configPath, 'utf8');
      const notices = [];
      const results = [];
      for (let index = 0; index < 2; index += 1) {
        fixture.createProvider = () => toolProvider([codeCall('return 1')]);
        await fixture.run({records: [{role: 'user', text: 'inspect'}]}, {
          onLocalNotice: (text) => notices.push(text),
          onToolResult: (result) => results.push(result)
        });
        const names = fixture.preparations.at(-1).registry.listDefinitions().map(({name}) => name);
        assert.ok(!names.includes('run_code'));
        assert.ok(names.includes('read_files'));
      }
      assert.equal(notices.length, 1);
      assert.equal(probes, 1);
      assert.equal(results.length, 2);
      assert.ok(results.every((result) => JSON.parse(result.text).error.code === 'runtime_unavailable'));
      assert.equal(fs.readFileSync(fixture.configPath, 'utf8'), before);
    }).catch((error) => { console.error(error); process.exitCode = 1; });
  `], {encoding: 'utf8', timeout: 15000});
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const agentSetupModule = require('../../src/agent/agent-setup');
const {createSubagentLoopRuntime} = require('../../src/agent/loop-runtime/subagent-loop-runtime');
const {createObservation} = require('../../src/observation/observation-projector');
const {createSkillManager} = require('../../src/skills/skill-manager');
const {captureSkillSnapshot} = require('../../src/skills/skill-snapshot');
const {createDefaultToolRegistry} = require('../../src/tools/tool-registry');
const {freezeSubagentDefinition} = require('../../src/agent/subagent/definition');

const BASE_CONFIG = {
  agentType: 'fake',
  apiKey: '',
  model: 'fake-subagent',
  contextWindow: 128000,
  tools: {
    bash: {timeoutMs: 1000, maxOutputBytes: 4096},
    sandbox: {mode: 'off', network: false, extraWritablePaths: []}
  }
};

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-subagent-skill-scope-'));
  const cwd = path.join(root, 'project');
  fs.mkdirSync(cwd, {recursive: true});
  return {cwd, root};
}

function writeSkill(cwd, name, description, content) {
  const dir = path.join(cwd, '.echo', 'skills', name);
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${content}\n`, 'utf8');
  return path.join(dir, 'SKILL.md');
}

// 全部 skill 目录都指向工作区，禁止扫描或写入真实用户级与内置 skill。
function createIsolatedManager(workspace) {
  return createSkillManager({
    builtinSkillsDir: path.join(workspace.root, 'builtin-skills'),
    cwd: workspace.cwd,
    projectSkillsDir: path.join(workspace.cwd, '.echo', 'skills'),
    userSkillsDir: path.join(workspace.root, 'user-skills')
  });
}

function createSkillSnapshot(workspace) {
  return captureSkillSnapshot(createIsolatedManager(workspace));
}

function createConfigSnapshot(config) {
  return {
    revision: 1,
    getAppSettings() {
      return {agentInstructionFileName: 'AGENTS.md', compactionThresholdRatio: 0.8, skillCatalogContextRatio: 0.02, toolApprovalMode: 'manual'};
    },
    getLlmModelConfigInfo() {
      return {kind: 'profiles', selectedModelId: 'parent', models: [{id: 'parent', provider: 'fake', model: config.model}]};
    },
    resolveLlmConfig() {
      return config;
    },
    resolveLlmConfigStrict() {
      return config;
    }
  };
}

function readonlyDefinition(skillNames, overrides = {}) {
  const definition = {
    name: 'explorer',
    description: 'Readonly investigator.',
    effortPolicy: 'inherit',
    executionPolicy: 'readonly_investigation',
    includeMcpTools: false,
    localToolNames: ['read_files', 'grep', 'run_bash_command', 'use_skill'],
    prompt: '# Explorer Subagent'
  };
  if (skillNames !== undefined) {
    definition.skillNames = skillNames;
  }
  return freezeSubagentDefinition({...definition, ...overrides});
}

function generalDefinition(skillNames, overrides = {}) {
  const definition = {
    name: 'worker',
    description: 'General worker.',
    effortPolicy: 'inherit',
    executionPolicy: 'general_purpose',
    includeMcpTools: true,
    localToolNames: ['read_files', 'grep', 'run_bash_command', 'apply_patch', 'create_todos', 'use_skill'],
    prompt: '# Worker Subagent'
  };
  if (skillNames !== undefined) {
    definition.skillNames = skillNames;
  }
  return freezeSubagentDefinition({...definition, ...overrides});
}

function createInheritedContext(snapshot, contextRatio = 0.02) {
  return {
    agentInstructions: [],
    memoryPrompt: {sections: [], estimatedTokens: 0, userMemoryCount: 0, agentMemory: {mode: 'none', text: '', estimatedTokens: 0, catalogCount: 0, itemCount: 0}},
    skillCatalogContextRatio: contextRatio,
    skillSnapshot: snapshot
  };
}

/**
 * 创建一个 prepareAgent 补丁作用域：stub 按子运行启动顺序消费脚本队列。
 * 并行子运行必须共享同一作用域；如果每个 runChild 各自安装补丁，先结束者的
 * finally 会把嵌套捕获的他人 stub 写回导出位，在同进程顺序执行后续测试文件时造成永久泄漏。
 */
function createChildAgentScope(cwd) {
  const originalPrepareAgent = agentSetupModule.prepareAgent;
  const preparations = [];
  const scripts = [];
  let nextScript = 0;
  let restored = false;
  agentSetupModule.prepareAgent = (options) => {
    // 运行器会在同一子进程内顺序执行多个测试文件：其他文件以 configSnapshot 形态调用时
    // 按真实 prepareAgent 契约回退到原始装配，既不崩溃也不污染本用例的 preparations。
    if (options.config === undefined) {
      return originalPrepareAgent(options);
    }
    const runTurn = scripts[nextScript++];
    const registry = createDefaultToolRegistry(options.config, cwd, undefined, {
      allowedToolNames: options.allowedToolNames,
      ...(options.skillRegistry ? {skillRegistry: options.skillRegistry} : {})
    });
    preparations.push({options, registry});
    return {agent: {async runTurn(records, callbacks) { return runTurn(records, callbacks); }}, config: options.config, registry};
  };
  return {
    preparations,
    startChild(inherited, definition, config, runTurn, executionMode = {kind: 'interactive'}) {
      scripts.push(runTurn);
      const events = [];
      const observation = createObservation({enabled: true, emit(event, payload) {events.push({event, payload});}});
      return createSubagentLoopRuntime(cwd, inherited, definition, observation)({
        configSnapshot: createConfigSnapshot(config),
        executionMode,
        interactionMode: 'normal',
        metadata: {agentName: definition.name, depth: 1, parentToolCallId: 'outer-call', runId: 'run-1'},
        task: 'child task'
      }).then((answer) => ({answer, events}));
    },
    restore() {
      if (!restored) {
        restored = true;
        agentSetupModule.prepareAgent = originalPrepareAgent;
      }
    }
  };
}

/**
 * 运行一次真实子 loop：独立补丁作用域内装配注入 skillRegistry 的默认 registry 加受控 fake agent。
 */
async function runChild(cwd, inherited, definition, config, runTurn, executionMode = {kind: 'interactive'}) {
  const scope = createChildAgentScope(cwd);
  try {
    const {answer, events} = await scope.startChild(inherited, definition, config, runTurn, executionMode);
    return {answer, events, preparations: scope.preparations};
  } finally {
    scope.restore();
  }
}

function requestPayloads(events) {
  return events.filter((event) => event.event === 'provider_request_built').map((event) => event.payload);
}

test('child scope keeps prompt catalog and use_skill loading on the same allowlist', async () => {
  const workspace = createWorkspace();
  try {
    writeSkill(workspace.cwd, 'review-skill', 'Review a bounded area of the code.', '# Review instructions');
    writeSkill(workspace.cwd, 'unit-test', 'Run and interpret unit tests.', '# Unit test instructions');
    writeSkill(workspace.cwd, 'extra-skill', 'Unrelated extra skill.', '# Extra instructions');
    const snapshot = createSkillSnapshot(workspace);
    const inherited = createInheritedContext(snapshot);
    const definition = readonlyDefinition(['review-skill', 'missing-skill']);
    let childTurn = 0;
    const childRecords = [];
    const result = await runChild(workspace.cwd, inherited, definition, BASE_CONFIG, (records) => {
      childTurn += 1;
      childRecords.push(records);
      if (childTurn === 1) {
        return {draft: '', toolCalls: [{callId: 'skill-call', toolName: 'use_skill', argumentsText: '{"name":"unit-test"}'}]};
      }
      return {draft: 'child report', toolCalls: []};
    });

    // system prompt 只公布 scope 内 Skill，且正文不进入 prompt。
    const systemPrompt = childRecords[0][0].text;
    assert.match(systemPrompt, /Available Skills:/u);
    assert.match(systemPrompt, /- review-skill: Review a bounded area of the code\./u);
    assert.doesNotMatch(systemPrompt, /unit-test/u);
    assert.doesNotMatch(systemPrompt, /extra-skill/u);
    assert.doesNotMatch(systemPrompt, /missing-skill/u);
    assert.doesNotMatch(systemPrompt, /# Review instructions/u);

    // 伪造的未授权 use_skill 调用失败且 available_skills 限制在 scope 内；continuation 不受影响。
    const skillResult = childRecords[1].find((record) => record.role === 'tool_result');
    assert.equal(skillResult.ok, false);
    assert.match(skillResult.text, /not available for this agent/u);
    assert.match(skillResult.text, /available_skills:\n- review-skill/u);
    assert.equal(skillResult.text.includes('# Unit test instructions'), false);
    assert.equal(result.answer, 'child report');

    // Skill 策略不改变 readonly 工具边界：不出现 apply_patch、run_subagent 或提问工具。
    const toolNames = new Set(result.preparations[0].registry.listDefinitions().map((definition) => definition.name));
    assert.equal(toolNames.has('use_skill'), true);
    assert.equal(toolNames.has('apply_patch'), false);
    assert.equal(toolNames.has('run_subagent'), false);
    assert.equal(toolNames.has('ask_user_questions'), false);
    const payloads = requestPayloads(result.events);
    assert.equal(payloads[0].skillCatalogCount, 1);
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('child projects its own catalog budget from the child context window', async () => {
  const workspace = createWorkspace();
  try {
    for (const name of ['review-skill', 'unit-test', 'extra-skill']) {
      writeSkill(workspace.cwd, name, `Long description for ${name} that would consume the child budget quickly.`, `# ${name}`);
    }
    const snapshot = createSkillSnapshot(workspace);
    const inherited = createInheritedContext(snapshot);
    const definition = readonlyDefinition(undefined);
    const smallWindow = await runChild(workspace.cwd, inherited, definition, {...BASE_CONFIG, contextWindow: 2000}, () => ({draft: 'done', toolCalls: []}));
    const largeWindow = await runChild(workspace.cwd, inherited, definition, BASE_CONFIG, () => ({draft: 'done', toolCalls: []}));

    const smallPayload = requestPayloads(smallWindow.events)[0];
    const largePayload = requestPayloads(largeWindow.events)[0];
    // 子运行不继承父投影：小窗口子模型独立进入 names_only，大窗口同一 scope 保持 full。
    assert.equal(smallPayload.skillCatalogMode, 'names_only');
    assert.equal(largePayload.skillCatalogMode, 'full');
    assert.equal(smallPayload.skillCatalogCount, 3);
    assert.equal(largePayload.skillCatalogCount, 3);
    assert.ok(smallPayload.skillCatalogOriginalTokens > smallPayload.skillCatalogTokens);
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('definition without use_skill keeps an empty skill catalog and rejects forged calls', async () => {
  const workspace = createWorkspace();
  try {
    writeSkill(workspace.cwd, 'review-skill', 'Review a bounded area of the code.', '# Review instructions');
    const snapshot = createSkillSnapshot(workspace);
    const inherited = createInheritedContext(snapshot);
    const definition = readonlyDefinition(['review-skill'], {localToolNames: ['read_files', 'grep']});
    let childTurn = 0;
    const childRecords = [];
    const result = await runChild(workspace.cwd, inherited, definition, BASE_CONFIG, (records) => {
      childTurn += 1;
      childRecords.push(records);
      if (childTurn === 1) {
        return {draft: '', toolCalls: [{callId: 'forged', toolName: 'use_skill', argumentsText: '{"name":"review-skill"}'}]};
      }
      return {draft: 'child report', toolCalls: []};
    });

    assert.doesNotMatch(childRecords[0][0].text, /Available Skills:/u);
    const payloads = requestPayloads(result.events);
    assert.equal(payloads[0].skillCatalogCount, 0);
    assert.equal(result.preparations[0].registry.getHandler('use_skill'), undefined);
    const forged = childRecords[1].find((record) => record.role === 'tool_result');
    assert.equal(forged.ok, false);
    assert.match(forged.text, /Unknown tool: use_skill/u);
    assert.equal(forged.text.includes('# Review instructions'), false);
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('parallel and consecutive delegations share the snapshot but keep isolated scopes', async () => {
  const workspace = createWorkspace();
  const scope = createChildAgentScope(workspace.cwd);
  try {
    const reviewPath = writeSkill(workspace.cwd, 'review-skill', 'Review a bounded area of the code.', '# Review original');
    writeSkill(workspace.cwd, 'unit-test', 'Run and interpret unit tests.', '# Unit test instructions');
    const snapshot = createSkillSnapshot(workspace);
    const inherited = createInheritedContext(snapshot);

    // 并行只读子运行使用不同 allowlist，各自 scope 互不合并；两个子运行共享同一补丁作用域，脚本按启动顺序消费。
    const leftPromise = scope.startChild(inherited, readonlyDefinition(['review-skill']), BASE_CONFIG, () => ({draft: 'left report', toolCalls: []}));
    const rightPromise = scope.startChild(inherited, readonlyDefinition(['unit-test']), BASE_CONFIG, () => ({draft: 'right report', toolCalls: []}));
    await Promise.all([leftPromise, rightPromise]);
    assert.match(scope.preparations[0].registry.listSkillCatalog().map(({name}) => name).join(','), /^review-skill$/u);
    assert.match(scope.preparations[1].registry.listSkillCatalog().map(({name}) => name).join(','), /^unit-test$/u);

    // 连续 general 委派从同一快照派生，但不继承前一次运行的允许名称或已加载正文。
    await scope.startChild(inherited, generalDefinition(['review-skill']), BASE_CONFIG, () => ({draft: 'first', toolCalls: []}));
    const firstHandler = scope.preparations[2].registry.getHandler('use_skill');
    const probeCall = {callId: 'probe-1', toolName: 'use_skill', argumentsText: ''};
    const firstLoaded = firstHandler.execute({name: 'review-skill'}, probeCall);
    assert.equal(firstLoaded.ok, true);
    assert.match(firstLoaded.text, /# Review original/u);
    assert.equal(firstHandler.execute({name: 'unit-test'}, probeCall).ok, false);

    // 捕获快照后修改文件与启用状态，已捕获快照仍保持原状。
    fs.writeFileSync(reviewPath, '---\nname: review-skill\ndescription: Rewritten.\n---\n\n# Rewritten body\n', 'utf8');
    // 状态写入全部落在工作区临时目录，避免触碰真实用户级 skills 状态。
    const stateManager = createIsolatedManager(workspace);
    stateManager.saveSkillStates(stateManager.listSkills().map((item) => ({...item, enabled: false})));
    await scope.startChild(inherited, generalDefinition(['review-skill']), BASE_CONFIG, () => ({draft: 'second', toolCalls: []}));
    const secondLoaded = scope.preparations[3].registry.getHandler('use_skill').execute({name: 'review-skill'}, {callId: 'probe-2', toolName: 'use_skill', argumentsText: ''});
    assert.equal(secondLoaded.ok, true);
    assert.match(secondLoaded.text, /# Review original/u);
  } finally {
    scope.restore();
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('skill policy does not change general headless approval boundaries', async () => {
  const workspace = createWorkspace();
  try {
    writeSkill(workspace.cwd, 'review-skill', 'Review a bounded area of the code.', '# Review instructions');
    const snapshot = createSkillSnapshot(workspace);
    const inherited = createInheritedContext(snapshot);
    const definition = generalDefinition(['review-skill']);
    let childTurn = 0;
    const childRecords = [];
    const result = await runChild(
      workspace.cwd,
      inherited,
      definition,
      BASE_CONFIG,
      (records) => {
        childTurn += 1;
        childRecords.push(records);
        if (childTurn === 1) {
          return {draft: '', toolCalls: [{callId: 'bash-call', toolName: 'run_bash_command', argumentsText: '{"command":"touch approval-required.txt"}'}]};
        }
        return {draft: 'child report', toolCalls: []};
      },
      {kind: 'headless', approvalPolicy: 'deny'}
    );

    const bashResult = childRecords[1].find((record) => record.role === 'tool_result');
    assert.equal(bashResult.ok, false);
    assert.match(bashResult.text, /requires approval in headless mode/u);
    const toolNames = new Set(result.preparations[0].registry.listDefinitions().map((definition) => definition.name));
    assert.deepEqual([...toolNames].sort(), ['apply_patch', 'create_todos', 'grep', 'read_files', 'run_bash_command', 'use_skill']);
    assert.equal(result.answer, 'child report');
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

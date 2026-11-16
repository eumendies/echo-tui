const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const {createSubagentToolPort} = require('../../src/agent/subagent/runtime');
const {createSubagentLoopRuntime} = require('../../src/agent/loop-runtime/subagent-loop-runtime');
const agentSetupModule = require('../../src/agent/agent-setup');
const {createProjectKey} = require('../../src/persistence/project-key');
const {disabledObservation} = require('../../src/observation/observation');

const {createSkillManager} = require('../../src/skills/skill-manager');
const {captureSkillSnapshot} = require('../../src/skills/skill-snapshot');

const TEST_CONFIG = {
  agentType: 'fake',
  apiKey: '',
  model: 'fake-worker',
  contextWindow: 128000,
  tools: {
    bash: {timeoutMs: 1000, maxOutputBytes: 4096},
    sandbox: {mode: 'off', network: false, extraWritablePaths: []}
  }
};

const GIT_IDENTITY = [
  '-c', 'user.name=Echo Test',
  '-c', 'user.email=test@example.com',
  '-c', 'commit.gpgsign=false',
  '-c', 'init.defaultBranch=main'
];

function gitEnvironment() {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 'Echo Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Echo Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null'
  };
}

function runGit(cwd, args) {
  return execFileSync('git', [...GIT_IDENTITY, ...args], {cwd, encoding: 'utf8', env: gitEnvironment()}).trim();
}

function createConfigSnapshot() {
  return {
    revision: 3,
    getMainAgentToolsConfig() {
      return {disabledTools: []};
    },
    getAppSettings() {
      return {
        agentInstructionFileName: 'AGENTS.md',
        compactionThresholdRatio: 0.8,
        skillCatalogContextRatio: 0.02,
        toolApprovalMode: 'manual'
      };
    },
    getLlmModelConfigInfo() {
      return {kind: 'profiles', selectedModelId: 'parent', models: [{id: 'parent', provider: 'fake', model: 'parent-model'}]};
    },
    resolveLlmConfig() {
      return TEST_CONFIG;
    },
    resolveLlmConfigStrict() {
      return TEST_CONFIG;
    },
    resolveLlmConfigForProfile() {
      return TEST_CONFIG;
    }
  };
}

function createRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-managed-workspace-'));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  fs.mkdirSync(repo, {recursive: true});
  fs.mkdirSync(home, {recursive: true});
  runGit(repo, ['init']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'base\n');
  runGit(repo, ['add', '--all']);
  runGit(repo, ['commit', '-m', 'base']);
  return {home, repo, root};
}

function createInheritedContext(cwd) {
  return {
    agentInstructions: [],
    memoryPrompt: {estimatedTokens: 0, sections: []},
    skillCatalogContextRatio: 0.02,
    skillSnapshot: captureSkillSnapshot(createSkillManager({cwd}))
  };
}

function createPort(fixture, overrides = {}) {
  const snapshot = createConfigSnapshot();
  return createSubagentToolPort({
    callbacks: {},
    configSnapshot: snapshot,
    createRuntime: () => async () => 'worker report',
    cwd: fixture.repo,
    executionMode: {kind: 'interactive'},
    getInheritedContext: () => createInheritedContext(fixture.repo),
    homedir: fixture.home,
    observation: disabledObservation,
    publishRecords() {},
    workspaceStoreOptions: {rootDir: path.join(fixture.root, 'store')},
    ...overrides
  });
}

test('worker port probes, allocates, and runs each delegation in its own managed worktree', async () => {
  const fixture = createRoot();
  const records = [];
  const captured = [];
  const port = createPort(fixture, {
    createRuntime: () => async (input) => {
      captured.push(input);
      fs.writeFileSync(path.join(input.workspace.execCwd, 'worker-output.txt'), 'from worker\n');
      return 'worker report';
    },
    publishRecords(next) {
      records.push(...next);
    }
  });

  const probe = await port.probeWorkspace();
  assert.equal(probe.kind, 'git');
  const call = {callId: 'outer-1', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"edit"}'};
  const allocation = await port.allocateWorkerWorkspace({call, probe});
  assert.equal(allocation.kind, 'ok');
  assert.notEqual(allocation.workspace.execCwd, fixture.repo);
  assert.equal(allocation.workspace.git.baseCommit, probe.baseCommit);

  const changeRecorder = {
    captureFileAfter() {
      throw new Error('worktree edits must not enter the parent change recorder');
    },
    captureFileBefore() {
      throw new Error('worktree edits must not enter the parent change recorder');
    },
    markUntracked() {}
  };
  const result = await port.run('worker', 'edit the project', call, {
    changeRecorder,
    subagentWorkspace: {kind: 'managed_worktree', runId: allocation.runId, workspace: allocation.workspace}
  });

  assert.equal(result.ok, true);
  // 交接排在报告之前：外层预览是头部有界的，基线定位必须先占住预算。
  assert.match(result.text, /^## Worker Workspace Handoff/u);
  assert.match(result.text, /worker report$/u);
  assert.match(result.text, /Integration: not applied/u);
  // 子运行的 identity 与登记复用调度器预留的 runId。
  assert.equal(captured.length, 1);
  assert.equal(records.find((record) => record.event.kind === 'start').runId, allocation.runId);

  // 成果保留在自己的 worktree 内，父工作区不受影响。
  assert.equal(fs.existsSync(path.join(fixture.repo, 'worker-output.txt')), false);
  assert.equal(fs.existsSync(path.join(allocation.workspace.execCwd, 'worker-output.txt')), true);

  const store = require('../../src/agent/subagent/workspace/registry').createWorkerWorkspaceStore({rootDir: path.join(fixture.root, 'store')});
  const entry = store.getEntry(fixture.repo, allocation.workspace.workspaceId);
  assert.equal(entry.kind, 'ok');
  assert.equal(entry.entry.status, 'completed');
  assert.equal(entry.entry.owner.sessionId, undefined);
  assert.equal(entry.entry.owner.runId, allocation.runId);
  // 成果就是 worktree 里的文件本身：不再导出 manifest 或 artifact 副本。
  assert.equal(fs.existsSync(path.join(allocation.workspace.execCwd, 'worker-output.txt')), true);
});

test('a long worker report cannot push the workspace handoff out of the bounded tool result', async () => {
  const fixture = createRoot();
  const longReport = 'detail '.repeat(40000);
  const port = createPort(fixture, {
    createRuntime: () => async (input) => {
      fs.writeFileSync(path.join(input.workspace.execCwd, 'changed.txt'), 'changed\n');
      return longReport;
    }
  });
  const handler = require('../../src/tools/run-subagent-tool-handler').createRunSubagentToolHandler(port);
  const probe = await port.probeWorkspace();
  const call = {callId: 'outer-long', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"long"}'};
  const allocation = await port.allocateWorkerWorkspace({call, probe});
  assert.equal(allocation.kind, 'ok');

  // 调度器预分配的工作区通过执行选项进入端口；handler 只负责最终预算。
  const result = await handler.execute(
    {agent: 'worker', task: 'write a long report'},
    call,
    {subagentWorkspace: {kind: 'managed_worktree', runId: allocation.runId, workspace: allocation.workspace}}
  );

  assert.equal(result.ok, true);
  // 头部预览必须完整保留基线、工作区定位与自查命令，报告尾部被预算裁掉。
  assert.match(result.text, /^## Worker Workspace Handoff/u);
  assert.match(result.text, /Base commit: [0-9a-f]{40,64}/u);
  // 交接说明对比对象是冻结基线而不是 HEAD/index；不手把手教 git 命令。
  assert.match(result.text, /Base commit: [0-9a-f]{40,64} — compare workspace changes against this commit, not HEAD or the index/u);
  assert.ok(Buffer.byteLength(result.text, 'utf8') <= 65536);
});

test('worker port keeps a failed delegation visible and never falls back to the parent directory', async () => {
  const fixture = createRoot();
  const port = createPort(fixture, {
    createRuntime: () => async () => {
      throw new Error('provider exploded');
    }
  });
  const probe = await port.probeWorkspace();
  const call = {callId: 'outer-fail', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"fail"}'};
  const allocation = await port.allocateWorkerWorkspace({call, probe});
  assert.equal(allocation.kind, 'ok');

  const result = await port.run('worker', 'fail the task', call, {
    subagentWorkspace: {kind: 'managed_worktree', runId: allocation.runId, workspace: allocation.workspace}
  });
  assert.equal(result.ok, false);
  assert.match(result.text, /Subagent failure: .*provider exploded/u);
  assert.match(result.text, /## Worker Workspace Handoff/u);

  const store = require('../../src/agent/subagent/workspace/registry').createWorkerWorkspaceStore({rootDir: path.join(fixture.root, 'store')});
  const entry = store.getEntry(fixture.repo, allocation.workspace.workspaceId);
  assert.equal(entry.kind, 'ok');
  assert.equal(entry.entry.status, 'failed');
  // 失败的现场必须保留，不能被自动回收。
  assert.equal(entry.entry.cleanup.kind, 'retained');
  assert.equal(fs.existsSync(allocation.workspace.workspaceRoot), true);
});

test('worker port reclaims a clean workspace but keeps one that produced changes', async () => {
  const fixture = createRoot();
  const port = createPort(fixture);
  const probe = await port.probeWorkspace();

  const cleanCall = {callId: 'outer-clean', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"noop"}'};
  const cleanAllocation = await port.allocateWorkerWorkspace({call: cleanCall, probe});
  assert.equal(cleanAllocation.kind, 'ok');
  const cleanResult = await port.run('worker', 'noop', cleanCall, {
    subagentWorkspace: {kind: 'managed_worktree', runId: cleanAllocation.runId, workspace: cleanAllocation.workspace}
  });
  // 空运行被回收：不再给出已不存在的工作区路径，只说明没有成果。
  assert.match(cleanResult.text, /No changes: the workspace matched the base commit and was removed/u);
  assert.equal(fs.existsSync(cleanAllocation.workspace.workspaceRoot), false);

  const store = require('../../src/agent/subagent/workspace/registry').createWorkerWorkspaceStore({rootDir: path.join(fixture.root, 'store')});
  assert.equal(store.getEntry(fixture.repo, cleanAllocation.workspace.workspaceId).entry.status, 'cleaned');
});

test('a worker that commits its own work keeps the workspace instead of being reclaimed', async () => {
  const fixture = createRoot();
  const port = createPort(fixture, {
    createRuntime: () => async (input) => {
      const worktree = input.workspace.execCwd;
      fs.writeFileSync(path.join(worktree, 'committed.txt'), 'worker output\n');
      runGit(worktree, ['add', '-A']);
      runGit(worktree, ['commit', '-m', 'worker commit']);
      return 'committed the change';
    }
  });
  const probe = await port.probeWorkspace();
  const call = {callId: 'outer-commit', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"commit"}'};
  const allocation = await port.allocateWorkerWorkspace({call, probe});
  assert.equal(allocation.kind, 'ok');

  const result = await port.run('worker', 'commit the change', call, {
    subagentWorkspace: {kind: 'managed_worktree', runId: allocation.runId, workspace: allocation.workspace}
  });

  assert.equal(result.ok, true);
  // 工作树是干净的，但 HEAD 已偏离冻结基线：提交本身就是成果，不能当空工作区回收。
  assert.equal(fs.existsSync(allocation.workspace.workspaceRoot), true);
  assert.equal(fs.existsSync(path.join(allocation.workspace.execCwd, 'committed.txt')), true);
  assert.match(result.text, /workspace retained/u);
  assert.doesNotMatch(result.text, /No changes/u);
});

test('releasing an already settled workspace does not rewrite its outcome', async () => {
  const fixture = createRoot();
  const port = createPort(fixture, {
    createRuntime: () => async (input) => {
      fs.writeFileSync(path.join(input.workspace.execCwd, 'settled.txt'), 'done\n');
      return 'report';
    }
  });
  const probe = await port.probeWorkspace();
  const call = {callId: 'outer-idem', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"x"}'};
  const allocation = await port.allocateWorkerWorkspace({call, probe});
  assert.equal(allocation.kind, 'ok');
  await port.run('worker', 'x', call, {
    subagentWorkspace: {kind: 'managed_worktree', runId: allocation.runId, workspace: allocation.workspace}
  });

  const store = require('../../src/agent/subagent/workspace/registry').createWorkerWorkspaceStore({rootDir: path.join(fixture.root, 'store')});
  const before = store.getEntry(fixture.repo, allocation.workspace.workspaceId).entry;
  assert.equal(before.status, 'completed');
  assert.equal(fs.existsSync(path.join(allocation.workspace.execCwd, 'settled.txt')), true);

  // 段内取消清理会对整段重复调用 release；已结算的登记必须保持原状。
  await port.releaseWorkerWorkspace({status: 'cancelled', workspace: allocation.workspace});
  const after = store.getEntry(fixture.repo, allocation.workspace.workspaceId).entry;
  assert.equal(after.status, 'completed');
  // 幂等结算不会覆盖已有终态：登记逐字段保持原状，保留原因仍是「有未集成改动」。
  assert.deepEqual(after, before);
  assert.equal(after.cleanup?.kind, 'retained');
  assert.equal(fs.existsSync(path.join(allocation.workspace.execCwd, 'settled.txt')), true);
});

test('worker port reports a non-git project and a broken repository as distinct outcomes', async () => {
  const fixture = createRoot();
  const plainDir = path.join(fixture.root, 'plain');
  fs.mkdirSync(plainDir);
  const plainPort = createPort({...fixture, repo: plainDir});
  assert.deepEqual(await plainPort.probeWorkspace(), {kind: 'non_git'});

  const brokenPort = createPort({...fixture, repo: path.join(fixture.root, 'missing')});
  const broken = await brokenPort.probeWorkspace();
  assert.equal(broken.kind, 'error');
  assert.equal(broken.code, 'unsupported_layout');
});

test('subagent loop runtime executes tools in the managed workspace and keeps usage on the parent project', async () => {
  const fixture = createRoot();
  const port = createPort(fixture);
  const probe = await port.probeWorkspace();
  const call = {callId: 'outer-cwd', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"inspect"}'};
  const allocation = await port.allocateWorkerWorkspace({call, probe});
  assert.equal(allocation.kind, 'ok');

  const providerRequests = [];
  const observation = {
    ...disabledObservation,
    providerRequestBuilt(input) {
      providerRequests.push(input);
    }
  };
  const usageEvents = [];
  const usageStore = {
    appendEvent(event) {
      usageEvents.push(event);
      return null;
    },
    listDailyUsage() {
      return [];
    },
    listModelUsage() {
      return [];
    }
  };

  const run = createSubagentLoopRuntime(
    fixture.repo,
    createInheritedContext(fixture.repo),
    require('../../src/agent/subagent/definition').BUILTIN_SUBAGENT_DEFINITIONS
      .find((definition) => definition.name === 'worker'),
    observation,
    usageStore
  );
  // fake provider 不产生 usage；这里只替换 provider turn，验证 usage 归属与运行环境提示同源。
  const originalPrepareAgent = agentSetupModule.prepareAgent;
  agentSetupModule.prepareAgent = (options) => {
    const prepared = originalPrepareAgent(options);
    return {
      ...prepared,
      agent: {
        async runTurn() {
          return {draft: 'worker answer', toolCalls: [], usage: {inputTokens: 10, outputTokens: 5}, usageInputTokens: 10};
        }
      }
    };
  };
  let answer;
  try {
    answer = await run({
      configSnapshot: createConfigSnapshot(),
      executionMode: {kind: 'interactive'},
      interactionMode: 'normal',
      metadata: {agentName: 'worker', depth: 1, parentToolCallId: 'outer-cwd', runId: allocation.runId},
      task: 'x',
      workspace: allocation.workspace
    });
  } finally {
    agentSetupModule.prepareAgent = originalPrepareAgent;
  }

  assert.equal(answer, 'worker answer');
  const systemPrompt = providerRequests[0].request.providerRecords[0].text;
  // 运行环境说明必须指向真实执行目录，而不是父项目目录。
  assert.match(systemPrompt, new RegExp(`Current working directory: ${allocation.workspace.execCwd.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'));
  assert.match(systemPrompt, /## Worker Workspace/u);
  assert.match(systemPrompt, new RegExp(`Base commit: ${probe.baseCommit}`, 'u'));
  assert.match(systemPrompt, /not present here/u);
  assert.match(systemPrompt, /Do not commit, merge, push/u);

  // usage 归属父项目分区：worktree 路径不同不拆出独立账本。
  assert.equal(usageEvents.length, 1);
  assert.equal(usageEvents[0].cwdHash, createProjectKey(fixture.repo));
  assert.notEqual(usageEvents[0].cwdHash, createProjectKey(allocation.workspace.execCwd));
});

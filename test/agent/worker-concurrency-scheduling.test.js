const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const agentSetupModule = require('../../src/agent/agent-setup');
const {createAgentLoopRuntime} = require('../../src/agent/loop-runtime/agent-loop-runtime');
const {disabledObservation} = require('../../src/observation/observation');
const subagentRuntimeModule = require('../../src/agent/subagent/runtime');
const {AgentAbortError} = require('../../src/types/agent');

const TEST_CONFIG = {
  agentType: 'fake',
  apiKey: '',
  model: 'fake-worker-concurrency',
  contextWindow: 128000,
  tools: {
    bash: {timeoutMs: 5000, maxOutputBytes: 4096},
    sandbox: {mode: 'off', network: false, extraWritablePaths: []}
  }
};

const WORKER_CALLS = [
  {callId: 'outer-a', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"first task"}'},
  {callId: 'outer-b', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"second task"}'}
];

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
    revision: 11,
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

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, reject, resolve};
}

async function waitFor(predicate, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function createRepoFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-worker-concurrency-repo-'));
  runGit(root, ['init']);
  fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
  runGit(root, ['add', '--all']);
  runGit(root, ['commit', '-m', 'base']);
  return root;
}

/**
 * 隔离 os.homedir()，避免调度测试读写真实的 ~/.echo 目录。
 * node:test 在同一文件内串行执行，因此设置与恢复环境变量是安全的。
 */
async function withIsolatedHome(callback) {
  const originalHome = process.env.HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-worker-concurrency-home-'));
  process.env.HOME = home;
  try {
    return await callback(home);
  } finally {
    process.env.HOME = originalHome;
    fs.rmSync(home, {recursive: true, force: true});
  }
}

/**
 * 用一个受控 provider 启动主 loop：primary 首轮返回两个相邻 Worker 调用，
 * 子运行在 gate 上阻塞，从而测出真实重叠与完成顺序。
 * 返回的句柄由调用方驱动 gate 并在结束时 restore。
 */
function startScheduledTurn(cwd, options = {}) {
  const snapshot = createConfigSnapshot();
  const originalPrepareAgent = agentSetupModule.prepareAgent;
  const childGates = [];
  const childCwd = [];
  const providerCwdByKind = [];
  const toolEvents = [];
  const concurrency = [];
  const subagentRecords = [];
  let activeChildren = 0;
  let maxActiveChildren = 0;

  agentSetupModule.prepareAgent = (prepareOptions) => {
    const prepared = originalPrepareAgent({...prepareOptions, config: TEST_CONFIG});
    const isChild = Boolean(prepareOptions.allowedToolNames);
    providerCwdByKind.push({cwd: prepareOptions.cwd, kind: isChild ? 'subagent' : 'primary'});
    return {
      ...prepared,
      agent: {
        async runTurn(records, _callbacks, turnOptions) {
          if (!isChild) {
            const hasResult = records.some((record) => record.role === 'tool_result' && record.toolName === 'run_subagent');
            if (hasResult) {
              return {draft: 'parent done', toolCalls: []};
            }
            return {draft: '', toolCalls: options.firstToolCalls ? options.firstToolCalls(options.primaryTurnIndex ?? 1) : WORKER_CALLS};
          }
          childCwd.push(prepareOptions.cwd);
          activeChildren += 1;
          maxActiveChildren = Math.max(maxActiveChildren, activeChildren);
          const gate = createDeferred();
          childGates.push(gate);
          try {
            await waitForGate(gate.promise, turnOptions?.abortSignal);
          } finally {
            activeChildren -= 1;
          }
          return {draft: 'child report', toolCalls: []};
        }
      }
    };
  };

  const observation = {
    ...disabledObservation,
    workerConcurrencyPrepared(input) {
      const {candidates, mode, started, workspacePreparationFailures} = input;
      concurrency.push({candidates, mode, started, workspacePreparationFailures});
    }
  };

  const runAgent = createAgentLoopRuntime(cwd, {capture: () => snapshot}, undefined, observation);
  const final = runAgent({
    records: [{role: 'user', text: 'run the delegated work'}],
    userConfigSnapshot: snapshot,
    ...(options.interactionMode ? {interactionMode: options.interactionMode} : {})
  }, {
    onSubagentRecords(records) {
      subagentRecords.push(...records);
    },
    onToolCall(call) {
      toolEvents.push({callId: call.callId, kind: 'call'});
    },
    onToolResult(result) {
      toolEvents.push({callId: result.callId, kind: 'result', ok: result.ok});
    }
  });

  return {
    childCwd,
    childGates,
    final,
    getActiveChildren: () => activeChildren,
    getMaxActiveChildren: () => maxActiveChildren,
    providerCwdByKind,
    restore() {
      agentSetupModule.prepareAgent = originalPrepareAgent;
    },
    concurrency,
    subagentRecords,
    toolEvents
  };
}

/** 子运行必须响应父级取消；否则取消测试会退化成「正常完成」。 */
function waitForGate(gatePromise, abortSignal) {
  if (!abortSignal) {
    return gatePromise;
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new AgentAbortError());
    if (abortSignal.aborted) {
      onAbort();
      return;
    }
    abortSignal.addEventListener('abort', onAbort, {once: true});
    gatePromise.then(
      (value) => {
        abortSignal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        abortSignal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

test('two adjacent workers overlap on distinct worktrees and settle in provider order', async () => {
  await withIsolatedHome(async () => {
    const fixture = createRepoFixture();
    const turn = await startScheduledTurn(fixture);
    try {
      await waitFor(() => turn.childGates.length === 2);
      // 两个 Worker 必须真正同时在运行，而不是逐个等待。
      assert.equal(turn.getMaxActiveChildren(), 2);
      // 不同 worktree，且都在项目目录之外。
      assert.notEqual(turn.childCwd[0], turn.childCwd[1]);
      assert.equal(turn.childCwd[0].startsWith(fixture), false);
      assert.equal(turn.childCwd[1].startsWith(fixture), false);

      // 逆序完成：后一个先结束，外层仍按 provider 原序提交。
      turn.childGates[1].resolve();
      await waitFor(() => turn.getActiveChildren() === 1);
      turn.childGates[0].resolve();

      assert.equal(await turn.final, 'parent done');
      assert.deepEqual(turn.toolEvents, [
        {callId: 'outer-a', kind: 'call'},
        {callId: 'outer-b', kind: 'call'},
        {callId: 'outer-a', kind: 'result', ok: true},
        {callId: 'outer-b', kind: 'result', ok: true}
      ]);
    } finally {
      turn.restore();
      fs.rmSync(fixture, {recursive: true, force: true});
    }
  });
});

test('non-git worker calls stay serial in the shared parent directory', async () => {
  await withIsolatedHome(async () => {
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-worker-concurrency-plain-'));
    const turn = await startScheduledTurn(plainDir);
    try {
      await waitFor(() => turn.childGates.length === 1);
      // 串行：第一个 Worker 未结束前不会启动第二个。
      assert.equal(turn.getMaxActiveChildren(), 1);
      turn.childGates[0].resolve();
      await waitFor(() => turn.childGates.length === 2);
      assert.equal(turn.getMaxActiveChildren(), 1);
      turn.childGates[1].resolve();
      await turn.final;

      assert.equal(turn.concurrency[0].mode, 'shared_cwd');
      // 串行执行不是并行组：start record 不带 parallelSize，渲染层保留完整过程栏。
      const starts = turn.subagentRecords.filter((record) => record.event.kind === 'start');
      assert.equal(starts.length, 2);
      assert.equal(starts.every((record) => record.event.parallelSize === undefined), true);
      // 共享目录：子运行 cwd 就是父目录。
      assert.equal(
        turn.providerCwdByKind.filter((entry) => entry.kind === 'subagent').every((entry) => entry.cwd === plainDir),
        true
      );
    } finally {
      turn.restore();
      fs.rmSync(plainDir, {recursive: true, force: true});
    }
  });
});

test('a probe failure fails every candidate in place without starting a child', async () => {
  await withIsolatedHome(async () => {
    // bare 仓库没有工作树：这是明确错误，不得静默回退共享目录。
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-worker-concurrency-bare-'));
    const bareDir = path.join(root, 'bare.git');
    runGit(root, ['init', '--bare', bareDir]);
    const turn = await startScheduledTurn(bareDir);
    try {
      assert.equal(await turn.final, 'parent done');
      assert.equal(turn.childGates.length, 0);
      assert.equal(turn.concurrency.length, 1);
      assert.equal(turn.concurrency[0].mode, 'error');
      assert.equal(turn.concurrency[0].started, 0);
      const results = turn.toolEvents.filter((event) => event.kind === 'result');
      assert.deepEqual(results.map((event) => event.callId), ['outer-a', 'outer-b']);
      assert.equal(results.every((event) => event.ok === false), true);
    } finally {
      turn.restore();
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
});

test('plan runs keep the shared directory and never create a writable worktree', async () => {
  await withIsolatedHome(async (home) => {
    const fixture = createRepoFixture();
    const turn = await startScheduledTurn(fixture, {interactionMode: 'plan'});
    try {
      await waitFor(() => turn.childGates.length === 1);
      turn.childGates[0].resolve();
      await waitFor(() => turn.childGates.length === 2);
      turn.childGates[1].resolve();
      await turn.final;

      // plan 不进入 Worker 候选段：没有段级预检，也没有并发资格。
      assert.equal(turn.concurrency.length, 0);
      assert.equal(
        turn.providerCwdByKind.filter((entry) => entry.kind === 'subagent').every((entry) => entry.cwd === fixture),
        true
      );
      // 没有登记任何受管工作区。
      assert.equal(fs.existsSync(path.join(home, '.echo', 'echo_tui', 'projects')), false);
    } finally {
      turn.restore();
      fs.rmSync(fixture, {recursive: true, force: true});
    }
  });
});

test('category switches form barriers around concurrent worker calls', async () => {
  await withIsolatedHome(async () => {
    const fixture = createRepoFixture();
    const sequence = [];
    const snapshot = createConfigSnapshot();
    const originalPrepareAgent = agentSetupModule.prepareAgent;
    const childGates = [];
    let primaryTurn = 0;

    agentSetupModule.prepareAgent = (prepareOptions) => {
      const prepared = originalPrepareAgent({...prepareOptions, config: TEST_CONFIG});
      const isChild = Boolean(prepareOptions.allowedToolNames);
      return {
        ...prepared,
        agent: {
          async runTurn() {
            if (isChild) {
              const gate = createDeferred();
              childGates.push(gate);
              await gate.promise;
              return {draft: 'child report', toolCalls: []};
            }
            primaryTurn += 1;
            if (primaryTurn > 1) {
              return {draft: 'parent done', toolCalls: []};
            }
            // 只读 → 两个 Worker → 主工作区写入 → 再一个只读。
            return {
              draft: '',
              toolCalls: [
                {callId: 'read-before', toolName: 'read_files', argumentsText: JSON.stringify({files: [{path: 'README.md'}]})},
                {callId: 'outer-a', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"first task"}'},
                {callId: 'outer-b', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"second task"}'},
                {callId: 'write-middle', toolName: 'apply_patch', argumentsText: '{"patch":"*** Begin Patch\\n*** Update File: README.md\\n@@\\n-base\\n+integrated\\n*** End Patch"}'},
                {callId: 'read-after', toolName: 'read_files', argumentsText: JSON.stringify({files: [{path: 'README.md'}]})}
              ]
            };
          }
        }
      };
    };

    try {
      const runAgent = createAgentLoopRuntime(fixture, {capture: () => snapshot});
      const final = runAgent({records: [{role: 'user', text: 'mixed'}], userConfigSnapshot: snapshot}, {
        onToolApprovalRequest() {
          return {kind: 'allow_once'};
        },
        onToolCall(call) {
          sequence.push(`call:${call.callId}`);
        },
        onToolResult(result) {
          sequence.push(`result:${result.callId}`);
        }
      });

      // 只读段必须先完成，两个 Worker 才能启动。
      await waitFor(() => childGates.length === 2);
      assert.deepEqual(sequence, [
        'call:read-before',
        'result:read-before',
        'call:outer-a',
        'call:outer-b'
      ]);

      childGates[0].resolve();
      childGates[1].resolve();
      assert.equal(await final, 'parent done');

      // Worker 段全部 settled 后才执行主工作区写入，写入完成后最后一个只读调用才开始。
      assert.deepEqual(sequence.slice(4), [
        'result:outer-a',
        'result:outer-b',
        'call:write-middle',
        'result:write-middle',
        'call:read-after',
        'result:read-after'
      ]);
      // 屏障顺序保证最后一次读取能看到主工作区的受控写入。
      assert.equal(fs.readFileSync(path.join(fixture, 'README.md'), 'utf8'), 'integrated\n');
    } finally {
      agentSetupModule.prepareAgent = originalPrepareAgent;
      fs.rmSync(fixture, {recursive: true, force: true});
    }
  });
});

test('a single workspace creation failure keeps the frozen snapshot and the siblings running', async () => {
  await withIsolatedHome(async () => {
    const fixture = createRepoFixture();
    const originalCreatePort = subagentRuntimeModule.createSubagentToolPort;
    subagentRuntimeModule.createSubagentToolPort = (portOptions) => {
      const port = originalCreatePort(portOptions);
      return {
        ...port,
        async allocateWorkerWorkspace(allocationOptions) {
          // 只让第一个候选失败：段快照与兄弟调用不受影响。
          return allocationOptions.call.callId === 'outer-a'
            ? {kind: 'failed', message: 'simulated workspace creation failure'}
            : port.allocateWorkerWorkspace(allocationOptions);
        },
        async probeWorkspace() {
          return port.probeWorkspace();
        }
      };
    };

    let turn;
    try {
      turn = startScheduledTurn(fixture);
      await waitFor(() => turn.childGates.length === 1);
      turn.childGates[0].resolve();
      assert.equal(await turn.final, 'parent done');
    } finally {
      subagentRuntimeModule.createSubagentToolPort = originalCreatePort;
      turn?.restore();
      fs.rmSync(fixture, {recursive: true, force: true});
    }

    // 只有一个子运行启动，失败的那个在原位置提交失败结果。
    assert.equal(turn.childGates.length, 1);
    const results = turn.toolEvents.filter((event) => event.kind === 'result');
    assert.deepEqual(results, [
      {callId: 'outer-a', kind: 'result', ok: false},
      {callId: 'outer-b', kind: 'result', ok: true}
    ]);
    assert.equal(turn.concurrency[0].mode, 'managed_worktree');
    assert.equal(turn.concurrency[0].candidates, 2);
    assert.equal(turn.concurrency[0].started, 1);
    assert.equal(turn.concurrency[0].workspacePreparationFailures, 1);
  });
});

test('worker concurrency abort cancels every sibling and keeps their workspaces locatable', async () => {
  await withIsolatedHome(async (home) => {
    const fixture = createRepoFixture();
    const controller = new AbortController();
    const snapshot = createConfigSnapshot();
    const originalPrepareAgent = agentSetupModule.prepareAgent;
    const childStarted = [];
    let primaryTurn = 0;

    agentSetupModule.prepareAgent = (prepareOptions) => {
      const prepared = originalPrepareAgent({...prepareOptions, config: TEST_CONFIG});
      const isChild = Boolean(prepareOptions.allowedToolNames);
      return {
        ...prepared,
        agent: {
          async runTurn(records, _callbacks, turnOptions) {
            if (!isChild) {
              primaryTurn += 1;
              return primaryTurn > 1 ? {draft: 'parent done', toolCalls: []} : {draft: '', toolCalls: WORKER_CALLS};
            }
            childStarted.push(prepareOptions.cwd);
            await waitForGate(new Promise(() => {}), turnOptions?.abortSignal);
            return {draft: 'never', toolCalls: []};
          }
        }
      };
    };

    try {
      const runAgent = createAgentLoopRuntime(fixture, {capture: () => snapshot});
      const final = runAgent({
        records: [{role: 'user', text: 'cancel me'}],
        userConfigSnapshot: snapshot,
        abortSignal: controller.signal
      }, {});

      await waitFor(() => childStarted.length === 2);
      controller.abort();
      await assert.rejects(final, (error) => error instanceof AgentAbortError);
      // 取消不是普通失败：不向父 provider 提交孤立的外层结果。
      assert.equal(childStarted.length, 2);

      const {createProjectKey} = require('../../src/persistence/project-key');
      const projectDir = path.join(home, '.echo', 'echo_tui', 'projects', createProjectKey(fixture), 'worker-workspaces');
      const workspaceIds = fs.readdirSync(projectDir);
      assert.equal(workspaceIds.length, 2);
      const store = require('../../src/agent/subagent/workspace/registry').createWorkerWorkspaceStore({});
      const entries = workspaceIds.map((workspaceId) => store.getEntry(fixture, workspaceId));
      assert.equal(entries.every((read) => read.kind === 'ok'), true);
      // 取消的工作区保留现场，不会被自动回收。
      assert.equal(entries.every((read) => read.entry.status === 'cancelled'), true);
      assert.equal(entries.every((read) => fs.existsSync(read.entry.workspaceRoot)), true);
    } finally {
      agentSetupModule.prepareAgent = originalPrepareAgent;
      fs.rmSync(fixture, {recursive: true, force: true});
    }
  });
});

test('readonly runs never enter the worker candidate set', async () => {
  await withIsolatedHome(async (home) => {
    const fixture = createRepoFixture();
    const snapshot = createConfigSnapshot();
    const originalPrepareAgent = agentSetupModule.prepareAgent;
    const childGates = [];
    const childCwd = [];
    const results = [];

    agentSetupModule.prepareAgent = (prepareOptions) => {
      const prepared = originalPrepareAgent({...prepareOptions, config: TEST_CONFIG});
      const isChild = Boolean(prepareOptions.allowedToolNames);
      return {
        ...prepared,
        agent: {
          async runTurn(records) {
            if (!isChild) {
              const hasResult = records.some((record) => record.role === 'tool_result' && record.toolName === 'run_subagent');
              return hasResult ? {draft: 'parent done', toolCalls: []} : {draft: '', toolCalls: WORKER_CALLS};
            }
            childCwd.push(prepareOptions.cwd);
            const gate = createDeferred();
            childGates.push(gate);
            await gate.promise;
            return {draft: 'child report', toolCalls: []};
          }
        }
      };
    };

    try {
      const runAgent = createAgentLoopRuntime(fixture, {capture: () => snapshot});
      await runAgent({
        records: [{role: 'user', text: 'readonly delegation'}],
        userConfigSnapshot: snapshot,
        toolPolicy: 'readonly'
      }, {
        onToolResult(result) {
          results.push(result);
        }
      });

      // readonly 父运行沿用既有 fail-closed 分类：general Worker 在执行前被拒绝。
      assert.equal(childGates.length, 0);
      assert.equal(childCwd.length, 0);
      assert.deepEqual(results.map((result) => [result.callId, result.ok]), [
        ['outer-a', false],
        ['outer-b', false]
      ]);
      assert.match(results[0].text, /only allows delegating to read-only subagents/u);
      // 没有创建任何受管工作区。
      assert.equal(fs.existsSync(path.join(home, '.echo', 'echo_tui', 'projects')), false);
    } finally {
      agentSetupModule.prepareAgent = originalPrepareAgent;
      fs.rmSync(fixture, {recursive: true, force: true});
    }
  });
});

test('workspace probing happens after a preceding exclusive call that changes the repository', async () => {
  await withIsolatedHome(async () => {
    // 起始目录不是 Git 项目；只有前一个独占调用执行 git init 之后才变成仓库。
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-worker-concurrency-late-git-'));
    fs.writeFileSync(path.join(plainDir, 'README.md'), 'base\n');
    const initCommand = [
      'git init >/dev/null 2>&1',
      'git add -A',
      'git -c user.email=test@example.com -c user.name="Echo Test" commit -m "init base" >/dev/null'
    ].join(' && ');

    const snapshot = createConfigSnapshot();
    const originalPrepareAgent = agentSetupModule.prepareAgent;
    const childGates = [];
    const childCwd = [];
    const concurrency = [];
    const order = [];
    let primaryTurn = 0;

    agentSetupModule.prepareAgent = (prepareOptions) => {
      const prepared = originalPrepareAgent({...prepareOptions, config: TEST_CONFIG});
      const isChild = Boolean(prepareOptions.allowedToolNames);
      return {
        ...prepared,
        agent: {
          async runTurn(records) {
            if (!isChild) {
              primaryTurn += 1;
              if (primaryTurn > 1) {
                return {draft: 'parent done', toolCalls: []};
              }
              return {
                draft: '',
                toolCalls: [
                  {callId: 'init-repo', toolName: 'run_bash_command', argumentsText: JSON.stringify({command: initCommand})},
                  {callId: 'outer-a', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"first task"}'},
                  {callId: 'outer-b', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"second task"}'}
                ]
              };
            }
            childCwd.push(prepareOptions.cwd);
            const gate = createDeferred();
            childGates.push(gate);
            await gate.promise;
            return {draft: 'child report', toolCalls: []};
          }
        }
      };
    };

    const observation = {
      ...disabledObservation,
      toolCompleted(input) {
        order.push(`completed:${input.result.callId}`);
      },
      workerConcurrencyPrepared(input) {
        order.push(`concurrency:${input.mode}`);
        const {candidates, mode, started, workspacePreparationFailures} = input;
      concurrency.push({candidates, mode, started, workspacePreparationFailures});
      }
    };

    try {
      const runAgent = createAgentLoopRuntime(plainDir, {capture: () => snapshot}, undefined, observation);
      const final = runAgent({records: [{role: 'user', text: 'init then delegate'}], userConfigSnapshot: snapshot}, {
        onToolApprovalRequest() {
          return {kind: 'allow_once'};
        }
      });

      await waitFor(() => childGates.length === 2);
      // 子运行看到的是真实 worktree，而不是初始化后的父目录。
      assert.equal(childCwd.every((cwd) => cwd !== plainDir), true);

      childGates[0].resolve();
      childGates[1].resolve();
      assert.equal(await final, 'parent done');

      // 预检必须发生在前一个独占调用完成之后：否则这里仍是 non_git。
      assert.equal(concurrency[0].mode, 'managed_worktree');
      assert.equal(order[0], 'completed:init-repo');
      assert.ok(order.indexOf('completed:init-repo') < order.indexOf('concurrency:managed_worktree'));
    } finally {
      agentSetupModule.prepareAgent = originalPrepareAgent;
      fs.rmSync(plainDir, {recursive: true, force: true});
    }
  });
});

test('three workers overlap without relying on a single active slot', async () => {
  await withIsolatedHome(async () => {
    const fixture = createRepoFixture();
    const threeCalls = [
      {callId: 'outer-1', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"task one"}'},
      {callId: 'outer-2', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"task two"}'},
      {callId: 'outer-3', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"task three"}'}
    ];
    const turn = startScheduledTurn(fixture, {firstToolCalls: () => threeCalls});
    try {
      await waitFor(() => turn.childGates.length === 3);
      // 三个独立工作区同时活跃，不依赖单个槽位。
      assert.equal(turn.getMaxActiveChildren(), 3);
      assert.equal(new Set(turn.childCwd).size, 3);

      // 乱序完成也必须按 provider 原序提交。
      turn.childGates[1].resolve();
      turn.childGates[2].resolve();
      turn.childGates[0].resolve();
      assert.equal(await turn.final, 'parent done');

      assert.deepEqual(turn.toolEvents.filter((event) => event.kind === 'result').map((event) => event.callId), [
        'outer-1', 'outer-2', 'outer-3'
      ]);
      assert.equal(turn.concurrency[0].candidates, 3);
      assert.equal(turn.concurrency[0].started, 3);
    } finally {
      turn.restore();
      fs.rmSync(fixture, {recursive: true, force: true});
    }
  });
});

test('worker concurrency diagnostics carry only counts and mode', async () => {
  await withIsolatedHome(async () => {
    const fixture = createRepoFixture();
    const turn = await startScheduledTurn(fixture);
    try {
      await waitFor(() => turn.childGates.length === 2);
      turn.childGates[0].resolve();
      turn.childGates[1].resolve();
      await turn.final;

      const diagnostics = turn.concurrency[0];

      assert.deepEqual({
        candidates: diagnostics.candidates,
        mode: diagnostics.mode,
        started: diagnostics.started,
        workspacePreparationFailures: diagnostics.workspacePreparationFailures
      }, {candidates: 2, mode: 'managed_worktree', started: 2, workspacePreparationFailures: 0});
      // 诊断只承载计数与模式：新增计数字段不算违约，但任务文本、调用 ID 与路径不得出现。
      for (const [key, value] of Object.entries(diagnostics)) {
        assert.ok(typeof value === 'number' || (key === 'mode' && typeof value === 'string'), key);
      }
      assert.doesNotMatch(JSON.stringify(diagnostics), /first task|second task|outer-[ab]|worktree\//u);
    } finally {
      turn.restore();
      fs.rmSync(fixture, {recursive: true, force: true});
    }
  });
});

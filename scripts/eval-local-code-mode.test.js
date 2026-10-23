const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {TASKS, createFixture, snapshotTree, compareTrees, judge} = require('./eval-local-code-mode/fixtures');
const {
  DEFAULT_BUDGETS,
  validateSettings,
  buildPlan,
  outsideFixture,
  loadRuntime,
  runCase,
  runEvaluation
} = require('./eval-local-code-mode/harness');
const {createScriptedProvider} = require('./eval-local-code-mode/scripted-provider');

const settings = validateSettings({
  mode: 'scripted',
  repeats: 1
});
const distRoot = path.resolve(__dirname, '../dist');
const simple = TASKS.find(({id}) => id === 'simple-query');

test('fixtures and independent validators reject success claims and plausible wrong answers', () => {
  const fixture = createFixture();
  try {
    assert.equal(
      Buffer.byteLength(fs.readFileSync(path.join(fixture.cwd, 'notes.txt'), 'utf8').split('needle')[0]) + 1,
      12
    );
    assert.equal(fs.readdirSync(path.join(fixture.cwd, 'bulk')).length, 205);
    assert.equal(fs.readFileSync(path.join(fixture.cwd, 'empty.txt')).length, 0);
    for (const task of TASKS) {
      assert.equal(judge(task, JSON.stringify(task.expected)).success, true, task.id);
      assert.equal(judge(task, 'Task completed successfully').success, false, task.id);
      assert.equal(
        judge(
          task,
          JSON.stringify({
            success: true,
            ...task.expected
          })
        ).success,
        false,
        task.id
      );
      assert.equal(judge(task, '{}').success, false, task.id);
    }
    assert.equal(judge(simple, '{"line":1,"column":5}').success, false);
  } finally {
    fixture.cleanup();
  }
});

test('tree snapshots detect edits, creates, removals, permissions and symlinks without following links', () => {
  const fixture = createFixture();
  try {
    const before = snapshotTree(fixture.cwd);
    fs.writeFileSync(path.join(fixture.cwd, 'notes.txt'), 'changed');
    fs.unlinkSync(path.join(fixture.cwd, 'empty.txt'));
    fs.writeFileSync(path.join(fixture.cwd, 'added.txt'), 'new');
    fs.chmodSync(path.join(fixture.cwd, 'route.json'), 0o400);
    fs.symlinkSync('../outside', path.join(fixture.cwd, 'link'));
    const differences = compareTrees(before, snapshotTree(fixture.cwd));
    for (const name of ['notes.txt', 'empty.txt', 'added.txt', 'route.json', 'link']) {
      assert.ok(
        differences.some((entry) => entry.path === name),
        name
      );
    }
    assert.equal(snapshotTree(fixture.cwd).link.target, '../outside');
  } finally {
    fixture.cleanup();
  }
});

test('evaluation paths are fixture-only, including parent paths and symlink ancestors', () => {
  const fixture = createFixture();
  try {
    fs.symlinkSync(fixture.home, path.join(fixture.cwd, 'external'));
    assert.equal(
      outsideFixture(fixture.cwd, 'read_files', {
        files: [
          {
            path: 'notes.txt'
          }
        ]
      }),
      false
    );
    assert.equal(
      outsideFixture(fixture.cwd, 'read_files', {
        files: [
          {
            path: path.join(fixture.cwd, 'notes.txt')
          }
        ]
      }),
      false
    );
    assert.equal(outsideFixture(fixture.cwd, 'glob', {}), false);
    assert.equal(
      outsideFixture(fixture.cwd, 'grep', {
        paths: ['../home']
      }),
      true
    );
    assert.equal(
      outsideFixture(fixture.cwd, 'read_files', {
        files: [
          {
            path: 'external/missing.txt'
          }
        ]
      }),
      true
    );
  } finally {
    fixture.cleanup();
  }
});

test('real evaluation requires opt-in, exact model, effort and all budgets', () => {
  const real = {
    mode: 'real',
    repeats: 1,
    configPath: '/not/read',
    modelProfileId: 'pinned',
    model: 'pinned-version',
    effort: 'none',
    budgets: DEFAULT_BUDGETS
  };
  assert.throws(() => validateSettings(real), /allow-real-model/);
  assert.throws(
    () =>
      validateSettings({
        ...real,
        allowRealModel: true,
        model: undefined
      }),
    /exact model/
  );
  assert.throws(
    () =>
      validateSettings({
        ...real,
        allowRealModel: true,
        budgets: {
          tools: 10
        }
      }),
    /explicit/
  );
  assert.throws(
    () =>
      validateSettings({
        ...real,
        allowRealModel: true,
        budgets: {
          ...DEFAULT_BUDGETS,
          tools: 0
        }
      }),
    /Invalid budget/
  );
  assert.throws(
    () =>
      validateSettings({
        ...settings,
        groups: ['forced']
      }),
    /include native and optional/
  );
  assert.equal(
    buildPlan(
      validateSettings({
        ...real,
        allowRealModel: true
      })
    ).maximumCases,
    TASKS.length * 2
  );
});

test('dry-run needs neither compiled runtime nor API, and implicit execution is refused', () => {
  const script = path.resolve(__dirname, 'eval-local-code-mode.js');
  const dry = spawnSync(process.execPath, [script, '--dry-run'], {
    encoding: 'utf8'
  });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(JSON.parse(dry.stdout).mode, 'scripted');
  const refused = spawnSync(process.execPath, [script], {
    encoding: 'utf8'
  });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Usage:/);
});

test('all deterministic pairs use real loop and independently pass; repairs and usage remain honest', async () => {
  const report = await runEvaluation({
    mode: 'scripted',
    repeats: 1,
    groups: ['native', 'optional', 'forced'],
    distRoot
  });
  assert.equal(report.cases.length, TASKS.length * 3);
  for (const row of report.cases) {
    assert.equal(
      row.failure,
      null,
      `${row.taskId}/${row.group}: ${JSON.stringify(row.failure)}`
    );
    assert.equal(
      row.verdict.success,
      true,
      `${row.taskId}/${row.group}: ${JSON.stringify(row.verdict)}`
    );
    assert.deepEqual(row.fixtureChanges, []);
    assert.equal(row.releaseBlocked, false);
    assert.equal(row.usage.complete, false);
    assert.deepEqual(
      row.definitions.map(({name}) => name).sort(),
      ['glob', 'grep', 'read_files', ...(row.group === 'native' ? [] : ['run_code'])].sort()
    );
    assert.ok(row.raw.providerRequests.length >= 2);
    assert.ok(row.raw.toolOutputs.length >= 1);
    if (row.group !== 'native') {
      assert.ok(row.raw.audit.length >= 2);
    }
  }
  for (const group of ['optional', 'forced']) {
    const repair = report.cases.find(
      (row) => row.taskId === 'script-repair' && row.group === group
    );
    assert.equal(repair.firstScriptExecutionSuccess, false);
    assert.equal(repair.firstScriptTaskSuccess, false);
    assert.equal(repair.scriptAttempts, 2);
    assert.equal(repair.repairs, 1);
    assert.equal(repair.verdict.success, true);
    assert.ok(repair.toolAttempts >= 4);
    assert.equal(report.summary[group].reportedTotalTokens, null);
  }
});

test('successful script execution is not task success, and fallback costs are retained', async () => {
  const runtime = loadRuntime(distRoot);
  const wrong = await runCase(runtime, settings, simple, 'optional', 0, () => ({
    async runTurn(records) {
      return records.some((record) => record.role === 'tool_result')
        ? {
            draft: '{"line":1,"column":5}',
            toolCalls: []
          }
        : {
            draft: '',
            toolCalls: [
              {
                callId: 'wrong',
                toolName: 'run_code',
                argumentsText: '{"code":"return {line:1,column:5}"}'
              }
            ]
          };
    }
  }));
  assert.equal(wrong.firstScriptExecutionSuccess, true);
  assert.equal(wrong.firstScriptTaskSuccess, false);
  assert.equal(wrong.verdict.success, false);
  const fallback = await runCase(runtime, settings, simple, 'optional', 0, (task) => {
    const native = createScriptedProvider(task, 'native');
    let first = true;
    return {
      async runTurn(records) {
        if (first) {
          first = false;
          return {
            draft: '',
            toolCalls: [
              {
                callId: 'bad-code',
                toolName: 'run_code',
                argumentsText: JSON.stringify({
                  code: 'throw Error("repair me")'
                })
              }
            ]
          };
        }
        return native.runTurn(
          records.filter(
            (record) => !['tool_call', 'tool_result'].includes(record.role) || record.toolName !== 'run_code'
          )
        );
      }
    };
  });
  assert.equal(fallback.firstScriptExecutionSuccess, false);
  assert.equal(fallback.verdict.success, true);
  assert.equal(fallback.nativeAfterScriptFailure, true);
  assert.equal(fallback.toolAttempts, 2);
  assert.equal(fallback.raw.providerResponses.length, 3);
});

test('all groups block forbidden native tools before dispatch, even readonly bash and loop special cases', async () => {
  const runtime = loadRuntime(distRoot);
  for (const group of ['native', 'optional', 'forced']) {
    const result = await runCase(runtime, settings, simple, group, 0, () => ({
      async runTurn() {
        return {
          draft: '',
          toolCalls: [
            'run_bash_command',
            'apply_patch',
            'web_fetch',
            'ask_user_questions',
            'create_todos',
            'run_subagent'
          ].map((toolName, index) => ({
            toolName,
            callId: `denied-${index}`,
            argumentsText: '{"command":"pwd"}'
          }))
        };
      }
    }));
    assert.equal(result.deniedRequests.length, 6);
    assert.equal(result.toolAttempts, 6);
    assert.equal(result.raw.toolOutputs.length, 0);
    assert.deepEqual(result.fixtureChanges, []);
    assert.equal(result.releaseBlocked, false);
    assert.equal(result.verdict.success, false);
  }
});

test('tool caps count outer and inner attempts rather than giving scripts a free batch', async () => {
  const runtime = loadRuntime(distRoot);
  const tight = {
    ...settings,
    budgets: {
      ...settings.budgets,
      tools: 1
    }
  };
  const native = await runCase(runtime, tight, simple, 'native', 0);
  const code = await runCase(runtime, tight, simple, 'optional', 0);
  assert.equal(native.toolAttempts, 1);
  assert.equal(native.verdict.success, true);
  assert.ok(code.toolAttempts >= 2);
  assert.match(code.failure.message, /tool-attempt budget/);
  assert.equal(
    code.raw.toolOutputs.filter((row) => row.channel === 'script-envelope').length,
    0
  );
  assert.equal(code.verdict.success, false);
});

test('invalid guest arguments cost budget even without handler dispatch', async () => {
  const runtime = loadRuntime(distRoot);
  const result = await runCase(runtime, settings, simple, 'optional', 0, () => {
    let turn = 0;
    return {
      async runTurn() {
        return ++turn === 1
          ? {
              draft: '',
              toolCalls: [
                {
                  callId: 'invalid',
                  toolName: 'run_code',
                  argumentsText: JSON.stringify({
                    code: 'await tools.glob({bad: true}); return 0;'
                  })
                }
              ]
            }
          : {
              draft: '0',
              toolCalls: []
            };
      }
    };
  });
  assert.equal(result.toolAttempts, 2);
  assert.equal(result.verdict.success, false);
  assert.equal(
    result.raw.toolOutputs.filter((row) => row.channel === 'script-envelope').length,
    0
  );
});

test('invalid attempts consume the same cap before a later valid script query can dispatch', async () => {
  const runtime = loadRuntime(distRoot);
  const tight = {
    ...settings,
    budgets: {
      ...settings.budgets,
      tools: 2
    }
  };
  const result = await runCase(runtime, tight, simple, 'optional', 0, () => ({
    async runTurn() {
      return {
        draft: '',
        toolCalls: [
          {
            callId: 'invalid-then-valid',
            toolName: 'run_code',
            argumentsText: JSON.stringify({
              code: 'await tools.glob({bad:true}); return await tools.glob({pattern:"*.txt"});'
            })
          }
        ]
      };
    }
  }));
  assert.match(result.failure.message, /tool-attempt budget/);
  assert.equal(result.toolAttempts, 3);
  assert.equal(
    result.raw.toolOutputs.filter((row) => row.channel === 'script-envelope').length,
    0
  );
});

test('fixture edits block release even when the final independently checked answer is correct', async () => {
  const runtime = loadRuntime(distRoot);
  // 只由测试写入临时夹具，验证检测器；不是让模型或获准工具真的执行写操作。
  const instrumented = {
    ...runtime,
    createLoop(cwd, ...options) {
      const run = runtime.createLoop(cwd, ...options);
      return async (...args) => {
        const result = await run(...args);
        fs.writeFileSync(path.join(cwd, 'unexpected.txt'), 'detector probe');
        return result;
      };
    }
  };
  const result = await runCase(instrumented, settings, simple, 'native', 0);
  assert.equal(result.verdict.success, true);
  assert.equal(result.releaseBlocked, true);
  assert.ok(result.fixtureChanges.some((entry) => entry.path === 'unexpected.txt'));
});

test('native and script paths outside fixture are denied without reading or changing files', async () => {
  const runtime = loadRuntime(distRoot);
  for (const group of ['native', 'optional']) {
    const result = await runCase(runtime, settings, simple, group, 0, (task) => {
      assert.equal(task.expected, undefined, 'provider must not receive independent expected values');
      let turn = 0;
      return {
        async runTurn() {
          return ++turn === 1
            ? {
                draft: '',
                toolCalls: [
                  {
                    callId: 'outside',
                    toolName: group === 'native' ? 'read_files' : 'run_code',
                    argumentsText: JSON.stringify(
                      group === 'native'
                        ? {
                            files: [
                              {
                                path: '../home/private.txt'
                              }
                            ]
                          }
                        : {
                            code: 'return await tools.read_files({files:[{path:"../home/private.txt"}]});'
                          }
                    )
                  }
                ]
              }
            : {
                draft: '{}',
                toolCalls: []
              };
        }
      };
    });
    assert.ok(result.deniedRequests.some((entry) => entry.source.endsWith('-path')));
    assert.deepEqual(result.fixtureChanges, []);
    assert.equal(result.releaseBlocked, false);
  }
});

test('reported tokens are summed without double-counting cached input and stop at response boundaries', async () => {
  const runtime = loadRuntime(distRoot);
  const result = await runCase(
    runtime,
    {
      ...settings,
      budgets: {
        ...settings.budgets,
        tokens: 20
      }
    },
    simple,
    'native',
    0,
    () => ({
      async runTurn() {
        return {
          draft: '{"line":1,"column":12}',
          toolCalls: [],
          usage: {
            inputTokens: 20,
            outputTokens: 5,
            cacheReadInputTokens: 10
          }
        };
      }
    })
  );
  assert.equal(result.usage.totalTokens, 25);
  assert.equal(result.raw.providerResponses.length, 1);
  assert.match(result.failure.message, /reported-token budget/);
  assert.equal(result.verdict.success, false);
});

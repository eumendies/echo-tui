const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {performance} = require('node:perf_hooks');
const {TASKS, createFixture, snapshotTree, compareTrees, judge} = require('./fixtures');
const {createScriptedProvider} = require('./scripted-provider');

const READ_TOOLS = ['glob', 'grep', 'read_files'];
const GROUPS = ['native', 'optional', 'forced'];
const DEFAULT_BUDGETS = {
  turns: 12,
  tools: 48,
  tokens: 64_000,
  wallMs: 120_000
};

// 评测额外收紧到临时 fixture；产品工具本身并不承诺所有路径均限于工作区。
function outsideFixture(cwd, toolName, args) {
  const paths = toolName === 'read_files'
    ? (Array.isArray(args.files)
        ? args.files.map((file) => file?.path)
        : [])
    : args.paths;
  const root = fs.realpathSync(cwd);
  return (
    Array.isArray(paths) &&
    paths.some((name) => {
      if (typeof name !== 'string') {
        return false;
      }
      const absolute = path.resolve(cwd, name);
      let resolved = absolute;
      try {
        resolved = fs.realpathSync(absolute);
      } catch {
        // 缺失路径仍检查最近存在父级，不能利用指向外部的目录链接绕过检查。
        let parent = path.dirname(absolute);
        while (parent !== path.dirname(parent) && !fs.existsSync(parent)) {
          parent = path.dirname(parent);
        }
        try {
          resolved = path.join(fs.realpathSync(parent), path.relative(parent, absolute));
        } catch {
        }
      }
      const relative = path.relative(root, resolved);
      return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
    })
  );
}

function validateSettings(input) {
  const settings = {
    ...input,
    groups: input.groups || ['native', 'optional'],
    budgets: {
      ...DEFAULT_BUDGETS,
      ...input.budgets
    }
  };
  if (!['scripted', 'real'].includes(settings.mode)) {
    throw Error('mode must be scripted or real');
  }
  if (
    !Array.isArray(settings.groups) ||
    !settings.groups.includes('native') ||
    !settings.groups.includes('optional') ||
    settings.groups.some((group) => !GROUPS.includes(group)) ||
    new Set(settings.groups).size !== settings.groups.length
  ) {
    throw Error('groups must include native and optional; forced is diagnostic only');
  }
  for (const [name, value] of Object.entries(settings.budgets)) {
    if (!Object.hasOwn(DEFAULT_BUDGETS, name) || !Number.isSafeInteger(value) || value < 1) {
      throw Error(`Invalid budget: ${name}`);
    }
  }
  if (!Number.isSafeInteger(settings.repeats) || settings.repeats < 1 || settings.repeats > 100) {
    throw Error('repeats must be 1..100');
  }
  if (
    settings.taskIds !== undefined &&
    (!Array.isArray(settings.taskIds) ||
      settings.taskIds.length === 0 ||
      settings.taskIds.some((id) => !TASKS.some((task) => task.id === id)) ||
      new Set(settings.taskIds).size !== settings.taskIds.length)
  ) {
    throw Error('taskIds must be a nonempty list of unique known task IDs');
  }
  if (settings.mode === 'real') {
    if (!settings.allowRealModel) {
      throw Error('Real model calls require --allow-real-model');
    }
    if (!settings.configPath || !settings.modelProfileId || !settings.model || !settings.effort) {
      throw Error('Real evaluation requires configPath, modelProfileId, exact model and explicit effort');
    }
    if (!['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(settings.effort)) {
      throw Error('Invalid effort');
    }
    if (!input.budgets || Object.keys(DEFAULT_BUDGETS).some((name) => !Object.hasOwn(input.budgets, name))) {
      throw Error('Real evaluation requires explicit turns/tools/tokens/wallMs budgets');
    }
  }
  return settings;
}

function buildPlan(settings) {
  const tasks = settings.taskIds ? TASKS.filter((task) => settings.taskIds.includes(task.id)) : TASKS;
  return {
    mode: settings.mode,
    modelProfileId: settings.modelProfileId || null,
    model: settings.model || 'deterministic-scripted-provider',
    effort: settings.effort || 'none',
    groups: settings.groups,
    repeats: settings.repeats,
    tasks: tasks.map(({id, prompt}) => ({
      id,
      prompt
    })),
    budgetsPerCase: settings.budgets,
    maximumCases: settings.repeats * settings.groups.length * tasks.length,
    allowedTools: {
      native: READ_TOOLS,
      optional: [...READ_TOOLS, 'run_code'],
      forced: [...READ_TOOLS, 'run_code']
    },
    toolBudgetSemantics:
      'Each outer/native attempt and each inner bridge attempt costs 1; denied/invalid attempts included. Batch attempts can exceed the cap, but execution stops before more permitted dispatch.',
    tokenBudgetSemantics:
      'Provider-reported input (including cache) plus output. Stop at response boundaries; not a server-side output cap. Missing usage stops real runs; failed requests/retries may have unreported cost.'
  };
}

function loadRuntime(distRoot) {
  const load = (name) => require(path.join(distRoot, 'src', name));
  return {
    setup: load('agent/agent-setup'),
    createLoop: load('agent/loop-runtime/agent-loop-runtime').createAgentLoopRuntime,
    UserConfigContext: load('config/user-config-context').UserConfigContext,
    createDefaultConfig: load('config/user-setup-bootstrap').createDefaultUserConfig,
    disabledObservation: load('observation/observation').disabledObservation,
    runtimeAvailable: load('tools/code-mode/execution').isCodeRuntimeAvailable
  };
}

function summarizeCases(cases, mode) {
  return Object.fromEntries(
    GROUPS.filter((group) => cases.some((row) => row.group === group))
      .map((group) => {
        const rows = cases.filter((row) => row.group === group);
        const adopted = rows.filter((row) => row.adoptedScript);
        return [
          group,
          {
            evidence: mode === 'real' ? 'real-provider' : 'offline-harness-only-not-model-performance',
            cases: rows.length,
            scriptAdoption: {
              numerator: adopted.length,
              denominator: rows.length
            },
            firstScriptExecutionSuccess: {
              numerator: adopted.filter((row) => row.firstScriptExecutionSuccess === true).length,
              denominator: adopted.length
            },
            firstScriptTaskSuccess: {
              numerator: adopted.filter((row) => row.firstScriptTaskSuccess === true).length,
              denominator: adopted.length
            },
            finalTaskSuccess: {
              numerator: rows.filter((row) => row.verdict.success).length,
              denominator: rows.length
            },
            repairs: rows.reduce((sum, row) => sum + row.repairs, 0),
            toolAttempts: rows.reduce((sum, row) => sum + row.toolAttempts, 0),
            durationMs: rows.reduce((sum, row) => sum + row.durationMs, 0),
            reportedTotalTokens: rows.every((row) => row.usage.complete)
              ? rows.reduce((sum, row) => sum + row.usage.totalTokens, 0)
              : null,
            deniedRequests: rows.reduce((sum, row) => sum + row.deniedRequests.length, 0),
            actualFixtureChanges: rows.reduce((sum, row) => sum + row.fixtureChanges.length, 0)
          }
        ];
      })
  );
}

// 独立进程内串行执行：局部替换装配入口以收紧工具和计费，结束必须恢复，禁止并行调用此方法。
async function runCase(runtime, settings, task, group, repeat, providerFactory) {
  const fixture = createFixture();
  const originalPrepare = runtime.setup.prepareAgent;
  const originalHomedir = os.homedir;
  const controller = new AbortController();
  const raw = {
    providerRequests: [],
    providerResponses: [],
    providerFailures: [],
    providerRetries: [],
    outerResults: [],
    toolOutputs: [],
    audit: [],
    lifecycle: []
  };
  const deniedRequests = [];
  const scripts = [];
  const usage = {
    complete: settings.mode === 'real',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    turns: []
  };
  let toolAttempts = 0;
  let turns = 0;
  let finalText = '';
  let failure = null;
  let context;
  let before;
  let after;
  let definitions = [];
  let requestedScripts = 0;
  let resolvedModel;
  const started = performance.now();
  const timeout = setTimeout(
    () => controller.abort(Error('Evaluation wall-time budget exceeded')),
    settings.budgets.wallMs
  );
  function stopBudget(message) {
    failure ||= {
      kind: 'budget',
      message
    };
    const error = Error(message);
    controller.abort(error);
    return error;
  }
  function charge(count) {
    toolAttempts += count;
    if (toolAttempts > settings.budgets.tools) {
      throw stopBudget('Evaluation tool-attempt budget exceeded');
    }
  }
  try {
    let configPath = settings.configPath;
    if (settings.mode === 'scripted') {
      configPath = path.join(fixture.home, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify(runtime.createDefaultConfig()));
    }
    context = new runtime.UserConfigContext({
      configPath
    });
    const snapshot = context.capture();
    const baseConfig =
      settings.mode === 'real'
        ? snapshot.resolveLlmConfigStrict({
            modelProfileId: settings.modelProfileId,
            reasoningEffortOverride: settings.effort
          })
        : snapshot.resolveLlmConfig();
    if (settings.mode === 'real' && (baseConfig.model !== settings.model || baseConfig.agentType === 'fake')) {
      throw Error('Exact model mismatch or fake provider selected; refusing real evaluation');
    }
    resolvedModel = {
      agentType: baseConfig.agentType,
      providerId: baseConfig.providerId || null,
      model: baseConfig.model,
      effort: baseConfig.reasoningEffort || 'none',
      baseURL: baseConfig.baseURL || null
    };
    // 不加载真实用户的 AGENTS、Skills、记忆或 SYSTEM；配置只用于解析明确选定的模型。
    os.homedir = () => fixture.home;
    const allowed = new Set([...READ_TOOLS, ...(group === 'native' ? [] : ['run_code'])]);
    const config = {
      ...baseConfig,
      tools: {
        ...baseConfig.tools,
        codeMode: {
          enabled: group !== 'native'
        },
        sandbox: {
          mode: 'off',
          network: false,
          extraWritablePaths: []
        }
      }
    };
    const runSnapshot = {
      revision: snapshot.revision,
      getAppSettings: () => ({
        ...snapshot.getAppSettings(),
        agentInstructionFileName: 'AGENTS.md',
        toolApprovalMode: 'manual',
        compactionThresholdRatio: 1,
        skillCatalogContextRatio: 0.01
      }),
      getLlmModelConfigInfo: () => snapshot.getLlmModelConfigInfo(),
      resolveLlmConfig: () => config,
      resolveLlmConfigStrict: () => config,
      resolveLlmConfigForProfile: () => config
    };
    runtime.setup.prepareAgent = (options) => {
      const prepared = originalPrepare({
        ...options,
        config,
        allowedToolNames: allowed,
        includeMcpTools: false,
        mcpManager: undefined,
        subagentPort: undefined,
        skillRegistry: {
          listCatalog: () => [],
          listEnabled: () => []
        }
      });
      definitions = prepared.registry.listDefinitions();
      if (group !== 'native' && !definitions.some(({name}) => name === 'run_code')) {
        throw Error('Code runtime unavailable; evaluation must not silently fall back to native');
      }
      const registry = prepared.registry;
      const wrapped = new Map();
      for (const name of allowed) {
        const handler = registry.getHandler(name);
        if (!handler) {
          continue;
        }
        wrapped.set(name, {
          ...handler,
          async execute(args, call, options) {
            if (READ_TOOLS.includes(name) && outsideFixture(fixture.cwd, name, args)) {
              deniedRequests.push({
                source: 'native-path',
                call,
                reason: 'Evaluation fixture path boundary'
              });
              return {
                callId: call.callId,
                toolName: name,
                ok: false,
                details: {
                  kind: 'generic'
                },
                text: 'Evaluation denied a path outside fixture'
              };
            }
            let accounted = 0;
            const result = await handler.execute(
              args,
              call,
              name === 'run_code'
                ? {
                    ...options,
                    onCodeAudit(record) {
                      options.onCodeAudit?.(record);
                      if (record.event !== 'call_start') {
                        return;
                      }
                      // 在参数校验前计费，非法调用不能先耗掉预算、再偷跑一次合法查询。
                      accounted += 1;
                      toolAttempts += 1;
                      // 审计来自 IPC 事件回调，只中断而不向 EventEmitter 抛错。
                      if (toolAttempts > settings.budgets.tools) {
                        stopBudget('Evaluation tool-attempt budget exceeded');
                      }
                    }
                  }
                : options
            );
            if (name === 'run_code') {
              const output = JSON.parse(result.text);
              // 未生成子调用事件就终止的非法协议尝试仍按执行器的可信计数补记。
              charge(Math.max(0, (output.summary?.attempted || 0) - accounted));
            }
            raw.toolOutputs.push({
              channel: 'native-or-outer',
              call,
              result
            });
            return result;
          },
          ...(handler.executeScript
            ? {
                async executeScript(args, call, options) {
                  if (outsideFixture(fixture.cwd, name, args)) {
                    deniedRequests.push({
                      source: 'bridge-path',
                      call,
                      reason: 'Evaluation fixture path boundary'
                    });
                    return {
                      schema_version: 1,
                      ok: false,
                      data: null,
                      error: {
                        code: 'invalid_arguments',
                        message: 'Evaluation denied a path outside fixture'
                      },
                      truncated: false
                    };
                  }
                  const result = await handler.executeScript(args, call, options);
                  raw.toolOutputs.push({
                    channel: 'script-envelope',
                    call,
                    result
                  });
                  return result;
                }
              }
            : {})
        });
      }
      const safeRegistry = {
        ...registry,
        getHandler: (name) => (allowed.has(name) ? wrapped.get(name) : undefined)
      };
      const providerTask = {
        id: task.id,
        prompt: task.prompt
      };
      const provider = providerFactory
        ? providerFactory(providerTask, group)
        : settings.mode === 'scripted'
          ? createScriptedProvider(providerTask, group)
          : prepared.agent;
      return {
        ...prepared,
        registry: safeRegistry,
        agent: {
          async runTurn(records, callbacks, options) {
            if (++turns > settings.budgets.turns) {
              throw stopBudget('Evaluation provider-turn budget exceeded');
            }
            if (controller.signal.aborted) {
              throw controller.signal.reason;
            }
            raw.providerRequests.push(structuredClone(records));
            let result;
            try {
              result = await provider.runTurn(records, callbacks, {
                ...options,
                abortSignal: controller.signal
              });
            } catch (error) {
              raw.providerFailures.push({
                turn: turns,
                name: error.name,
                message: error.message
              });
              throw error;
            }
            raw.providerResponses.push(structuredClone(result));
            const input = result.usage?.inputTokens ?? result.usageInputTokens;
            const output = result.usage?.outputTokens;
            const measured = Number.isFinite(input) && Number.isFinite(output);
            usage.turns.push({
              usage: result.usage || null,
              usageInputTokens: result.usageInputTokens ?? null,
              complete: measured
            });
            if (measured) {
              usage.inputTokens += input;
              usage.outputTokens += output;
              usage.totalTokens += input + output;
            } else {
              usage.complete = false;
            }
            const calls = result.toolCalls || [];
            requestedScripts += calls.filter((call) => call.toolName === 'run_code').length;
            const forbidden = calls.filter((call) => !allowed.has(call.toolName));
            for (const call of forbidden) {
              deniedRequests.push({
                source: 'provider',
                call,
                reason: 'Evaluation read-only allowlist; not dispatched'
              });
            }
            // 额外 fail-closed 门阻止 todo/问题等 loop 特判绕过 registry；不把拒绝算实际越权。
            charge(calls.length);
            if (settings.mode === 'real' && !measured) {
              throw stopBudget('Provider usage missing; token budget cannot be checked');
            }
            if (usage.totalTokens > settings.budgets.tokens) {
              throw stopBudget('Evaluation reported-token budget exceeded');
            }
            if (forbidden.length) {
              throw Error('Disallowed tool requested; case stopped before dispatch');
            }
            return result;
          }
        }
      };
    };
    const observation = {
      ...runtime.disabledObservation,
      toolStarted(input) {
        raw.lifecycle.push({
          event: 'start',
          ...input
        });
      },
      toolCompleted(input) {
        raw.lifecycle.push({
          event: 'end',
          ...input
        });
        if (input.status === 'rejected') {
          deniedRequests.push({
            source: 'bridge',
            ...input
          });
        }
      }
    };
    before = snapshotTree(fixture.cwd);
    const instruction =
      group === 'forced'
        ? 'Diagnostic group: use run_code for all file queries. Native definitions remain available; this instruction is not an enforced permission rule.'
        : 'Native tools are available. Use run_code only if it is available and useful; it is optional.';
    const prompt = `${task.prompt}\n${instruction}\nOnly read fixture files. Do not request bash, writes, network, MCP, subagents or other tools. Return exactly the requested JSON object, no Markdown or success claims.`;
    const run = runtime.createLoop(
      fixture.cwd,
      {
        capture: () => runSnapshot
      },
      undefined,
      observation
    );
    finalText = await run(
      {
        records: [
          {
            role: 'user',
            text: prompt
          }
        ],
        userConfigSnapshot: runSnapshot,
        executionMode: {
          kind: 'headless',
          approvalPolicy: 'deny'
        },
        interactionMode: 'plan',
        toolPolicy: 'readonly',
        abortSignal: controller.signal,
        ...(settings.modelProfileId
          ? {
              modelProfileId: settings.modelProfileId
            }
          : {})
      },
      {
        onCodeExecutionRecords(records) {
          raw.audit.push(...records);
        },
        onToolResult(result) {
          raw.outerResults.push(result);
        },
        onProviderRetry(retry) {
          raw.providerRetries.push(retry);
        },
        onToolApprovalRequest(call) {
          deniedRequests.push({
            source: 'approval',
            call,
            reason: 'No approvals in evaluation'
          });
          return {
            kind: 'deny'
          };
        },
        onAssistantSegment(text) {
          finalText = text;
        }
      }
    );
  } catch (error) {
    failure ||= {
      kind: 'execution',
      name: error.name,
      message: error.message
    };
  } finally {
    clearTimeout(timeout);
    controller.abort();
    if (before) {
      try {
        after = snapshotTree(fixture.cwd);
      } catch (error) {
        after = {
          snapshotError: error.message
        };
        failure ||= {
          kind: 'snapshot',
          message: error.message
        };
      }
    }
    runtime.setup.prepareAgent = originalPrepare;
    os.homedir = originalHomedir;
    context?.close();
    fixture.cleanup();
  }
  const fixtureChanges = before ? compareTrees(before, after) : [];
  for (const call of raw.providerResponses
    .flatMap((response) => response.toolCalls || [])
    .filter((call) => call.toolName === 'run_code')) {
    const rawResult = raw.outerResults.find((result) => result.callId === call.callId);
    let output = null;
    try {
      const parsed = JSON.parse(rawResult?.text);
      if (['succeeded', 'failed', 'cancelled'].includes(parsed?.status)) {
        output = parsed;
      }
    } catch {
    }
    scripts.push({
      call,
      output,
      rawResult: rawResult || null,
      independentVerdict: judge(task, output ? JSON.stringify(output.result) : '')
    });
  }
  const repairs = scripts.filter(
    (script, index) =>
      index > 0 &&
      scripts[index - 1].output?.status !== 'succeeded' &&
      script.call.argumentsText !== scripts[index - 1].call.argumentsText
  ).length;
  const turnByCallId = new Map(
    raw.providerResponses.flatMap((response, turn) =>
      (response.toolCalls || []).map((call) => [call.callId, turn])
    )
  );
  const firstFailedScriptTurn = Math.min(
    ...scripts
      .filter((script) => script.output?.status !== 'succeeded')
      .map((script) => turnByCallId.get(script.call.callId))
  );
  const nativeAfterScriptFailure = raw.toolOutputs.some(
    (entry) =>
      entry.channel === 'native-or-outer' &&
      READ_TOOLS.includes(entry.call.toolName) &&
      turnByCallId.get(entry.call.callId) > firstFailedScriptTurn
  );
  return {
    taskId: task.id,
    group,
    repeat,
    resolvedModel,
    definitions,
    durationMs: Math.round(performance.now() - started),
    turns,
    toolAttempts,
    usage,
    adoptedScript: requestedScripts > 0,
    firstScriptExecutionSuccess: requestedScripts ? scripts[0]?.output?.status === 'succeeded' : null,
    firstScriptTaskSuccess: requestedScripts ? scripts[0]?.independentVerdict.success === true : null,
    scriptAttempts: requestedScripts,
    scriptRetries: Math.max(0, requestedScripts - 1),
    repairs,
    nativeAfterScriptFailure,
    finalText,
    verdict: {
      ...judge(task, finalText),
      ...(failure
        ? {
            success: false,
            executionFailure: true
          }
        : {})
    },
    failure,
    scripts,
    deniedRequests,
    fixtureBefore: before || null,
    fixtureAfter: after || null,
    fixtureChanges,
    releaseBlocked: fixtureChanges.length > 0,
    raw
  };
}

async function runEvaluation(input) {
  const settings = validateSettings(input);
  const distRoot = path.resolve(settings.distRoot || path.join(__dirname, '../../dist'));
  const runtime = loadRuntime(distRoot);
  if (!runtime.runtimeAvailable()) {
    throw Error('QuickJS runtime unavailable; build/validate first, no fallback');
  }
  const cases = [];
  const selectedTasks = settings.taskIds ? TASKS.filter((task) => settings.taskIds.includes(task.id)) : TASKS;
  if (settings.outputDir) {
    fs.mkdirSync(settings.outputDir, {
      recursive: true
    });
  }
  for (let repeat = 0; repeat < settings.repeats; repeat += 1) {
    for (const [index, task] of selectedTasks.entries()) {
      // 交替配对次序，降低固定先后顺序的缓存/负载偏差；不声称消除 provider 非确定性。
      const groups = (repeat + index) % 2 === 0 ? settings.groups : [...settings.groups].reverse();
      for (const group of groups) {
        const row = await runCase(runtime, settings, task, group, repeat, settings.providerFactory);
        cases.push(row);
        if (settings.outputDir) {
          fs.writeFileSync(
            path.join(settings.outputDir, `${repeat}-${task.id}-${group}.json`),
            JSON.stringify(row, null, 2) + '\n',
            {
              flag: 'wx'
            }
          );
        }
        if (row.releaseBlocked) {
          break;
        }
      }
      if (cases.at(-1)?.releaseBlocked) {
        break;
      }
    }
    if (cases.at(-1)?.releaseBlocked) {
      break;
    }
  }
  const fingerprint = (tree) =>
    createHash('sha256')
      .update(JSON.stringify(tree))
      .digest('hex');
  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    runtimeTreeSha256: fingerprint(snapshotTree(path.join(distRoot, 'src'))),
    harnessTreeSha256: fingerprint(snapshotTree(__dirname)),
    plan: buildPlan(settings),
    summary: summarizeCases(cases, settings.mode),
    releaseBlocked: cases.some((row) => row.releaseBlocked),
    cases
  };
  if (settings.outputDir) {
    fs.writeFileSync(path.join(settings.outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n', {
      flag: 'wx'
    });
  }
  return report;
}

module.exports = {
  DEFAULT_BUDGETS,
  READ_TOOLS,
  outsideFixture,
  validateSettings,
  buildPlan,
  loadRuntime,
  runCase,
  runEvaluation,
  summarizeCases
};

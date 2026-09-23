const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {createAssistantCommandPort} = require('../../src/app/command/assistant-command-port');
const agentSetupModule = require('../../src/agent/agent-setup');
const {UserConfigContext} = require('../../src/config/user-config-context');

const TEST_CWD = '/tmp/echo_manual_compaction';
const TEST_JOURNAL_PATH = '/tmp/echo_manual_compaction/session.jsonl';
const TEST_CONFIG = {
  agentType: 'fake',
  apiKey: '',
  model: 'echo-fake',
  contextWindow: 128000,
  providerId: 'fake-provider',
  tools: {
    bash: {timeoutMs: 1000, maxOutputBytes: 1024},
    sandbox: {mode: 'off', network: false, extraWritablePaths: []}
  }
};

function createConfigSnapshot() {
  return {
    revision: 1,
    getAppSettings() {
      return {
        agentInstructionFileName: 'AGENTS.md',
        compactionThresholdRatio: 0.8,
        skillCatalogContextRatio: 0.02,
        toolApprovalMode: 'manual'
      };
    }
  };
}

function createSession(interactionMode) {
  return {
    compaction: {summaryText: 'EXISTING SUMMARY', activeStartIndex: 0, createdAt: '2026-08-01T00:00:00.000Z'},
    interactionMode,
    modelProfileId: 'fake-profile',
    records: Array.from({length: 30}, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      text: `message ${index} `.repeat(10)
    })),
    sessionId: 'session-1',
    sessionJournalPath: TEST_JOURNAL_PATH,
    userConfigSnapshot: createConfigSnapshot()
  };
}

/** 手动压缩端口只消费 app 领域状态；这里给出最小 AppContext 投影。 */
function createAppContext(session, interactionMode) {
  return {
    getAgentSession() {
      return session;
    },
    getCurrentCwd() {
      return TEST_CWD;
    },
    getInteractionMode() {
      return interactionMode;
    },
    transcriptContext: {},
    turnContext: {}
  };
}

/** 用与 runtime 同源的口径替换装配边界，让断言聚焦端口自身构造的请求。 */
async function withPatchedPrepareAgent(agent, callback) {
  const originalPrepareAgent = agentSetupModule.prepareAgent;
  const preparations = [];
  const registry = {
    getHandler() {
      return undefined;
    },
    isEmpty() {
      return false;
    },
    listDefinitions() {
      return [];
    },
    listSkillCatalog() {
      return [{name: 'review', description: 'Review the current diff', sourceKind: 'builtin', sourcePath: '/tmp/skills/review'}];
    }
  };

  agentSetupModule.prepareAgent = (options = {}) => {
    preparations.push(options);
    return {agent, config: TEST_CONFIG, registry};
  };

  try {
    return await callback(preparations);
  } finally {
    agentSetupModule.prepareAgent = originalPrepareAgent;
  }
}

async function withTemporaryHome(callback) {
  const originalHomedir = os.homedir;
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-manual-compact-'));
  os.homedir = () => homeDir;

  try {
    return await callback();
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(homeDir, {recursive: true, force: true});
  }
}

test('manual compaction sends the shared prefix and records summary usage', async () => {
  await withTemporaryHome(async () => {
    const requests = [];
    const usageEvents = [];
    const agent = {
      async runTurn(records, callbacks, options = {}) {
        requests.push({options, records});
        return {
          draft: '## Background and Goals\n- 压缩完成。',
          toolCalls: [],
          usage: {cacheReadInputTokens: 512, inputTokens: 1024, outputTokens: 64},
          usageInputTokens: 1024
        };
      }
    };
    const session = createSession('normal');

    const result = await withPatchedPrepareAgent(agent, async (preparations) => {
      const port = createAssistantCommandPort({
        appContext: createAppContext(session, 'normal'),
        mcpManager: {listReadonlyToolNames: () => new Set()},
        render() {},
        renderRecords() {},
        submitUserMessage: async () => true,
        usageStore: {
          appendEvent(event) {
            usageEvents.push(event);
            return event;
          },
          listDailyUsage: () => [],
          listModelUsage: () => []
        },
        userConfigContext: new UserConfigContext()
      });

      const compaction = await port.compactContext({force: true});

      // registry 与沙箱口径：手动压缩按与 runAgentLoop 相同的默认派生装配，并共享 MCP 目录。
      assert.equal(preparations.length, 1);
      assert.deepEqual(preparations[0].executionMode, {kind: 'interactive'});
      assert.equal(preparations[0].cwd, TEST_CWD);
      assert.equal(preparations[0].sessionId, 'session-1');
      assert.equal(typeof preparations[0].mcpManager, 'object');
      assert.equal('sandboxModeOverride' in preparations[0], false);
      // 委派目录：schema-only 端口使压缩请求与主会话一致携带 run_subagent 定义。
      assert.deepEqual(preparations[0].subagentPort.listDefinitions().map(({name}) => name), ['explorer', 'worker']);

      return compaction;
    });

    assert.equal(result.didCompact, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.isCompaction, true);
    assert.equal(requests[0].options.sessionId, 'session-1');
    assert.equal(requests[0].options.includeToolDefinitions, true);

    const input = requests[0].records;
    const boundary = result.compaction.activeStartIndex;

    // 前导：内置 system prompt（含 registry 口径的 skill 目录） + 原位的既有摘要消息。
    assert.equal(input[0].role, 'system');
    assert.match(input[0].text, /Available Skills:/);
    assert.match(input[0].text, /review: Review the current diff/);
    assert.match(input[0].text, new RegExp(`Current working directory: ${TEST_CWD}`));
    assert.equal(input[1].role, 'user');
    assert.match(input[1].text, /EXISTING SUMMARY/);
    assert.match(input[1].text, /source_file: \/tmp\/echo_manual_compaction\/session\.jsonl/);
    // 被压缩记录保持原生投影，摘要指令是最后一条 user 消息。
    assert.deepEqual(input.slice(2, 2 + boundary), session.records.slice(0, boundary));
    assert.equal(input[input.length - 1].role, 'user');
    assert.equal(input[input.length - 1].text.includes('## Background and Goals'), true);
    // 摘要请求 usage 记入本地账本。
    assert.equal(usageEvents.length, 1);
    assert.equal(usageEvents[0].inputTokens, 1024);
    assert.equal(usageEvents[0].cacheReadInputTokens, 512);
    assert.equal(usageEvents[0].outputTokens, 64);
    assert.equal(usageEvents[0].model, 'echo-fake');
  });
});

test('manual compaction derives the plan-mode sandbox tightening', async () => {
  await withTemporaryHome(async () => {
    const agent = {
      async runTurn() {
        return {draft: 'summary', toolCalls: []};
      }
    };
    const session = createSession('plan');

    await withPatchedPrepareAgent(agent, async (preparations) => {
      const port = createAssistantCommandPort({
        appContext: createAppContext(session, 'plan'),
        mcpManager: {listReadonlyToolNames: () => new Set()},
        render() {},
        renderRecords() {},
        submitUserMessage: async () => true,
        usageStore: {appendEvent: () => null, listDailyUsage: () => [], listModelUsage: () => []},
        userConfigContext: new UserConfigContext()
      });

      await port.compactContext({force: true});

      // plan 模式默认派生运行级 read-only 收紧，与 runAgentLoop 的默认工具策略组合一致。
      assert.equal(preparations[0].sandboxModeOverride, 'read-only');
    });
  });
});

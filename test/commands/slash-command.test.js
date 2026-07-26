const test = require('node:test');
const assert = require('node:assert/strict');

const { AgentWorkflowCommandHandler } = require('../../src/commands/agent-workflows/agent-workflow-command-handler');
const { ClearCommandHandler } = require('../../src/commands/clear-command-handler');
const { CompactCommandHandler } = require('../../src/commands/compact-command-handler');
const { ConfigCommandHandler } = require('../../src/commands/config/handler');
const { ContextCommandHandler } = require('../../src/commands/context-command-handler');
const { CopyCommandHandler } = require('../../src/commands/copy-command-handler');
const { DiffCommandHandler } = require('../../src/commands/diff-command-handler');
const { EffortCommandHandler } = require('../../src/commands/effort-command-handler');
const { HelpCommandHandler } = require('../../src/commands/help-command-handler');
const { HooksCommandHandler } = require('../../src/commands/hooks-command-handler');
const { McpCommandHandler } = require('../../src/commands/mcp-command-handler');
const { MemoryCommandHandler } = require('../../src/commands/memory-command-handler');
const { MODEL_CONFIG_PATH_HINT, ModelCommandHandler } = require('../../src/commands/model-command-handler');
const { ModeCommandHandler } = require('../../src/commands/mode-command-handler');
const { ResumeCommandHandler, RESUME_PAGE_SIZE } = require('../../src/commands/resume-command-handler');
const { SkillsCommandHandler } = require('../../src/commands/skills-command-handler');
const { SkillInvocationCommandHandler } = require('../../src/commands/skill-invocation-command-handler');
const { StatusCommandHandler } = require('../../src/commands/status-command-handler');
const { UndoCommandHandler } = require('../../src/commands/undo-command-handler');
const { UsageCommandHandler } = require('../../src/commands/usage-command-handler');
const {
  createDefaultSlashCommandHandlers,
  createSlashCommandDescriptors,
  resolveSlashCommand
} = require('../../src/commands/resolve-slash-command');
const { INPUT_EVENTS } = require('../../src/input/event-types');

function createResumeSessions(count) {
  return Array.from({ length: count }, (_value, index) => ({
    sessionId: `session-${index + 1}`,
    updatedAt: `2026-05-${String(index + 10).padStart(2, '0')}T10:0${index % 6}:00.000Z`,
    messageCount: index + 1,
    lastMessagePreview: `message ${index + 1}`,
    previewRecords: [{ role: 'assistant', text: `message ${index + 1}` }]
  })).reverse();
}

function createFakeHost(options = {}) {
  const calls = {
    clears: 0,
    assistantCalls: [],
    effortSelections: [],
    loadedSessionIds: [],
    modelSelections: [],
    modeSelections: [],
    listedConfigProviders: [],
    renders: 0,
    resets: 0,
    savedConfigDrafts: [],
    savedSettingsDrafts: [],
    savedHookDrafts: [],
    hookTests: [],
    savedMcpServers: [],
    savedSkills: [],
    sessionCloses: 0,
    sessionOpens: [],
    sessionUpdates: [],
    statusQueries: 0,
    clipboardWrites: [],
    transcriptAppends: [],
    themeSelections: [],
    undoExecutes: 0,
    resizeRecoveries: 0
  };
  let activeSession = null;
  const host = {
    composer: {
      reset() {
        calls.resets += 1;
      },
      leaveHistoryBrowsing() {}
    },
    transcript: {
      clear() {
        calls.clears += 1;
      },
      loadSession(sessionId) {
        calls.loadedSessionIds.push(sessionId);
        return true;
      },
      append(record) {
        calls.transcriptAppends.push(record);
      },
      listCopyableRecords() {
        return (options.copyableRecords || []).map((record) => ({...record}));
      },
      listResumeSessions() {
        return (options.sessions || []).map((session) => ({ ...session }));
      }
    },
    clipboard: {
      writeText(text) {
        calls.clipboardWrites.push(text);
        return Promise.resolve(options.clipboardResult || {ok: true});
      }
    },
    model: {
      createModelCommandInfo() {
        return { ...(options.modelCommandInfo || { error: 'LLM 配置缺少 models' }) };
      },
      selectModel(modelId) {
        calls.modelSelections.push(modelId);
        return options.selectModel ? options.selectModel(modelId) : { ok: true };
      },
      createEffortCommandInfo() {
        return { ...(options.effortCommandInfo || { error: 'LLM 配置缺少 models' }) };
      },
      selectEffort(effort) {
        calls.effortSelections.push(effort);
        return options.selectEffort ? options.selectEffort(effort) : { ok: true };
      }
    },
    config: {
      readSettings() {
        if (options.settingsReadError) {
          throw new Error(options.settingsReadError);
        }
        return structuredClone(options.appSettings || {
          compactionThresholdRatio: 0.8,
          showReasoningSummary: true,
          slashSuggestionMaxVisible: 8
        });
      },
      readDraft() {
        if (options.configReadError) {
          throw new Error(options.configReadError);
        }

        return options.configDraft || {
          providers: [{
            id: 'chat',
            label: 'Chat',
            preset: 'openai-chat-compatible-api',
            apiKey: 'chat-api-key',
            models: [{id: 'chat-gpt', model: 'gpt-chat'}]
          }],
          selectedModelId: 'chat-gpt',
          rootConfig: {}
        };
      },
      listModels(provider) {
        calls.listedConfigProviders.push({ ...provider, models: provider.models.map((model) => ({ ...model })) });
        return options.listConfigModels ? options.listConfigModels(provider) : Promise.resolve({ok: true, models: []});
      },
      saveDraft(draft) {
        calls.savedConfigDrafts.push(draft);
        return options.saveConfig ? options.saveConfig(draft) : {ok: true};
      },
      saveSettings(draft) {
        calls.savedSettingsDrafts.push(structuredClone(draft));
        return options.saveSettings ? options.saveSettings(draft) : {ok: true};
      }
    },
    skills: {
      createSkillInvocation(skillName, argumentsText) {
        return options.createSkillInvocation
          ? options.createSkillInvocation(skillName, argumentsText)
          : { ok: false, reason: 'missing', message: 'missing' };
      },
      listSkills() {
        return (options.skills || []).map((skill) => ({ ...skill }));
      },
      listEnabledSkillDescriptors() {
        return [];
      },
      saveSkillStates(skills) {
        calls.savedSkills.push(skills.map((skill) => ({ ...skill })));
      }
    },
    mcp: {
      listServers() {
        return (options.mcpServers || []).map((server) => ({ ...server }));
      },
      saveServerStates(servers) {
        calls.savedMcpServers.push(servers.map((server) => ({ ...server })));
        return Promise.resolve(options.saveMcpResult || {ok: true, diagnostics: []});
      }
    },
    hooks: {
      readDraft() {
        return structuredClone(options.hooksDraft || {
          configPath: '/tmp/echo/config.json',
          diagnostics: [],
          events: [
            {event: 'assistant_turn_start', entries: []},
            {event: 'assistant_turn_end', entries: [
              {command: 'echo done', enabled: true, timeoutMs: 1000},
              {command: 'echo disabled', enabled: false, timeoutMs: 2000}
            ]},
            {event: 'assistant_turn_error', entries: []},
            {event: 'assistant_turn_cancelled', entries: []},
            {event: 'tool_call_start', entries: []},
            {event: 'tool_call_end', entries: []},
            {event: 'tool_approval_request', entries: []},
            {event: 'tool_approval_response', entries: []},
            {event: 'user_question_request', entries: []},
            {event: 'user_question_response', entries: []},
            {event: 'compaction_end', entries: []}
          ]
        });
      },
      saveDraft(draft) {
        calls.savedHookDrafts.push(structuredClone(draft));
        return options.saveHooks ? options.saveHooks(draft) : {ok: true};
      },
      testEntry(event, entry) {
        calls.hookTests.push({event, entry: {...entry}});
        return Promise.resolve(options.hookTestResult || {
          ok: true,
          exitCode: 0,
          durationMs: 12,
          stdout: 'out',
          stdoutTruncated: false,
          stderr: '',
          stderrTruncated: false
        });
      }
    },
    mode: {
      getInteractionMode() {
        return calls.modeSelections.at(-1) || options.interactionMode || 'normal';
      },
      setInteractionMode(mode) {
        calls.modeSelections.push(mode);
      }
    },
    theme: {
      listThemes() {
        return (options.themes || []).map((theme) => ({...theme}));
      },
      selectTheme(themeId) {
        calls.themeSelections.push(themeId);
        return options.selectTheme ? options.selectTheme(themeId) : {ok: true};
      }
    },
    context: {
      getUsage() {
        return options.contextUsage ? structuredClone(options.contextUsage) : null;
      }
    },
    status: {
      createSnapshot() {
        return structuredClone(options.statusSnapshot || {
          cwd: '/tmp/echo_tui',
          sessionId: null,
          model: {agentType: 'fake', model: 'echo-fake-agent', provider: 'fake'},
          agentInstructions: [],
          userMemoryCount: 0,
          agentMemoryCatalogs: [],
          diagnostics: []
        });
      },
      queryCodexUsage() {
        calls.statusQueries += 1;
        return options.queryStatusUsage
          ? options.queryStatusUsage()
          : Promise.resolve({status: 'unavailable', error: 'Codex 用量不可用'});
      }
    },
    usage: {
      listDailyUsage(query) {
        calls.usageQueries = calls.usageQueries || [];
        calls.usageQueries.push(query || {});
        return (options.dailyUsage || []).map((day) => ({ ...day }));
      },
      getViewport() {
        return options.usageViewport || {width: 100, maxLines: 22};
      }
    },
    diff: {
      getSource() {
        return options.diffSource || {status: 'empty', source: {kind: 'history', label: 'apply_patch history'}, files: [], notices: []};
      },
      getViewport() {
        return options.diffViewport || {width: 100, maxLines: 10};
      }
    },
    undo: {
      getSummary() {
        return options.undoSummary || {status: 'none'};
      },
      execute() {
        calls.undoExecutes += 1;
        return options.undoExecuteResult || {ok: true, checkpoint: {id: 'undo-1'}};
      }
    },
    assistant: {
      beginManualCompaction() {
        calls.assistantCalls.push('beginManualCompaction');
        return options.beginManual === undefined ? true : options.beginManual;
      },
      compactContext() {
        calls.assistantCalls.push('compactContext');
        if (options.runForceRejects) {
          return Promise.reject(new Error('compact failed'));
        }
        return Promise.resolve(options.compactionResult || { didCompact: false, reason: 'no_boundary' });
      },
      finishManualCompaction(result) {
        calls.assistantCalls.push(`finishManualCompaction:${result.reason}`);
      },
      fail(error) {
        calls.assistantCalls.push(`fail:${error.message}`);
      }
    },
    session: {
      open(session) {
        activeSession = session;
        calls.sessionOpens.push(session);
      },
      update(patch) {
        activeSession = {
          ...activeSession,
          ...patch
        };
        calls.sessionUpdates.push(patch);
      },
      close() {
        activeSession = null;
        calls.sessionCloses += 1;
      },
      getActive() {
        return activeSession;
      }
    },
    ui: {
      renderFooter() {
        calls.renders += 1;
      },
      renderResizeRecovery() {
        calls.resizeRecoveries += 1;
      },
      exit() {}
    }
  };

  return { calls, host };
}

function createDefaultHandlersForTest() {
  return createDefaultSlashCommandHandlers();
}

function startCommand(handler, text, host) {
  handler.start(text, host);
  return host.session.getActive();
}

async function openConfigModelsTab(handler, session, host) {
  await handler.handleEvent(session, {type: INPUT_EVENTS.TAB}, host);
  return host.session.getActive();
}

test('resolveSlashCommand asks handlers in order and returns the first match', () => {
  const hits = [];
  const handlers = [
    {
      name: 'first',
      match(text) {
        hits.push(`first:${text}`);
        return false;
      }
    },
    {
      name: 'second',
      match(text) {
        hits.push(`second:${text}`);
        return true;
      }
    },
    {
      name: 'third',
      match() {
        hits.push('third');
        return true;
      }
    }
  ];

  const result = resolveSlashCommand('/local', handlers);

  assert.deepEqual(hits, ['first:/local', 'second:/local']);
  assert.equal(result.name, 'second');
});

test('createDefaultSlashCommandHandlers wires handlers in order', () => {
  const handlers = createDefaultHandlersForTest();

  assert.equal(handlers.length, 21);
  assert.equal(handlers.some((handler) => handler.name === 'skill'), false);
  assert.equal(handlers[0].name, 'help');
  assert.equal(handlers[1].name, 'config');
  assert.equal(handlers[2].name, 'model');
  assert.equal(handlers[3].name, 'effort');
  assert.equal(handlers[4].name, 'mode');
  assert.equal(handlers[5].name, 'status');
  assert.equal(handlers[6].name, 'context');
  assert.equal(handlers[7].name, 'usage');
  assert.equal(handlers[8].name, 'copy');
  assert.equal(handlers[9].name, 'clear');
  assert.equal(handlers[10].name, 'compact');
  assert.equal(handlers[11].name, 'diff');
  assert.equal(handlers[12].name, 'undo');
  assert.equal(handlers[13].name, 'resume');
  assert.equal(handlers[14].name, 'mcp');
  assert.equal(handlers[15].name, 'memory');
  assert.equal(handlers[16].name, 'hooks');
  assert.equal(handlers[17].name, 'skills');
  assert.equal(handlers[18].name, 'init');
  assert.equal(handlers[19].name, 'review');
  assert.equal(handlers[20].name, undefined);
  assert.equal(handlers[0] instanceof HelpCommandHandler, true);
  assert.equal(handlers[1] instanceof ConfigCommandHandler, true);
  assert.equal(handlers[2] instanceof ModelCommandHandler, true);
  assert.equal(handlers[3] instanceof EffortCommandHandler, true);
  assert.equal(handlers[4] instanceof ModeCommandHandler, true);
  assert.equal(handlers[5] instanceof StatusCommandHandler, true);
  assert.equal(handlers[6] instanceof ContextCommandHandler, true);
  assert.equal(handlers[7] instanceof UsageCommandHandler, true);
  assert.equal(handlers[8] instanceof CopyCommandHandler, true);
  assert.equal(handlers[9] instanceof ClearCommandHandler, true);
  assert.equal(handlers[10] instanceof CompactCommandHandler, true);
  assert.equal(handlers[11] instanceof DiffCommandHandler, true);
  assert.equal(handlers[12] instanceof UndoCommandHandler, true);
  assert.equal(handlers[13] instanceof ResumeCommandHandler, true);
  assert.equal(handlers[14] instanceof McpCommandHandler, true);
  assert.equal(handlers[15] instanceof MemoryCommandHandler, true);
  assert.equal(handlers[16] instanceof HooksCommandHandler, true);
  assert.equal(handlers[17] instanceof SkillsCommandHandler, true);
  assert.equal(handlers[18] instanceof AgentWorkflowCommandHandler, true);
  assert.equal(handlers[19] instanceof AgentWorkflowCommandHandler, true);
  assert.equal(handlers[20] instanceof SkillInvocationCommandHandler, true);
});

test('statusCommandHandler loads Codex usage and isolates late results', async () => {
  const handler = new StatusCommandHandler();
  let resolveUsage;
  const usagePromise = new Promise((resolve) => {
    resolveUsage = resolve;
  });
  const snapshot = {
    cwd: '/tmp/project',
    sessionId: 'session-1',
    model: {agentType: 'codex', model: 'gpt-codex', provider: 'codex'},
    agentInstructions: [],
    userMemoryCount: 0,
    agentMemoryCatalogs: [],
    diagnostics: []
  };
  const harness = createFakeHost({statusSnapshot: snapshot, queryStatusUsage: () => usagePromise});

  assert.equal(handler.match('/status'), true);
  assert.equal(handler.match('/status now'), false);
  assert.equal(resolveSlashCommand('/status', createDefaultHandlersForTest()).name, 'status');

  let session = startCommand(handler, '/status', harness.host);
  assert.equal(session.surface.kind, 'status');
  assert.equal(session.surface.usage.status, 'loading');
  assert.equal(harness.calls.statusQueries, 1);
  assert.deepEqual(harness.calls.transcriptAppends, []);

  resolveUsage({
    status: 'available',
    primary: {usedPercent: 25, resetAt: 1_800_000_000_000},
    secondary: {usedPercent: 50, resetAt: 1_900_000_000_000}
  });
  await new Promise((resolve) => setImmediate(resolve));
  session = harness.host.session.getActive();
  assert.equal(session.surface.usage.status, 'available');
  assert.equal(session.surface.usage.primary.usedPercent, 25);
  assert.equal(harness.calls.sessionUpdates.length, 1);
  assert.equal(harness.calls.renders, 1);

  handler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: 'q'}, harness.host);
  assert.equal(harness.calls.sessionCloses, 1);
  assert.equal(harness.calls.resets, 2);

  let resolveLate;
  const lateHarness = createFakeHost({
    statusSnapshot: snapshot,
    queryStatusUsage: () => new Promise((resolve) => {
      resolveLate = resolve;
    })
  });
  session = startCommand(handler, '/status', lateHarness.host);
  handler.handleEvent(session, {type: INPUT_EVENTS.ESCAPE}, lateHarness.host);
  resolveLate({status: 'unavailable', error: 'late'});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lateHarness.calls.sessionUpdates.length, 0);
  assert.equal(lateHarness.calls.renders, 0);
});

test('statusCommandHandler resolves non-Codex usage and maps query rejection', async () => {
  const handler = new StatusCommandHandler();
  const local = createFakeHost({
    queryStatusUsage: () => Promise.resolve({status: 'not_applicable'})
  });
  let session = startCommand(handler, '/status', local.host);

  assert.equal(session.surface.usage.status, 'loading');
  assert.equal(local.calls.statusQueries, 1);
  await new Promise((resolve) => setImmediate(resolve));
  session = local.host.session.getActive();
  assert.equal(session.surface.usage.status, 'not_applicable');
  handler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, local.host);
  assert.equal(local.calls.sessionCloses, 1);

  const failed = createFakeHost({
    statusSnapshot: {
      cwd: '/tmp/project',
      sessionId: null,
      model: {agentType: 'codex', model: 'gpt-codex', provider: 'codex'},
      agentInstructions: [],
      userMemoryCount: 0,
      agentMemoryCatalogs: [],
      diagnostics: []
    },
    queryStatusUsage: () => Promise.reject(new Error('usage failed'))
  });
  startCommand(handler, '/status', failed.host);
  await new Promise((resolve) => setImmediate(resolve));
  session = failed.host.session.getActive();
  assert.equal(session.surface.usage.status, 'unavailable');
  assert.match(session.surface.usage.error, /usage failed/);

  const missingModel = createFakeHost({
    statusSnapshot: {
      cwd: '/tmp/project',
      sessionId: null,
      model: null,
      agentInstructions: [],
      userMemoryCount: 0,
      agentMemoryCatalogs: [],
      diagnostics: ['无法读取当前模型配置']
    },
    queryStatusUsage: () => Promise.resolve({status: 'unavailable', error: '无法读取当前模型配置'})
  });
  startCommand(handler, '/status', missingModel.host);
  assert.equal(missingModel.calls.statusQueries, 1);
  await new Promise((resolve) => setImmediate(resolve));
  session = missingModel.host.session.getActive();
  assert.equal(session.surface.usage.status, 'unavailable');
  assert.match(session.surface.usage.error, /无法读取当前模型配置/);
});

test('copyCommandHandler opens copy surface, toggles selection, and copies formatted text', async () => {
  const copyCommandHandler = new CopyCommandHandler();
  const host = createFakeHost({
    copyableRecords: [
      {id: 'message-0', role: 'user', text: 'question'},
      {id: 'message-1', role: 'assistant', text: 'answer'},
      {id: 'message-2', role: 'user', text: 'follow up'}
    ]
  });

  assert.equal(copyCommandHandler.match('/copy'), true);
  assert.equal(copyCommandHandler.match('/copy now'), false);
  assert.equal(resolveSlashCommand('/copy', createDefaultHandlersForTest()).name, 'copy');

  let session = startCommand(copyCommandHandler, '/copy', host.host);
  assert.equal(host.calls.resets, 1);
  assert.equal(session.surface.kind, 'copy');
  assert.equal(session.surface.selectedIndex, 1);
  assert.deepEqual(session.surface.selectedIds, ['message-1']);

  copyCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_DOWN}, host.host);
  session = host.host.session.getActive();
  assert.equal(session.surface.selectedIndex, 2);

  copyCommandHandler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: ' '}, host.host);
  session = host.host.session.getActive();
  assert.deepEqual(session.surface.selectedIds, ['message-1', 'message-2']);

  await copyCommandHandler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, host.host);
  assert.deepEqual(host.calls.clipboardWrites, ['Assistant:\nanswer\n\nUser:\nfollow up']);
  assert.equal(host.calls.sessionCloses, 1);
  assert.equal(host.calls.resets, 2);
  assert.equal(host.calls.transcriptAppends[0].role, 'local_notice');
  assert.match(host.calls.transcriptAppends[0].text, /已复制 2 条消息/);
});

test('copyCommandHandler handles empty, no selection, and clipboard failure states', async () => {
  const copyCommandHandler = new CopyCommandHandler();
  const empty = createFakeHost({copyableRecords: []});
  let session = startCommand(copyCommandHandler, '/copy', empty.host);
  assert.equal(session.surface.kind, 'info');
  assert.match(session.surface.lines.join('\n'), /没有可复制/);

  const noSelection = createFakeHost({copyableRecords: [{id: 'message-1', role: 'assistant', text: 'answer'}]});
  session = startCommand(copyCommandHandler, '/copy', noSelection.host);
  copyCommandHandler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: ' '}, noSelection.host);
  session = noSelection.host.session.getActive();
  await copyCommandHandler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, noSelection.host);
  assert.equal(noSelection.host.session.getActive().surface.kind, 'copy');
  assert.match(noSelection.host.session.getActive().surface.notice, /请先选择/);
  assert.deepEqual(noSelection.calls.clipboardWrites, []);

  const failure = createFakeHost({
    copyableRecords: [{id: 'message-1', role: 'assistant', text: 'answer'}],
    clipboardResult: {ok: false, error: 'missing clipboard'}
  });
  session = startCommand(copyCommandHandler, '/copy', failure.host);
  await copyCommandHandler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, failure.host);
  assert.equal(failure.calls.sessionCloses, 0);
  assert.deepEqual(failure.host.session.getActive().surface.selectedIds, ['message-1']);
  assert.match(failure.host.session.getActive().surface.notice, /missing clipboard/);
});

test('copyCommandHandler ignores clipboard results after copy session closes', async () => {
  const copyCommandHandler = new CopyCommandHandler();
  let resolveClipboard;
  const clipboardResult = new Promise((resolve) => {
    resolveClipboard = resolve;
  });
  const host = createFakeHost({
    copyableRecords: [{id: 'message-1', role: 'assistant', text: 'answer'}],
    clipboardResult
  });

  const session = startCommand(copyCommandHandler, '/copy', host.host);
  const copyPromise = copyCommandHandler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, host.host);

  copyCommandHandler.handleEvent(session, {type: INPUT_EVENTS.ESCAPE}, host.host);
  assert.equal(host.host.session.getActive(), null);

  resolveClipboard({ok: false, error: 'late failure'});
  await copyPromise;

  assert.equal(host.host.session.getActive(), null);
  assert.equal(host.calls.sessionUpdates.length, 0);
  assert.deepEqual(host.calls.transcriptAppends, []);
});


test('copyCommandHandler switches focus and scrolls preview pane', () => {
  const copyCommandHandler = new CopyCommandHandler();
  const host = createFakeHost({
    copyableRecords: [
      {id: 'message-0', role: 'user', text: 'question'},
      {id: 'message-1', role: 'assistant', text: ['line 1', 'line 2', 'line 3', 'line 4'].join('\n')},
      {id: 'message-2', role: 'user', text: 'next question'}
    ]
  });

  let session = startCommand(copyCommandHandler, '/copy', host.host);
  assert.equal(session.surface.focus, 'list');
  assert.equal(session.surface.previewScroll, 0);

  copyCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_RIGHT}, host.host);
  session = host.host.session.getActive();
  assert.equal(session.surface.focus, 'preview');

  copyCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_DOWN}, host.host);
  session = host.host.session.getActive();
  assert.equal(session.surface.selectedIndex, 1);
  assert.equal(session.surface.previewScroll, 1);

  copyCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_UP}, host.host);
  session = host.host.session.getActive();
  assert.equal(session.surface.previewScroll, 0);

  copyCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_LEFT}, host.host);
  session = host.host.session.getActive();
  assert.equal(session.surface.focus, 'list');

  copyCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_DOWN}, host.host);
  session = host.host.session.getActive();
  assert.equal(session.surface.selectedIndex, 2);
  assert.equal(session.surface.previewScroll, 0);
});

test('usageCommandHandler opens empty state without submitting transcript', () => {
  const usageCommandHandler = new UsageCommandHandler();
  const empty = createFakeHost({dailyUsage: []});

  assert.equal(usageCommandHandler.match('/usage'), true);
  assert.equal(usageCommandHandler.match('/usage today'), false);
  assert.equal(usageCommandHandler.match('/usage '), true);
  assert.equal(resolveSlashCommand('/usage', createDefaultHandlersForTest()).name, 'usage');
  assert.equal(resolveSlashCommand('/usage today', [usageCommandHandler]), null);

  const session = startCommand(usageCommandHandler, '/usage', empty.host);

  assert.equal(empty.calls.resets, 1);
  assert.equal(session.surface.kind, 'info');
  assert.match(session.surface.lines.join('\n'), /暂无 token usage/);
  assert.deepEqual(empty.calls.transcriptAppends, []);

  usageCommandHandler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, empty.host);
  assert.equal(empty.calls.sessionCloses, 1);
  assert.equal(empty.calls.resets, 2);
});

test('usageCommandHandler opens usage surface, navigates dates, and closes without transcript changes', () => {
  const usageCommandHandler = new UsageCommandHandler();
  const dailyUsage = Array.from({length: 20}, (_value, index) => ({
    localDay: `2026-06-${String(index + 1).padStart(2, '0')}`,
    inputTokens: 100 + index,
    cacheReadInputTokens: 20,
    cacheCreationInputTokens: 5,
    uncachedInputTokens: 80 + index,
    outputTokens: 40 + index,
    totalTokens: 140 + index * 2,
    hitRate: 20 / (100 + index),
    eventCount: 1
  }));
  const selectable = createFakeHost({dailyUsage, usageViewport: {width: 100, maxLines: 26}});

  let session = startCommand(usageCommandHandler, '/usage', selectable.host);

  assert.equal(session.surface.kind, 'usage');
  assert.equal(session.surface.offset, 6);
  assert.equal(session.data.dailyUsage.length, 20);
  assert.deepEqual(selectable.calls.transcriptAppends, []);

  usageCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_UP}, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.surface.offset, 5);

  usageCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_DOWN}, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.surface.offset, 6);

  usageCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_LEFT}, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.surface.offset, 5);

  usageCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_RIGHT}, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.surface.offset, 6);

  usageCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_HOME}, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.surface.offset, 0);

  usageCommandHandler.handleEvent(session, {type: INPUT_EVENTS.PAGE_DOWN}, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.surface.offset, 6);

  usageCommandHandler.handleEvent(session, {type: INPUT_EVENTS.PAGE_UP}, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.surface.offset, 0);

  usageCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_END}, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.surface.offset, 6);

  usageCommandHandler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: 'q'}, selectable.host);
  assert.equal(selectable.calls.sessionCloses, 1);
  assert.equal(selectable.calls.resets, 2);
  assert.deepEqual(selectable.calls.transcriptAppends, []);
});

test('usageCommandHandler starts at the latest day when the viewport shows fewer than fourteen days', () => {
  const usageCommandHandler = new UsageCommandHandler();
  const dailyUsage = Array.from({length: 12}, (_value, index) => ({
    localDay: index === 0 ? '2026-06-30' : `2026-07-${String(index).padStart(2, '0')}`,
    inputTokens: 100,
    cacheReadInputTokens: 20,
    cacheCreationInputTokens: 5,
    uncachedInputTokens: 80,
    outputTokens: 40,
    totalTokens: 140,
    hitRate: 0.2,
    eventCount: 1
  }));
  const selectable = createFakeHost({dailyUsage, usageViewport: {width: 90, maxLines: 18}});
  let session = startCommand(usageCommandHandler, '/usage', selectable.host);

  assert.equal(session.surface.offset, 2);

  usageCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_UP}, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.surface.offset, 1);

  usageCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_DOWN}, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.surface.offset, 2);
});

test('built-in /init workflow wins before direct skill invocation fallback', () => {
  const handlers = createDefaultHandlersForTest();
  const handler = resolveSlashCommand('/init', handlers);
  const plan = createFakeHost({interactionMode: 'plan'});
  const result = handler.start('/init', plan.host);

  assert.equal(handler instanceof AgentWorkflowCommandHandler, true);
  assert.deepEqual(plan.calls.modeSelections, ['normal']);
  assert.deepEqual(plan.calls.transcriptAppends, [{role: 'local_notice', text: '已从 plan mode 切换到 normal mode 以运行 /init 流程。'}]);
  assert.equal(result.kind, 'submit_user_message');
  assert.equal(result.displayText, '/init');
  assert.deepEqual(result.metadata, {
    agentWorkflow: {
      source: 'builtin',
      name: 'init'
    }
  });
  assert.equal('skillInvocation' in result.metadata, false);
  const argumentHandler = resolveSlashCommand('/init extra', handlers);
  const argumentResult = argumentHandler.start('/init extra', createFakeHost().host);
  assert.equal(argumentHandler instanceof AgentWorkflowCommandHandler, true);
  assert.deepEqual(argumentResult.metadata, {
    agentWorkflow: {
      source: 'builtin',
      name: 'init',
      argumentsText: 'extra'
    }
  });
  assert.equal('skillInvocation' in argumentResult.metadata, false);
});

test('built-in /review workflow wins before direct skill invocation fallback', () => {
  const handlers = createDefaultHandlersForTest();
  const handler = resolveSlashCommand('/review', handlers);
  const plan = createFakeHost({interactionMode: 'plan'});
  const result = handler.start('/review', plan.host);

  assert.equal(handler instanceof AgentWorkflowCommandHandler, true);
  assert.deepEqual(plan.calls.modeSelections, ['normal']);
  assert.deepEqual(plan.calls.transcriptAppends, [{role: 'local_notice', text: '已从 plan mode 切换到 normal mode 以运行 /review 流程。'}]);
  assert.equal(result.kind, 'submit_user_message');
  assert.equal(result.displayText, '/review');
  assert.deepEqual(result.metadata, {
    agentWorkflow: {
      source: 'builtin',
      name: 'review'
    }
  });
  assert.equal('skillInvocation' in result.metadata, false);
  const argumentHandler = resolveSlashCommand('/review extra', handlers);
  const argumentResult = argumentHandler.start('/review extra', createFakeHost().host);
  assert.equal(argumentHandler instanceof AgentWorkflowCommandHandler, true);
  assert.deepEqual(argumentResult.metadata, {
    agentWorkflow: {
      source: 'builtin',
      name: 'review',
      argumentsText: 'extra'
    }
  });
  assert.equal('skillInvocation' in argumentResult.metadata, false);

  const normal = createFakeHost({interactionMode: 'normal'});
  handler.start('/review', normal.host);
  assert.deepEqual(normal.calls.modeSelections, []);
  assert.deepEqual(normal.calls.transcriptAppends, []);
});

test('direct skill invocation returns typed per-turn model and effort overrides', () => {
  const handler = new SkillInvocationCommandHandler();
  const {host} = createFakeHost({
    createSkillInvocation(skillName, argumentsText) {
      return {
        ok: true,
        text: '[Skill Invocation]\nskill: review',
        metadata: {skillInvocation: {source: 'slash', skillName, argumentsText}},
        modelProfileId: 'review-profile',
        reasoningEffortOverride: 'high'
      };
    }
  });
  const result = handler.start('/review src/foo.ts', host);

  assert.equal(result.kind, 'submit_user_message');
  assert.equal(result.modelProfileId, 'review-profile');
  assert.equal(result.reasoningEffortOverride, 'high');
  assert.deepEqual(result.metadata, {
    skillInvocation: {source: 'slash', skillName: 'review', argumentsText: 'src/foo.ts'}
  });
});

test('undoCommandHandler reports unavailable, invalid, cancel, success, and failure states', () => {
  const unavailable = createFakeHost();
  const undoCommandHandler = new UndoCommandHandler();

  assert.equal(undoCommandHandler.match('/undo more'), false);
  assert.equal(undoCommandHandler.match('/undo'), true);
  assert.equal(resolveSlashCommand('/undo', createDefaultHandlersForTest()).name, 'undo');

  let session = startCommand(undoCommandHandler, '/undo', unavailable.host);
  assert.equal(session.surface.kind, 'info');
  assert.match(session.surface.lines.join('\n'), /暂无可回退/);
  undoCommandHandler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, unavailable.host);
  assert.equal(unavailable.calls.sessionCloses, 1);

  const invalid = createFakeHost({undoSummary: {status: 'invalid', reason: '写入型 bash 不可追踪'}});
  session = startCommand(undoCommandHandler, '/undo', invalid.host);
  assert.equal(session.surface.kind, 'info');
  assert.match(session.surface.lines.join('\n'), /写入型 bash 不可追踪/);

  const cancel = createFakeHost({
    undoSummary: {
      status: 'ready',
      checkpointId: 'undo-1',
      fileCount: 2,
      restoreFileCount: 1,
      deleteFileCount: 1
    }
  });
  session = startCommand(undoCommandHandler, '/undo', cancel.host);
  assert.equal(session.surface.kind, 'confirm');
  assert.deepEqual(session.surface.bodyLines, [
    '回退这轮对话与文件变更',
    '回退 1 个文件修改，删除 1 个新增文件。',
    '注意：会覆盖期间的手动修改'
  ]);
  undoCommandHandler.handleEvent(session, {type: INPUT_EVENTS.ESCAPE}, cancel.host);
  assert.equal(cancel.calls.undoExecutes, 0);
  assert.equal(cancel.calls.sessionCloses, 1);

  const success = createFakeHost({
    undoSummary: {
      status: 'ready',
      checkpointId: 'undo-1',
      fileCount: 0,
      restoreFileCount: 0,
      deleteFileCount: 0
    }
  });
  session = startCommand(undoCommandHandler, '/undo', success.host);
  undoCommandHandler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, success.host);
  assert.equal(success.calls.undoExecutes, 1);
  assert.equal(success.calls.sessionCloses, 1);
  assert.equal(success.calls.resizeRecoveries, 1);

  const failure = createFakeHost({
    undoSummary: {
      status: 'ready',
      checkpointId: 'undo-1',
      fileCount: 1,
      restoreFileCount: 1,
      deleteFileCount: 0
    },
    undoExecuteResult: {
      ok: false,
      reason: 'restore_failed',
      message: '文件恢复失败'
    }
  });
  session = startCommand(undoCommandHandler, '/undo', failure.host);
  undoCommandHandler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, failure.host);
  assert.equal(failure.calls.sessionCloses, 0);
  assert.equal(failure.host.session.getActive().surface.kind, 'info');
  assert.match(failure.host.session.getActive().surface.lines.join('\n'), /文件恢复失败/);
});

test('diffCommandHandler opens diff surface, handles focus and scroll, and closes', () => {
  const diffCommandHandler = new DiffCommandHandler();
  const diffSource = {
    status: 'ready',
    source: {kind: 'history', label: 'apply_patch history'},
    notices: ['非 Git 工作区：当前 diff 基于 apply_patch 历史拼接，可能不包含手动编辑或 shell 写入。'],
    files: [
      {
        path: 'a.txt',
        kind: 'modified',
        added: 1,
        removed: 1,
        hunks: [{
          oldStart: 1,
          newStart: 1,
          lines: [
            {kind: 'removed', text: 'before', oldLine: 1, newLine: null},
            {kind: 'added', text: 'after', oldLine: null, newLine: 1}
          ]
        }]
      },
      {
        path: 'b.txt',
        kind: 'added',
        added: 8,
        removed: 0,
        hunks: [{
          oldStart: 0,
          newStart: 1,
          lines: Array.from({length: 8}, (_value, index) => ({kind: 'added', text: `created ${index + 1}`, oldLine: null, newLine: index + 1}))
        }]
      }
    ]
  };
  const selectable = createFakeHost({diffSource});

  assert.equal(diffCommandHandler.match('/diff more'), false);
  assert.equal(diffCommandHandler.match('/diff'), true);
  assert.equal(resolveSlashCommand('/diff', createDefaultHandlersForTest()).name, 'diff');

  let session = startCommand(diffCommandHandler, '/diff', selectable.host);
  assert.equal(session.surface.kind, 'diff');
  assert.equal(session.surface.source.kind, 'history');
  assert.equal(session.data.selectedIndex, 0);
  assert.equal(selectable.calls.resets, 1);

  diffCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_DOWN}, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.data.selectedIndex, 1);
  assert.equal(session.data.detailScroll, 0);

  diffCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_RIGHT}, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.data.focus, 'detail');

  diffCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_DOWN}, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.data.selectedIndex, 1);
  assert.equal(session.data.detailScroll, 1);

  for (let index = 0; index < 5; index += 1) {
    diffCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_DOWN}, selectable.host);
    session = selectable.host.session.getActive();
  }
  assert.equal(session.data.detailScroll, 6);

  for (let index = 0; index < 5; index += 1) {
    diffCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_DOWN}, selectable.host);
    session = selectable.host.session.getActive();
  }
  assert.equal(session.data.detailScroll, 7);

  diffCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_UP}, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.data.detailScroll, 6);

  diffCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_LEFT}, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.data.focus, 'list');

  diffCommandHandler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, selectable.host);
  assert.equal(selectable.calls.sessionCloses, 1);
});

test('diffCommandHandler opens empty info surface', () => {
  const diffCommandHandler = new DiffCommandHandler();
  const empty = createFakeHost({
    diffSource: {
      status: 'empty',
      source: {kind: 'history', label: 'apply_patch history'},
      files: [],
      notices: ['非 Git 工作区']
    }
  });

  const session = startCommand(diffCommandHandler, '/diff', empty.host);

  assert.equal(session.surface.kind, 'info');
  assert.match(session.surface.lines.join('\n'), /当前没有可展示差异/);
  diffCommandHandler.handleEvent(session, {type: INPUT_EVENTS.ESCAPE}, empty.host);
  assert.equal(empty.calls.sessionCloses, 1);
});

test('configCommandHandler opens general tab, saves independently, and lazily opens models', () => {
  const configCommandHandler = new ConfigCommandHandler();
  const {calls, host} = createFakeHost();

  assert.equal(configCommandHandler.match('/config more'), false);
  assert.equal(configCommandHandler.match('config'), false);
  assert.equal(configCommandHandler.match('/config'), true);
  assert.equal(resolveSlashCommand('/config', createDefaultHandlersForTest()).name, 'config');

  const session = startCommand(configCommandHandler, '/config', host);

  assert.equal(calls.resets, 1);
  assert.equal(session.commandName, 'config');
  assert.equal(session.surface.kind, 'config');
  assert.equal(session.surface.view, 'general');
  assert.equal(session.surface.activeTab, 'general');
  assert.equal(session.data.models, undefined);

  configCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_RIGHT}, host);
  for (let index = 0; index < 3; index += 1) {
    configCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, host);
  }
  configCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  assert.equal(calls.savedSettingsDrafts.length, 1);
  assert.equal(calls.savedSettingsDrafts[0].compactionThresholdRatio, 0.85);
  assert.match(host.session.getActive().surface.state.feedback, /已保存/);

  configCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.TAB}, host);
  assert.equal(host.session.getActive().surface.view, 'models');
  assert.equal(host.session.getActive().surface.state.draft.providers[0].id, 'chat');
});

test('configCommandHandler isolates tab read errors and keeps save errors inline', () => {
  const configCommandHandler = new ConfigCommandHandler();
  const readError = createFakeHost({settingsReadError: 'cannot read settings'});

  const errorSession = startCommand(configCommandHandler, '/config', readError.host);
  assert.equal(errorSession.surface.kind, 'config');
  assert.equal(errorSession.surface.view, 'error');
  assert.match(errorSession.surface.error, /cannot read settings/);

  configCommandHandler.handleEvent(errorSession, {type: INPUT_EVENTS.TAB}, readError.host);
  assert.equal(readError.host.session.getActive().surface.view, 'models');

  configCommandHandler.handleEvent(errorSession, {type: INPUT_EVENTS.ESCAPE}, readError.host);
  assert.equal(readError.calls.sessionCloses, 1);

  const saveError = createFakeHost({
    saveSettings() {
      return {ok: false, error: 'cannot write settings'};
    }
  });
  const session = startCommand(configCommandHandler, '/config', saveError.host);
  for (let index = 0; index < 3; index += 1) {
    configCommandHandler.handleEvent(saveError.host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, saveError.host);
  }
  configCommandHandler.handleEvent(saveError.host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, saveError.host);

  assert.equal(saveError.calls.savedSettingsDrafts.length, 1);
  assert.equal(saveError.host.session.getActive().surface.kind, 'config');
  assert.equal(saveError.host.session.getActive().surface.state.error, 'cannot write settings');
  assert.equal(saveError.calls.sessionCloses, 0);
});

test('configCommandHandler cancels without saving', () => {
  const configCommandHandler = new ConfigCommandHandler();
  const {calls, host} = createFakeHost();
  const session = startCommand(configCommandHandler, '/config', host);

  configCommandHandler.handleEvent(session, {type: INPUT_EVENTS.ESCAPE}, host);

  assert.equal(calls.sessionCloses, 1);
  assert.equal(calls.resets, 2);
  assert.equal(calls.savedConfigDrafts.length, 0);
});

test('configCommandHandler lists provider models and adds a selected model without saving', async () => {
  let resolveListModels;
  const configCommandHandler = new ConfigCommandHandler();
  const {calls, host} = createFakeHost({
    configDraft: {
      providers: [{
        id: 'chat',
        label: 'Chat',
        preset: 'openai-chat-compatible-api',
        apiKey: 'chat-api-key',
        headers: {'x-source': 'hidden-header'},
        models: [{id: 'chat-gpt', model: 'gpt-chat'}]
      }],
      selectedModelId: 'chat-gpt',
      rootConfig: {}
    },
    listConfigModels() {
      return new Promise((resolve) => {
        resolveListModels = resolve;
      });
    }
  });
  let session = startCommand(configCommandHandler, '/config', host);
  session = await openConfigModelsTab(configCommandHandler, session, host);

  await configCommandHandler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, host);
  while (host.session.getActive().surface.rows[host.session.getActive().surface.state.formIndex].kind !== 'listModels') {
    await configCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, host);
  }

  const pending = configCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);

  assert.equal(host.session.getActive().surface.state.mode, 'modelList');
  assert.equal(host.session.getActive().surface.state.modelList.status, 'loading');
  assert.equal(calls.listedConfigProviders.length, 1);
  assert.deepEqual(calls.listedConfigProviders[0].headers, {'x-source': 'hidden-header'});
  assert.equal(calls.savedConfigDrafts.length, 0);

  resolveListModels({ok: true, models: [{id: 'gpt-new'}, {id: 'gpt-chat'}]});
  await pending;

  assert.equal(host.session.getActive().surface.state.modelList.status, 'ready');
  assert.deepEqual(host.session.getActive().surface.state.modelList.models.map((model) => model.id), ['gpt-new', 'gpt-chat']);

  await configCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);

  assert.equal(host.session.getActive().surface.state.mode, 'form');
  assert.deepEqual(host.session.getActive().surface.state.draft.providers[0].models.map((model) => model.model), ['gpt-chat', 'gpt-new']);
  assert.equal(calls.savedConfigDrafts.length, 0);
});

test('configCommandHandler keeps hidden reasoning when saving', async () => {
  const configCommandHandler = new ConfigCommandHandler();
  const {calls, host} = createFakeHost({
    configDraft: {
      providers: [{
        id: 'chat',
        label: 'Chat',
        preset: 'openai-chat-compatible-api',
        apiKey: 'chat-api-key',
        models: [{
          id: 'chat-gpt',
          model: 'gpt-chat',
          reasoning: {effort: 'none', summary: 'auto'}
        }]
      }],
      selectedModelId: 'chat-gpt',
      rootConfig: {}
    }
  });
  let session = startCommand(configCommandHandler, '/config', host);
  session = await openConfigModelsTab(configCommandHandler, session, host);

  configCommandHandler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, host);
  while (host.session.getActive().surface.rows[host.session.getActive().surface.state.formIndex].kind !== 'save') {
    configCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, host);
  }
  configCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);

  assert.deepEqual(calls.savedConfigDrafts[0].providers[0].models[0].reasoning, {effort: 'none', summary: 'auto'});
});

test('configCommandHandler isolates late list models callbacks after user leaves model list', async () => {
  let resolveListModels;
  const configCommandHandler = new ConfigCommandHandler();
  const {host} = createFakeHost({
    listConfigModels() {
      return new Promise((resolve) => {
        resolveListModels = resolve;
      });
    }
  });
  let session = startCommand(configCommandHandler, '/config', host);
  session = await openConfigModelsTab(configCommandHandler, session, host);

  await configCommandHandler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, host);
  while (host.session.getActive().surface.rows[host.session.getActive().surface.state.formIndex].kind !== 'listModels') {
    await configCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, host);
  }

  const pending = configCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  await configCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.ESCAPE}, host);

  assert.equal(host.session.getActive().surface.state.mode, 'form');

  resolveListModels({ok: true, models: [{id: 'late-model'}]});
  await pending;

  assert.equal(host.session.getActive().surface.state.mode, 'form');
  assert.equal(host.session.getActive().surface.state.draft.providers[0].models.some((model) => model.model === 'late-model'), false);
});

test('configCommandHandler shows unsupported and redacted list models errors', async () => {
  const configCommandHandler = new ConfigCommandHandler();
  const unsupported = createFakeHost({
    listConfigModels() {
      return Promise.resolve({ok: false, reason: 'unsupported', error: 'unsupported provider'});
    }
  });
  let unsupportedSession = startCommand(configCommandHandler, '/config', unsupported.host);
  unsupportedSession = await openConfigModelsTab(configCommandHandler, unsupportedSession, unsupported.host);

  await configCommandHandler.handleEvent(unsupportedSession, {type: INPUT_EVENTS.SUBMIT}, unsupported.host);
  while (unsupported.host.session.getActive().surface.rows[unsupported.host.session.getActive().surface.state.formIndex].kind !== 'listModels') {
    await configCommandHandler.handleEvent(unsupported.host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, unsupported.host);
  }
  await configCommandHandler.handleEvent(unsupported.host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, unsupported.host);
  assert.equal(unsupported.host.session.getActive().surface.state.modelList.status, 'unsupported');

  const failing = createFakeHost({
    listConfigModels() {
      return Promise.resolve({ok: false, reason: 'error', error: '无法列出模型：Authorization: <redacted>'});
    }
  });
  let failingSession = startCommand(configCommandHandler, '/config', failing.host);
  failingSession = await openConfigModelsTab(configCommandHandler, failingSession, failing.host);

  await configCommandHandler.handleEvent(failingSession, {type: INPUT_EVENTS.SUBMIT}, failing.host);
  while (failing.host.session.getActive().surface.rows[failing.host.session.getActive().surface.state.formIndex].kind !== 'listModels') {
    await configCommandHandler.handleEvent(failing.host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, failing.host);
  }
  await configCommandHandler.handleEvent(failing.host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, failing.host);
  assert.equal(failing.host.session.getActive().surface.state.modelList.status, 'error');
  assert.doesNotMatch(failing.host.session.getActive().surface.state.modelList.error, /chat-api-key/);
});

test('createSlashCommandDescriptors derives display metadata from handlers', () => {
  const descriptors = createSlashCommandDescriptors(createDefaultHandlersForTest());

  assert.equal(descriptors.some((descriptor) => descriptor.name === 'skill'), false);
  assert.deepEqual(descriptors, [
    { name: 'help', description: '查看帮助' },
    { name: 'config', description: '配置常规设置、模型和主题' },
    { name: 'model', description: '切换模型' },
    { name: 'effort', description: '调整推理等级' },
    { name: 'mode', description: '切换交互模式' },
    { name: 'status', description: '查看运行状态与 Codex 用量' },
    { name: 'context', description: '查看 context 占用详情' },
    { name: 'usage', description: '查看每日 token 用量' },
    { name: 'copy', description: '复制会话消息' },
    { name: 'clear', description: '清空当前会话' },
    { name: 'compact', description: '手动压缩当前会话上下文' },
    { name: 'diff', description: '查看当前文件差异' },
    { name: 'undo', description: '回退上一轮文件修改和会话记录' },
    { name: 'resume', description: '恢复历史会话' },
    { name: 'mcp', description: '查看和管理 MCP servers' },
    { name: 'memory', description: '查看和管理持久 memory' },
    { name: 'hooks', description: '查看、管理和测试 lifecycle hooks' },
    { name: 'skills', description: '查看和管理 skills' },
    { name: 'init', description: '分析项目并生成或评审 AGENTS.md' },
    { name: 'review', description: '审查当前代码变更' }
  ]);
});

test('default slash command handlers accept tab-completed trailing whitespace', () => {
  const handlers = createDefaultHandlersForTest();
  const descriptors = createSlashCommandDescriptors(handlers);

  for (const descriptor of descriptors) {
    assert.equal(resolveSlashCommand(`/${descriptor.name} `, handlers)?.name, descriptor.name);
  }

  assert.equal(resolveSlashCommand('/model more', handlers)?.name, undefined);
});

test('/themes is no longer a local command', () => {
  const handlers = createDefaultHandlersForTest();
  const descriptors = createSlashCommandDescriptors(handlers);
  const handler = resolveSlashCommand('/themes', handlers);

  assert.equal(handlers.some((candidate) => candidate.name === 'themes'), false);
  assert.equal(descriptors.some((descriptor) => descriptor.name === 'themes'), false);
  assert.equal(handler instanceof SkillInvocationCommandHandler, true);
});

test('helpCommandHandler opens and closes help session through host', () => {
  const helpCommandHandler = new HelpCommandHandler();
  const { calls, host } = createFakeHost();

  assert.equal(helpCommandHandler.match('/help more'), false);
  assert.equal(helpCommandHandler.match('help'), false);
  assert.equal(helpCommandHandler.match('/help'), true);

  const session = startCommand(helpCommandHandler, '/help', host);

  assert.equal(calls.resets, 1);
  assert.equal(session.commandName, 'help');
  assert.equal(session.surface.kind, 'info');
  assert.equal(session.surface.title, '/help');
  assert.ok(session.surface.lines.some((line) => line.includes('Enter')));
  assert.ok(session.surface.lines.some((line) => line.includes('Shift+Tab 工具授权')));
  assert.ok(session.surface.lines.some((line) => line.includes('/init')));
  assert.ok(session.surface.lines.some((line) => line.includes('/review')));
  assert.equal(session.surface.dismissHint, 'Esc 关闭帮助');

  helpCommandHandler.handleEvent(session, { type: INPUT_EVENTS.ESCAPE }, host);
  assert.equal(calls.sessionCloses, 1);
  assert.equal(calls.resets, 2);
});

test('modelCommandHandler opens info session for config errors', () => {
  const modelCommandHandler = new ModelCommandHandler();
  const { host } = createFakeHost({ modelCommandInfo: { error: 'LLM 配置缺少 models' } });

  assert.equal(modelCommandHandler.match('/model more'), false);
  assert.equal(modelCommandHandler.match('model'), false);
  assert.equal(modelCommandHandler.match('/model'), true);
  assert.equal(resolveSlashCommand('/model', createDefaultHandlersForTest()).name, 'model');

  const session = startCommand(modelCommandHandler, '/model', host);

  assert.equal(session.commandName, 'model');
  assert.equal(session.surface.kind, 'info');
  assert.equal(session.surface.title, '/model');
  assert.ok(session.surface.lines.some((line) => line.includes('当前未读取到模型配置。')));
  assert.ok(session.surface.lines.some((line) => line.includes('LLM 配置缺少 models')));
  assert.equal(session.surface.dismissHint, 'Esc 关闭');
  assert.equal(session.data, null);
});

test('modelCommandHandler shows selectable models, confirms, cancels, and reports save failure', () => {
  const modelCommandHandler = new ModelCommandHandler();
  const { calls, host } = createFakeHost({
    modelCommandInfo: {
      selectedIndex: 1,
      models: [
        { id: 'fast', model: 'gpt-fast', provider: 'openai' },
        { id: 'deep', model: 'gpt-deep', provider: 'openai' }
      ]
    }
  });
  const session = startCommand(modelCommandHandler, '/model', host);

  assert.equal(session.surface.kind, 'select');
  assert.equal(session.surface.title, '/model 选择模型 (2)');
  assert.equal(session.surface.selectedIndex, 1);
  assert.deepEqual(session.surface.options, [
    { label: 'gpt-fast', description: 'openai' },
    { label: 'gpt-deep', description: 'openai' }
  ]);

  modelCommandHandler.handleEvent(session, { type: INPUT_EVENTS.MOVE_UP }, host);
  assert.equal(calls.sessionUpdates[0].surface.selectedIndex, 0);
  assert.equal(calls.sessionUpdates[0].data.selectedIndex, 0);

  modelCommandHandler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.MOVE_DOWN }, host);
  assert.equal(calls.sessionUpdates[1].surface.selectedIndex, 1);

  modelCommandHandler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.MOVE_DOWN }, host);
  assert.equal(calls.sessionUpdates[2].surface.selectedIndex, 0);

  modelCommandHandler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.MOVE_UP }, host);
  assert.equal(calls.sessionUpdates[3].surface.selectedIndex, 1);

  modelCommandHandler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.MOVE_DOWN }, host);
  assert.equal(calls.sessionUpdates[4].surface.selectedIndex, 0);

  modelCommandHandler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.SUBMIT }, host);
  assert.deepEqual(calls.modelSelections, ['fast']);
  assert.equal(calls.sessionCloses, 1);

  const failing = createFakeHost({
    modelCommandInfo: {
      selectedIndex: 0,
      models: [{ id: 'fast', model: 'gpt-fast', provider: 'openai' }]
    },
    selectModel() {
      return { ok: false, error: 'cannot write <redacted>' };
    }
  });
  const failingSession = startCommand(modelCommandHandler, '/model', failing.host);
  modelCommandHandler.handleEvent(failingSession, { type: INPUT_EVENTS.SUBMIT }, failing.host);
  assert.equal(failing.calls.sessionUpdates[0].surface.kind, 'info');
  assert.ok(failing.calls.sessionUpdates[0].surface.lines.some((line) => line.includes('cannot write')));

  const cancel = createFakeHost({
    modelCommandInfo: {
      selectedIndex: 0,
      models: [{ id: 'fast', model: 'gpt-fast', provider: 'openai' }]
    }
  });
  const cancelSession = startCommand(modelCommandHandler, '/model', cancel.host);
  modelCommandHandler.handleEvent(cancelSession, { type: INPUT_EVENTS.ESCAPE }, cancel.host);
  assert.equal(cancel.calls.sessionCloses, 1);
  assert.equal(cancel.calls.resets, 2);
});

test('modelCommandHandler config error submit is a no-op and escape closes', () => {
  const modelCommandHandler = new ModelCommandHandler();
  const { calls, host } = createFakeHost({
    modelCommandInfo: { error: 'LLM 配置文件不存在：/tmp/echo-config.json' }
  });
  const session = startCommand(modelCommandHandler, '/model', host);

  modelCommandHandler.handleEvent(session, { type: INPUT_EVENTS.SUBMIT }, host);
  assert.equal(calls.sessionCloses, 0);
  assert.equal(calls.sessionUpdates.length, 0);

  modelCommandHandler.handleEvent(session, { type: INPUT_EVENTS.ESCAPE }, host);
  assert.equal(calls.sessionCloses, 1);
});

test('effortCommandHandler opens info session for config errors', () => {
  const effortCommandHandler = new EffortCommandHandler();
  const { host } = createFakeHost({ effortCommandInfo: { error: 'LLM 配置缺少 models' } });

  assert.equal(effortCommandHandler.match('/effort more'), false);
  assert.equal(effortCommandHandler.match('effort'), false);
  assert.equal(effortCommandHandler.match('/effort'), true);
  assert.equal(resolveSlashCommand('/effort', createDefaultHandlersForTest()).name, 'effort');

  const session = startCommand(effortCommandHandler, '/effort', host);

  assert.equal(session.commandName, 'effort');
  assert.equal(session.surface.kind, 'info');
  assert.equal(session.surface.title, '/effort');
  assert.ok(session.surface.lines.some((line) => line.includes('当前未读取到推理等级配置。')));
  assert.ok(session.surface.lines.some((line) => line.includes('LLM 配置缺少 models')));
  assert.equal(session.surface.dismissHint, 'Esc 关闭');
  assert.equal(session.data, null);
});

test('effortCommandHandler shows selectable efforts, confirms, cancels, and reports save failure', () => {
  const effortCommandHandler = new EffortCommandHandler();
  const { calls, host } = createFakeHost({
    effortCommandInfo: {
      currentModelLabel: 'gpt-deep',
      efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      selectedIndex: 3
    }
  });
  const session = startCommand(effortCommandHandler, '/effort', host);

  assert.equal(session.surface.kind, 'scale');
  assert.equal(session.surface.title, '/effort · gpt-deep');
  assert.equal(session.surface.leftLabel, 'fast');
  assert.equal(session.surface.rightLabel, 'deep');
  assert.equal(session.surface.selectedIndex, 3);
  assert.deepEqual(session.surface.options.map((option) => option.label), ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(session.surface.options.map((option) => option.description), ['NONE', 'MIN', 'LOW', 'MED', 'HIGH', 'XHIGH']);

  assert.equal(session.surface.dismissHint, 'Enter 选择 · ←/→ 移动 · Esc 取消');

  effortCommandHandler.handleEvent(session, { type: INPUT_EVENTS.MOVE_RIGHT }, host);
  assert.equal(calls.sessionUpdates[0].surface.selectedIndex, 4);
  assert.equal(calls.sessionUpdates[0].data.selectedIndex, 4);

  effortCommandHandler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.MOVE_LEFT }, host);
  assert.equal(calls.sessionUpdates[1].surface.selectedIndex, 3);
  assert.equal(calls.sessionUpdates[1].data.selectedIndex, 3);

  effortCommandHandler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.MOVE_RIGHT }, host);

  effortCommandHandler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.SUBMIT }, host);
  assert.deepEqual(calls.effortSelections, ['high']);
  assert.equal(calls.sessionCloses, 1);

  const failing = createFakeHost({
    effortCommandInfo: {
      currentModelLabel: 'gpt-fast',
      efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      selectedIndex: 4
    },
    selectEffort() {
      return { ok: false, error: 'cannot write <redacted>' };
    }
  });
  const failingSession = startCommand(effortCommandHandler, '/effort', failing.host);
  effortCommandHandler.handleEvent(failingSession, { type: INPUT_EVENTS.SUBMIT }, failing.host);
  assert.equal(failing.calls.sessionUpdates[0].surface.kind, 'info');
  assert.ok(failing.calls.sessionUpdates[0].surface.lines.some((line) => line.includes('cannot write')));

  const cancel = createFakeHost({
    effortCommandInfo: {
      currentModelLabel: 'gpt-fast',
      efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      selectedIndex: 4
    }
  });
  const cancelSession = startCommand(effortCommandHandler, '/effort', cancel.host);
  effortCommandHandler.handleEvent(cancelSession, { type: INPUT_EVENTS.ESCAPE }, cancel.host);
  assert.equal(cancel.calls.sessionCloses, 1);
  assert.equal(cancel.calls.resets, 2);
});

test('modeCommandHandler switches modes directly, opens selector, and rejects /plan', () => {
  const modeCommandHandler = new ModeCommandHandler();
  const direct = createFakeHost();

  assert.equal(modeCommandHandler.match('/model'), false);
  assert.equal(modeCommandHandler.match('/mode'), true);
  assert.equal(modeCommandHandler.match('/mode shell-local'), true);
  assert.equal(resolveSlashCommand('/mode', createDefaultHandlersForTest()).name, 'mode');
  assert.notEqual(resolveSlashCommand('/plan', createDefaultHandlersForTest()).name, 'plan');

  modeCommandHandler.start('/mode plan', direct.host);
  modeCommandHandler.start('/mode shell', direct.host);
  modeCommandHandler.start('/mode shell-local', direct.host);
  modeCommandHandler.start('/mode normal', direct.host);
  assert.deepEqual(direct.calls.modeSelections, ['plan', 'shell', 'shell-local', 'normal']);
  assert.equal(direct.calls.sessionOpens.length, 0);

  const select = createFakeHost({ interactionMode: 'shell' });
  const selectSession = startCommand(modeCommandHandler, '/mode', select.host);
  assert.equal(selectSession.surface.kind, 'select');
  assert.equal(selectSession.surface.title, '/mode 选择模式');
  assert.equal(selectSession.surface.selectedIndex, 2);
  assert.equal(selectSession.surface.options.length, 4);
  assert.deepEqual(selectSession.surface.options.map((option) => option.label), ['normal', 'plan', 'shell', 'shell-local']);

  modeCommandHandler.handleEvent(selectSession, { type: INPUT_EVENTS.MOVE_DOWN }, select.host);
  assert.equal(select.calls.sessionUpdates[0].surface.selectedIndex, 3);
  modeCommandHandler.handleEvent(select.host.session.getActive(), { type: INPUT_EVENTS.SUBMIT }, select.host);
  assert.deepEqual(select.calls.modeSelections, ['shell-local']);
  assert.equal(select.calls.sessionCloses, 1);
  assert.equal(select.calls.resets, 2);

  const invalid = createFakeHost();
  const invalidSession = startCommand(modeCommandHandler, '/mode maybe', invalid.host);
  assert.equal(invalidSession.surface.kind, 'info');
  assert.equal(invalidSession.surface.title, '/mode');
  assert.ok(invalidSession.surface.lines.some((line) => line.includes('/mode shell-local')));
  assert.deepEqual(invalid.calls.modeSelections, []);

  modeCommandHandler.handleEvent(invalidSession, { type: INPUT_EVENTS.ESCAPE }, invalid.host);
  assert.equal(invalid.calls.sessionCloses, 1);
  assert.equal(invalid.calls.resets, 2);
});

test('contextCommandHandler opens context surface or unavailable info and closes on key', () => {
  const contextCommandHandler = new ContextCommandHandler();
  const usage = {
    usedTokens: 1200,
    contextWindow: 4096,
    source: 'provider',
    segments: [
      {category: 'system', tokens: 300},
      {category: 'messages', tokens: 900}
    ]
  };
  const withUsage = createFakeHost({contextUsage: usage});

  assert.equal(contextCommandHandler.match('/context'), true);
  assert.equal(contextCommandHandler.match('/context now'), false);
  assert.equal(resolveSlashCommand('/context', createDefaultHandlersForTest()).name, 'context');

  const session = startCommand(contextCommandHandler, '/context', withUsage.host);
  assert.equal(withUsage.calls.resets, 1);
  assert.equal(session.commandName, 'context');
  assert.equal(session.surface.kind, 'context');
  assert.equal(session.surface.usage.usedTokens, 1200);
  assert.equal(session.surface.dismissHint, '上下文占用详情 · 按任意键关闭');

  contextCommandHandler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: 'x'}, withUsage.host);
  assert.equal(withUsage.calls.sessionCloses, 1);
  assert.equal(withUsage.calls.resets, 2);

  const withoutUsage = createFakeHost();
  const missingSession = startCommand(contextCommandHandler, '/context', withoutUsage.host);
  assert.equal(missingSession.surface.kind, 'info');
  assert.equal(missingSession.surface.title, '/context');
  assert.ok(missingSession.surface.lines.some((line) => line.includes('/context不使用本地实时估算')));
});

test('skillsCommandHandler opens skills surface, toggles drafts, saves, and cancels', () => {
  const skillsCommandHandler = new SkillsCommandHandler();
  const skills = [
    { name: 'code-review', description: 'Review code', sourceKind: 'project', sourcePath: '/skills/code-review/SKILL.md', enabled: true },
    { name: 'unit-test', description: 'Generate tests', sourceKind: 'user', sourcePath: '/skills/unit-test/SKILL.md', enabled: false, modelProfileId: 'current-profile', reasoningEffortOverride: 'high' }
  ];
  const modelCommandInfo = {
    models: [
      {id: 'fast-profile', model: 'fast-model', provider: 'fast-provider'},
      {id: 'current-profile', model: 'current-model', provider: 'current-provider'}
    ],
    selectedIndex: 1
  };
  const { calls, host } = createFakeHost({ skills, modelCommandInfo });

  assert.equal(skillsCommandHandler.match('/skills'), true);
  assert.equal(skillsCommandHandler.match('/skills list'), false);
  assert.equal(skillsCommandHandler.match('/skills manage'), false);
  assert.equal(resolveSlashCommand('/skills', createDefaultHandlersForTest()).name, 'skills');

  const session = startCommand(skillsCommandHandler, '/skills', host);

  assert.equal(calls.resets, 1);
  assert.equal(session.commandName, 'skills');
  assert.equal(session.surface.kind, 'skills');
  assert.equal(session.surface.title, 'SKILLS');
  assert.equal(session.surface.selectedIndex, 0);
  assert.equal(session.surface.activeField, 'model');
  assert.deepEqual(session.surface.skills.map((skill) => [skill.name, skill.modelProfileId, skill.modelLabel, skill.reasoningEffortOverride]), [
    ['code-review', undefined, '当前模型', undefined],
    ['unit-test', 'current-profile', 'current-profile', 'high']
  ]);
  assert.match(session.surface.dismissHint, /当前字段 模型 · Tab 切换 · ←\/→ 调整/);

  skillsCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_RIGHT}, host);
  assert.equal(host.session.getActive().data.skills[0].modelProfileId, 'fast-profile');
  skillsCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_LEFT}, host);
  assert.equal(host.session.getActive().data.skills[0].modelProfileId, undefined);

  skillsCommandHandler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.MOVE_DOWN }, host);
  assert.equal(host.session.getActive().data.selectedIndex, 1);

  skillsCommandHandler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.TEXT, value: ' ' }, host);
  assert.equal(host.session.getActive().data.skills[1].enabled, true);
  assert.equal(calls.savedSkills.length, 0);
  skillsCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_RIGHT}, host);
  assert.equal(host.session.getActive().data.skills[1].modelProfileId, undefined);
  skillsCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.TAB}, host);
  assert.equal(host.session.getActive().data.activeField, 'effort');
  assert.match(host.session.getActive().surface.dismissHint, /当前字段 effort/);
  skillsCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_RIGHT}, host);
  assert.equal(host.session.getActive().data.skills[1].reasoningEffortOverride, 'xhigh');
  assert.equal(host.session.getActive().data.skills[1].modelProfileId, undefined);
  skillsCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SHIFT_TAB}, host);
  assert.equal(host.session.getActive().data.activeField, 'model');

  skillsCommandHandler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.SUBMIT }, host);
  assert.equal(calls.sessionCloses, 1);
  assert.equal(calls.resets, 2);
  assert.deepEqual(calls.savedSkills[0].map((skill) => [skill.name, skill.enabled]), [
    ['code-review', true],
    ['unit-test', true]
  ]);
  assert.deepEqual(calls.savedSkills[0].map((skill) => skill.modelProfileId), [undefined, undefined]);
  assert.deepEqual(calls.savedSkills[0].map((skill) => skill.reasoningEffortOverride), [undefined, 'xhigh']);
  assert.equal('modelLabel' in calls.savedSkills[0][0], false);

  const cancel = createFakeHost({ skills, modelCommandInfo });
  const cancelSession = startCommand(skillsCommandHandler, '/skills', cancel.host);
  skillsCommandHandler.handleEvent(cancelSession, { type: INPUT_EVENTS.TEXT, value: ' ' }, cancel.host);
  skillsCommandHandler.handleEvent(cancel.host.session.getActive(), {type: INPUT_EVENTS.TAB}, cancel.host);
  skillsCommandHandler.handleEvent(cancel.host.session.getActive(), {type: INPUT_EVENTS.MOVE_RIGHT}, cancel.host);
  skillsCommandHandler.handleEvent(cancel.host.session.getActive(), { type: INPUT_EVENTS.ESCAPE }, cancel.host);
  assert.equal(cancel.calls.sessionCloses, 1);
  assert.equal(cancel.calls.savedSkills.length, 0);
});

test('skillsCommandHandler falls back to dynamic model policy when model config is unavailable', () => {
  const skillsCommandHandler = new SkillsCommandHandler();
  const {calls, host} = createFakeHost({
    skills: [{
      name: 'review',
      description: 'Review code',
      sourceKind: 'project',
      sourcePath: '/skills/review/SKILL.md',
      enabled: false,
      modelProfileId: 'deleted-profile'
    }]
  });
  const session = startCommand(skillsCommandHandler, '/skills', host);

  assert.equal(session.surface.skills[0].modelProfileId, undefined);
  assert.equal(session.surface.skills[0].modelLabel, '当前模型');
  skillsCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_RIGHT}, host);
  assert.equal(calls.sessionUpdates.length, 0);
  skillsCommandHandler.handleEvent(session, {type: INPUT_EVENTS.TAB}, host);
  skillsCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_RIGHT}, host);
  assert.equal(host.session.getActive().data.skills[0].reasoningEffortOverride, 'none');
  skillsCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.TEXT, value: ' '}, host);
  skillsCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  assert.deepEqual(calls.savedSkills[0].map(({enabled, modelProfileId, reasoningEffortOverride}) => ({enabled, modelProfileId, reasoningEffortOverride})), [
    {enabled: true, modelProfileId: undefined, reasoningEffortOverride: 'none'}
  ]);
});

test('skillsCommandHandler opens empty skills surface', () => {
  const skillsCommandHandler = new SkillsCommandHandler();
  const { host } = createFakeHost({ skills: [] });

  const session = startCommand(skillsCommandHandler, '/skills', host);

  assert.equal(session.surface.kind, 'skills');
  assert.deepEqual(session.surface.skills, []);
  assert.ok(session.surface.emptyLines.some((line) => line.includes('当前没有发现可用 skill')));
});

test('mcpCommandHandler opens MCP surface, toggles drafts, saves, and cancels', async () => {
  const mcpCommandHandler = new McpCommandHandler();
  const mcpServers = [
    {kind: 'global', name: 'MCP global', enabled: true, valid: true, summary: 'enabled'},
    {kind: 'server', name: 'docs', enabled: true, valid: true, transport: 'http', summary: 'https://example.invalid/mcp', toolCount: 2},
    {kind: 'server', name: 'bad', enabled: false, valid: false, summary: 'missing command', diagnostic: 'missing command'}
  ];
  const {calls, host} = createFakeHost({mcpServers});

  assert.equal(mcpCommandHandler.match('/mcp'), true);
  assert.equal(mcpCommandHandler.match('/mcp list'), false);
  assert.equal(resolveSlashCommand('/mcp', createDefaultHandlersForTest()).name, 'mcp');

  const session = startCommand(mcpCommandHandler, '/mcp', host);

  assert.equal(calls.resets, 1);
  assert.equal(session.commandName, 'mcp');
  assert.equal(session.surface.kind, 'mcp');
  assert.equal(session.surface.title, 'MCP');
  assert.deepEqual(session.surface.servers, mcpServers);

  mcpCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_DOWN}, host);
  assert.equal(calls.sessionUpdates[0].surface.selectedIndex, 1);

  mcpCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.TEXT, value: ' '}, host);
  assert.equal(host.session.getActive().data.servers[1].enabled, false);
  assert.equal(calls.savedMcpServers.length, 0);

  const savePromise = mcpCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  assert.equal(calls.sessionCloses, 1);
  assert.equal(calls.resets, 2);
  assert.equal(host.session.getActive(), null);
  await savePromise;
  assert.deepEqual(calls.savedMcpServers[0].map((server) => [server.name, server.enabled]), [
    ['MCP global', true],
    ['docs', false],
    ['bad', false]
  ]);

  const diagnostic = createFakeHost({mcpServers, saveMcpResult: {ok: true, diagnostics: ['bad: missing command']}});
  const diagnosticSession = startCommand(mcpCommandHandler, '/mcp', diagnostic.host);
  mcpCommandHandler.handleEvent(diagnosticSession, {type: INPUT_EVENTS.TEXT, value: ' '}, diagnostic.host);
  const diagnosticSavePromise = mcpCommandHandler.handleEvent(diagnostic.host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, diagnostic.host);
  assert.equal(diagnostic.host.session.getActive(), null);
  await diagnosticSavePromise;
  assert.equal(diagnostic.host.session.getActive().surface.kind, 'info');
  assert.ok(diagnostic.host.session.getActive().surface.lines.some((line) => line.includes('bad: missing command')));
  mcpCommandHandler.handleEvent(diagnostic.host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, diagnostic.host);
  assert.equal(diagnostic.host.session.getActive(), null);

  const unchanged = createFakeHost({mcpServers});
  const unchangedSession = startCommand(mcpCommandHandler, '/mcp', unchanged.host);
  mcpCommandHandler.handleEvent(unchangedSession, {type: INPUT_EVENTS.SUBMIT}, unchanged.host);
  assert.equal(unchanged.host.session.getActive(), null);
  assert.equal(unchanged.calls.savedMcpServers.length, 0);

  const cancel = createFakeHost({mcpServers});
  const cancelSession = startCommand(mcpCommandHandler, '/mcp', cancel.host);
  mcpCommandHandler.handleEvent(cancelSession, {type: INPUT_EVENTS.TEXT, value: ' '}, cancel.host);
  mcpCommandHandler.handleEvent(cancel.host.session.getActive(), {type: INPUT_EVENTS.ESCAPE}, cancel.host);
  assert.equal(cancel.calls.sessionCloses, 1);
  assert.equal(cancel.calls.savedMcpServers.length, 0);
});

test('mcpCommandHandler opens empty MCP surface', () => {
  const mcpCommandHandler = new McpCommandHandler();
  const {host} = createFakeHost({mcpServers: []});

  const session = startCommand(mcpCommandHandler, '/mcp', host);

  assert.equal(session.surface.kind, 'mcp');
  assert.deepEqual(session.surface.servers, []);
  assert.ok(session.surface.emptyLines.some((line) => line.includes('当前没有配置 MCP server')));
});

test('hooksCommandHandler opens, edits, saves, and cancels draft state', () => {
  const hooksCommandHandler = new HooksCommandHandler();
  const {calls, host} = createFakeHost();

  assert.equal(hooksCommandHandler.match('/hooks'), true);
  assert.equal(hooksCommandHandler.match('/hooks list'), false);
  assert.equal(resolveSlashCommand('/hooks', createDefaultHandlersForTest()).name, 'hooks');

  let session = startCommand(hooksCommandHandler, '/hooks', host);

  assert.equal(calls.resets, 1);
  assert.equal(session.commandName, 'hooks');
  assert.equal(session.surface.kind, 'hooks');
  assert.equal(session.surface.mode, 'events');
  assert.equal(session.surface.events.length, 11);

  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_DOWN}, host);
  session = host.session.getActive();
  assert.equal(session.surface.selectedEvent, 'assistant_turn_end');
  assert.equal(session.surface.eventIndex, 1);

  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: 'a'}, host);
  session = host.session.getActive();
  assert.equal(session.surface.mode, 'events');
  assert.equal(session.surface.entries.length, 2);

  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, host);
  session = host.session.getActive();
  assert.equal(session.surface.mode, 'entries');
  assert.equal(session.surface.entries.length, 2);

  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: 'b'}, host);
  session = host.session.getActive();
  assert.equal(session.surface.mode, 'entries');

  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: ' '}, host);
  session = host.session.getActive();
  assert.equal(session.data.draft.events[1].entries[0].enabled, false);
  assert.equal(calls.savedHookDrafts.length, 0);

  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: 'a'}, host);
  session = host.session.getActive();
  assert.equal(session.surface.mode, 'entries');
  assert.equal(session.surface.entries.length, 2);
  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_DOWN}, host);
  hooksCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, host);
  hooksCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  session = host.session.getActive();
  assert.equal(session.surface.mode, 'entryDetail');
  assert.equal(session.surface.editTarget, 'command');
  assert.equal(session.surface.entryIndex, 2);

  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: 'echo aded'}, host);
  session = host.session.getActive();
  assert.equal(session.surface.editCursor, 9);
  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_LEFT}, host);
  hooksCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_LEFT}, host);
  session = host.session.getActive();
  assert.equal(session.surface.editCursor, 7);
  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: 'd'}, host);
  session = host.session.getActive();
  assert.equal(session.surface.editBuffer, 'echo added');
  assert.equal(session.surface.editCursor, 8);
  hooksCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  session = host.session.getActive();
  assert.equal(session.surface.mode, 'entryDetail');
  assert.equal(session.surface.editTarget, undefined);
  assert.equal(session.data.draft.events[1].entries[2].command, 'echo added');

  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_DOWN}, host);
  hooksCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  hooksCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.DELETE_TO_LINE_START}, host);
  hooksCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.TEXT, value: '1500'}, host);
  hooksCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  session = host.session.getActive();
  assert.equal(session.data.draft.events[1].entries[2].timeoutMs, 1500);

  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: 'b'}, host);
  session = host.session.getActive();
  assert.equal(session.surface.mode, 'entryDetail');

  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: 'd'}, host);
  session = host.session.getActive();
  assert.equal(session.data.draft.events[1].entries.some((entry) => entry.command === 'echo added'), false);

  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: 's'}, host);
  assert.equal(calls.savedHookDrafts.length, 0);
  assert.equal(calls.sessionCloses, 0);
  assert.equal(host.session.getActive().surface.kind, 'hooks');

  hooksCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, host);
  hooksCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, host);
  hooksCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  assert.equal(calls.sessionCloses, 1);
  assert.equal(calls.resets, 2);
  assert.equal(calls.savedHookDrafts.length, 1);
  assert.equal(calls.savedHookDrafts[0].events[1].entries[0].enabled, false);

  const detailSave = createFakeHost();
  let detailSession = startCommand(hooksCommandHandler, '/hooks', detailSave.host);
  hooksCommandHandler.handleEvent(detailSession, {type: INPUT_EVENTS.MOVE_DOWN}, detailSave.host);
  hooksCommandHandler.handleEvent(detailSave.host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, detailSave.host);
  hooksCommandHandler.handleEvent(detailSave.host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, detailSave.host);
  for (let step = 0; step < 5; step += 1) {
    hooksCommandHandler.handleEvent(detailSave.host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, detailSave.host);
  }
  detailSession = detailSave.host.session.getActive();
  assert.equal(detailSession.surface.detailIndex, 5);
  hooksCommandHandler.handleEvent(detailSession, {type: INPUT_EVENTS.SUBMIT}, detailSave.host);
  assert.equal(detailSave.calls.savedHookDrafts.length, 1);
  assert.equal(detailSave.calls.sessionCloses, 1);

  const cancel = createFakeHost();
  const cancelSession = startCommand(hooksCommandHandler, '/hooks', cancel.host);
  hooksCommandHandler.handleEvent(cancelSession, {type: INPUT_EVENTS.MOVE_DOWN}, cancel.host);
  hooksCommandHandler.handleEvent(cancel.host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, cancel.host);
  hooksCommandHandler.handleEvent(cancel.host.session.getActive(), {type: INPUT_EVENTS.TEXT, value: ' '}, cancel.host);
  hooksCommandHandler.handleEvent(cancel.host.session.getActive(), {type: INPUT_EVENTS.ESCAPE}, cancel.host);
  assert.equal(cancel.calls.sessionCloses, 1);
  assert.equal(cancel.calls.savedHookDrafts.length, 0);
});

test('hooksCommandHandler edits command text at the movable cursor', () => {
  const hooksCommandHandler = new HooksCommandHandler();
  const {host} = createFakeHost();
  let session = startCommand(hooksCommandHandler, '/hooks', host);

  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_DOWN}, host);
  hooksCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  hooksCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  hooksCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, host);
  session = host.session.getActive();
  assert.equal(session.surface.editBuffer, 'echo done');
  assert.equal(session.surface.editCursor, 9);

  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_HOME}, host);
  hooksCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_RIGHT}, host);
  hooksCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.DELETE_FORWARD}, host);
  hooksCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.TEXT, value: 'A'}, host);
  session = host.session.getActive();
  assert.equal(session.surface.editBuffer, 'eAho done');
  assert.equal(session.surface.editCursor, 2);

  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.BACKSPACE}, host);
  hooksCommandHandler.handleEvent(host.session.getActive(), {type: INPUT_EVENTS.MOVE_END}, host);
  session = host.session.getActive();
  assert.equal(session.surface.editBuffer, 'eho done');
  assert.equal(session.surface.editCursor, 8);
});

test('hooksCommandHandler blocks invalid save, reports save failure, and runs synthetic tests through host', async () => {
  const hooksCommandHandler = new HooksCommandHandler();
  const saveFailure = createFakeHost({saveHooks: () => ({ok: false, error: 'disk full'})});
  let session = startCommand(hooksCommandHandler, '/hooks', saveFailure.host);

  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_DOWN}, saveFailure.host);
  hooksCommandHandler.handleEvent(saveFailure.host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, saveFailure.host);
  hooksCommandHandler.handleEvent(saveFailure.host.session.getActive(), {type: INPUT_EVENTS.TEXT, value: 'a'}, saveFailure.host);
  assert.equal(saveFailure.host.session.getActive().surface.mode, 'entries');
  assert.equal(saveFailure.host.session.getActive().surface.entries.length, 2);
  hooksCommandHandler.handleEvent(saveFailure.host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, saveFailure.host);
  hooksCommandHandler.handleEvent(saveFailure.host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, saveFailure.host);
  hooksCommandHandler.handleEvent(saveFailure.host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, saveFailure.host);
  hooksCommandHandler.handleEvent(saveFailure.host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, saveFailure.host);
  session = saveFailure.host.session.getActive();
  assert.match(session.surface.error, /command 不能为空/);

  hooksCommandHandler.handleEvent(saveFailure.host.session.getActive(), {type: INPUT_EVENTS.TEXT, value: 'echo valid'}, saveFailure.host);
  hooksCommandHandler.handleEvent(saveFailure.host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, saveFailure.host);
  hooksCommandHandler.handleEvent(saveFailure.host.session.getActive(), {type: INPUT_EVENTS.TEXT, value: 's'}, saveFailure.host);
  assert.equal(saveFailure.calls.savedHookDrafts.length, 0);
  for (let step = 0; step < 5; step += 1) {
    hooksCommandHandler.handleEvent(saveFailure.host.session.getActive(), {type: INPUT_EVENTS.MOVE_DOWN}, saveFailure.host);
  }
  hooksCommandHandler.handleEvent(saveFailure.host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, saveFailure.host);
  session = saveFailure.host.session.getActive();
  assert.equal(session.surface.kind, 'hooks');
  assert.match(session.surface.error, /disk full/);
  assert.equal(saveFailure.calls.sessionCloses, 0);

  const testHost = createFakeHost({hookTestResult: {
    ok: false,
    exitCode: 2,
    durationMs: 44,
    stdout: 'debug output',
    stdoutTruncated: false,
    stderr: 'bad',
    stderrTruncated: false
  }});
  session = startCommand(hooksCommandHandler, '/hooks', testHost.host);
  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.MOVE_DOWN}, testHost.host);
  hooksCommandHandler.handleEvent(testHost.host.session.getActive(), {type: INPUT_EVENTS.SUBMIT}, testHost.host);
  const testPromise = hooksCommandHandler.handleEvent(testHost.host.session.getActive(), {type: INPUT_EVENTS.TEXT, value: 't'}, testHost.host);
  assert.equal(testHost.host.session.getActive().surface.test.status, 'running');
  await testPromise;
  session = testHost.host.session.getActive();

  assert.deepEqual(testHost.calls.hookTests, [{
    event: 'assistant_turn_end',
    entry: {command: 'echo done', enabled: true, timeoutMs: 1000}
  }]);
  assert.equal(session.surface.test.status, 'completed');
  assert.equal(session.surface.test.result.exitCode, 2);
  assert.equal(testHost.calls.transcriptAppends.length, 0);
  assert.deepEqual(testHost.calls.assistantCalls, []);

  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, testHost.host);
  session = testHost.host.session.getActive();
  assert.equal(session.surface.mode, 'entryDetail');
  assert.equal(session.surface.test, undefined);

  await hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: 't'}, testHost.host);
  session = testHost.host.session.getActive();
  assert.equal(session.surface.mode, 'entryDetail');
  assert.equal(session.surface.test.status, 'completed');

  hooksCommandHandler.handleEvent(session, {type: INPUT_EVENTS.ESCAPE}, testHost.host);
  session = testHost.host.session.getActive();
  assert.equal(session.surface.mode, 'entries');
  assert.equal(session.surface.test, undefined);
});

test('clearCommandHandler opens confirm session, confirms, and cancels through host', () => {
  const clearCommandHandler = new ClearCommandHandler();
  const { calls, host } = createFakeHost();

  assert.equal(clearCommandHandler.match('/clear more'), false);
  assert.equal(clearCommandHandler.match('clear'), false);
  assert.equal(clearCommandHandler.match('/clear'), true);
  assert.equal(resolveSlashCommand('/clear', createDefaultHandlersForTest()).name, 'clear');

  const session = startCommand(clearCommandHandler, '/clear', host);
  assert.equal(session.commandName, 'clear');
  assert.equal(session.surface.kind, 'confirm');
  assert.equal(session.surface.title, '/clear 清空会话');
  assert.equal(session.surface.confirmLabel, '清空');

  clearCommandHandler.handleEvent(session, { type: INPUT_EVENTS.SUBMIT }, host);
  assert.equal(calls.sessionCloses, 1);
  assert.equal(calls.resets, 2);
  assert.equal(calls.clears, 1);

  const cancel = createFakeHost();
  const cancelSession = startCommand(clearCommandHandler, '/clear', cancel.host);
  clearCommandHandler.handleEvent(cancelSession, { type: INPUT_EVENTS.ESCAPE }, cancel.host);
  assert.equal(cancel.calls.sessionCloses, 1);
  assert.equal(cancel.calls.clears, 0);
});

test('resumeCommandHandler opens empty state, selectable sessions, moves, confirms, and cancels', () => {
  const resumeCommandHandler = new ResumeCommandHandler();
  const empty = createFakeHost({ sessions: [] });

  assert.equal(resumeCommandHandler.match('/resume more'), false);
  assert.equal(resumeCommandHandler.match('resume'), false);
  assert.equal(resumeCommandHandler.match('/resume'), true);
  assert.equal(resolveSlashCommand('/resume', createDefaultHandlersForTest()).name, 'resume');

  const emptySession = startCommand(resumeCommandHandler, '/resume', empty.host);
  assert.equal(emptySession.surface.kind, 'info');
  assert.ok(emptySession.surface.lines.some((line) => line.includes('没有可恢复会话')));
  assert.equal(emptySession.data.pageSize, RESUME_PAGE_SIZE);

  const sessions = createResumeSessions(7);
  const selectable = createFakeHost({ sessions });
  const session = startCommand(resumeCommandHandler, '/resume', selectable.host);
  assert.equal(session.surface.kind, 'resume');
  assert.equal(session.surface.sessions.length, 5);
  assert.equal(session.surface.focus, 'list');
  assert.equal(session.surface.previewScroll, 0);
  assert.equal(session.data.selectedIndex, 0);
  assert.match(session.surface.title, /\(7\)$/);
  assert.deepEqual(session.surface.previewRecords, [{ role: 'assistant', text: 'message 7' }]);

  let activeSession = session;
  for (let step = 0; step < 5; step += 1) {
    resumeCommandHandler.handleEvent(activeSession, { type: INPUT_EVENTS.MOVE_DOWN }, selectable.host);
    activeSession = selectable.host.session.getActive();
  }

  assert.equal(activeSession.data.selectedIndex, 5);
  assert.equal(activeSession.data.windowStart, 1);
  assert.equal(activeSession.data.previewScroll, 0);
  assert.equal(activeSession.surface.selectedIndex, 4);
  assert.deepEqual(activeSession.surface.previewRecords, [{ role: 'assistant', text: 'message 2' }]);

  resumeCommandHandler.handleEvent(activeSession, { type: INPUT_EVENTS.SUBMIT }, selectable.host);
  assert.deepEqual(selectable.calls.loadedSessionIds, ['session-2']);
  assert.equal(selectable.calls.sessionCloses, 1);

  const cancel = createFakeHost({ sessions: createResumeSessions(1) });
  const cancelSession = startCommand(resumeCommandHandler, '/resume', cancel.host);
  resumeCommandHandler.handleEvent(cancelSession, { type: INPUT_EVENTS.ESCAPE }, cancel.host);
  assert.equal(cancel.calls.sessionCloses, 1);
});

test('resumeCommandHandler switches focus and scrolls preview without moving session', () => {
  const resumeCommandHandler = new ResumeCommandHandler();
  const sessions = createResumeSessions(3);
  sessions[0].previewRecords = Array.from({length: 12}, (_value, index) => ({
    role: 'assistant',
    text: `preview ${index}`
  }));
  const selectable = createFakeHost({ sessions });
  let session = startCommand(resumeCommandHandler, '/resume', selectable.host);

  resumeCommandHandler.handleEvent(session, { type: INPUT_EVENTS.MOVE_RIGHT }, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.data.focus, 'preview');
  assert.equal(session.surface.focus, 'preview');
  assert.equal(session.data.selectedIndex, 0);

  resumeCommandHandler.handleEvent(session, { type: INPUT_EVENTS.MOVE_DOWN }, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.data.previewScroll, 1);
  assert.equal(session.data.selectedIndex, 0);
  assert.equal(session.data.windowStart, 0);

  resumeCommandHandler.handleEvent(session, { type: INPUT_EVENTS.MOVE_UP }, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.data.previewScroll, 0);
  assert.equal(session.data.selectedIndex, 0);

  resumeCommandHandler.handleEvent(session, { type: INPUT_EVENTS.TAB }, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.data.focus, 'preview');
  for (let step = 0; step < 20; step += 1) {
    resumeCommandHandler.handleEvent(session, { type: INPUT_EVENTS.MOVE_DOWN }, selectable.host);
    session = selectable.host.session.getActive();
  }
  assert.equal(session.data.previewScroll, 4);

  resumeCommandHandler.handleEvent(session, { type: INPUT_EVENTS.MOVE_UP }, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.data.previewScroll, 3);

  resumeCommandHandler.handleEvent(session, { type: INPUT_EVENTS.MOVE_LEFT }, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.data.focus, 'list');

  resumeCommandHandler.handleEvent(session, { type: INPUT_EVENTS.MOVE_DOWN }, selectable.host);
  session = selectable.host.session.getActive();
  assert.equal(session.data.selectedIndex, 1);
  assert.equal(session.data.previewScroll, 0);
});

test('compactCommandHandler opens confirm session, runs manual compaction through host, and cancels', async () => {
  const compactCommandHandler = new CompactCommandHandler();
  const { calls, host } = createFakeHost({
    compactionResult: {
      didCompact: true,
      reason: 'compacted',
      compaction: {
        summaryText: '摘要',
        activeStartIndex: 2,
        createdAt: '2026-06-06T00:00:00.000Z'
      }
    }
  });

  assert.equal(compactCommandHandler.match('/compact more'), false);
  assert.equal(compactCommandHandler.match('compact'), false);
  assert.equal(compactCommandHandler.match('/compact'), true);
  assert.equal(resolveSlashCommand('/compact', createDefaultHandlersForTest()).name, 'compact');

  const session = startCommand(compactCommandHandler, '/compact', host);
  assert.equal(session.commandName, 'compact');
  assert.equal(session.surface.kind, 'confirm');
  assert.equal(session.surface.title, '/compact 压缩上下文');

  compactCommandHandler.handleEvent(session, { type: INPUT_EVENTS.SUBMIT }, host);
  await Promise.resolve();
  assert.equal(calls.sessionCloses, 1);
  assert.equal(calls.resets, 2);
  assert.deepEqual(calls.assistantCalls, [
    'beginManualCompaction',
    'compactContext',
    'finishManualCompaction:compacted'
  ]);

  const cancel = createFakeHost();
  const cancelSession = startCommand(compactCommandHandler, '/compact', cancel.host);
  compactCommandHandler.handleEvent(cancelSession, { type: INPUT_EVENTS.ESCAPE }, cancel.host);
  assert.equal(cancel.calls.sessionCloses, 1);
  assert.deepEqual(cancel.calls.assistantCalls, []);
});

test('model config path hint remains stable', () => {
  assert.equal(MODEL_CONFIG_PATH_HINT, '~/.echo/config.json');
});

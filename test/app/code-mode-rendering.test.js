const assert = require('node:assert/strict');
const {test} = require('node:test');

const {runAssistantTurn} = require('../../src/app/assistant-turn-runner');
const {DEFAULT_RENDER_PREFERENCES} = require('../../src/config/app-settings-config');
const {createTuiTheme} = require('../../src/config/theme-config');
const {createComposer} = require('../../src/input/composer');
const {createAppRenderer} = require('../../src/render/app-renderer');
const footerModule = require('../../src/render/footer');
const {
  createCodeExecutionAppendState,
  projectCodeExecutionPending
} = require('../../src/render/code-mode-renderer');
const {renderTranscriptLines} = require('../../src/render/transcript-renderer');
const {stripAnsi} = require('../../src/render/layout');
const ansi = require('../../src/terminal/ansi');
const {
  createFakeTranscriptStore,
  createHarness,
  createUserConfigSnapshot
} = require('./assistant-turn-test-helpers');

const THEME = createTuiTheme();
const CALL = {
  callId: 'outer-code',
  toolName: 'run_code',
  argumentsText: '{"code":"SOURCE-MUST-NOT-EXPAND-OR-EXECUTE"}'
};

function executionRecords() {
  const base = {
    role: 'code_execution',
    toolCallId: CALL.callId,
    executionId: 'execution-one',
    text: ''
  };
  return [
    {...base, sequence: 1, event: 'start'},
    {
      ...base,
      sequence: 2,
      event: 'call_start',
      childCallId: 'execution-one:1',
      toolName: 'glob',
      text: 'PRIVATE-INTERMEDIATE-BODY'
    },
    {
      ...base,
      sequence: 3,
      event: 'call_start',
      childCallId: 'execution-one:2',
      toolName: 'read_files'
    },
    {
      ...base,
      sequence: 4,
      event: 'call_end',
      childCallId: 'execution-one:2',
      toolName: 'read_files',
      status: 'succeeded',
      durationMs: 3
    },
    {
      ...base,
      sequence: 5,
      event: 'call_end',
      childCallId: 'execution-one:1',
      toolName: 'glob',
      status: 'succeeded',
      durationMs: 5
    },
    {
      ...base,
      sequence: 6,
      event: 'end',
      status: 'succeeded',
      durationMs: 12,
      text: 'Run code completed; attempted 2; completed 2; failed 0'
    }
  ];
}

function resultValue() {
  return {
    status: 'succeeded',
    result: {content: 'ACTUAL-RESULT'},
    logs: ['ACTUAL-LOG'],
    logs_truncated: false,
    summary: {attempted: 2, completed: 2, failed: 0, cancelled: 0, duration_ms: 12},
    error: null
  };
}

function outerPair() {
  return [
    {
      role: 'tool_call',
      toolCallId: CALL.callId,
      toolName: CALL.toolName,
      argumentsText: CALL.argumentsText,
      text: ''
    },
    {
      role: 'tool_result',
      toolCallId: CALL.callId,
      toolName: CALL.toolName,
      ok: true,
      details: {kind: 'generic'},
      text: JSON.stringify(resultValue())
    }
  ];
}

function createRendererHarness(t) {
  const appends = [];
  const originalCreateFooter = footerModule.createFooterRenderer;
  // 在公开 footer 边界记录稳定正文；真实 footer 仍负责 ANSI 重绘，不能累计原始 writes 冒充历史。
  t.mock.method(footerModule, 'createFooterRenderer', (...args) => {
    const footer = originalCreateFooter(...args);
    const append = footer.append.bind(footer);
    t.mock.method(footer, 'append', (content, options) => {
      appends.push({content, pending: structuredClone(options.pending), options});
      return append(content, options);
    });
    return footer;
  });
  const output = {
    writes: [],
    write(chunk) {
      this.writes.push(String(chunk));
    }
  };
  const renderer = createAppRenderer(output);
  const state = {
    composer: createComposer('draft'),
    commandSurface: null,
    pending: {kind: 'tool_call', ...CALL},
    working: null,
    theme: THEME,
    renderPreferences: DEFAULT_RENDER_PREFERENCES,
    width: 160,
    rows: 40,
    streamingOwner: 'main',
    mainTranscript: {baseRecordIndex: 0, compaction: null},
    statusLine: {projectName: 'project', model: {kind: 'default', label: 'fake'}, mode: 'tool'}
  };
  const bannerContext = {
    cwd: '/tmp/project',
    nodeVersion: 'v20',
    terminalSize: {columns: 160, rows: 40},
    mode: 'current terminal'
  };
  return {appends, output, renderer, state, bannerContext};
}

function assertCompleteBlock(content) {
  const text = stripAnsi(content);
  assert.equal((text.match(/◆ ▌ Run code #1 · succeeded/gu) || []).length, 1);
  assert.equal((text.match(/completed 2\/2/gu) || []).length, 1);
  assert.equal((text.match(/#1 glob · succeeded/gu) || []).length, 1);
  assert.equal((text.match(/#2 read_files · succeeded/gu) || []).length, 1);
  assert.ok(text.indexOf('#1 glob') < text.indexOf('#2 read_files'));
  assert.match(text, /Result:\n/u);
  assert.match(text, /Logs:\n/u);
  assert.match(text, /ACTUAL-RESULT/u);
  assert.match(text, /ACTUAL-LOG/u);
  assert.doesNotMatch(
    text,
    /running|finishing|Run code completed|attempted 2|PRIVATE-INTERMEDIATE|SOURCE-MUST/u
  );
  assert.ok(content.endsWith('\n\n'));
  assert.ok(!content.endsWith('\n\n\n'));
}

function expectedProgress(index) {
  const summaries = [
    '',
    'completed 0/1 · failed 0 · cancelled 0 · pending 1',
    'completed 0/2 · failed 0 · cancelled 0 · pending 2',
    'completed 1/2 · failed 0 · cancelled 0 · pending 1',
    'completed 2/2 · failed 0 · cancelled 0',
    'completed 2/2 · failed 0 · cancelled 0'
  ];
  return {ordinal: 1, status: index === 5 ? 'finishing' : 'running', summary: summaries[index]};
}

test('each audit callback only redraws pending progress and outer completion appends one full block before assistant output', (t) => {
  const {renderer, state, bannerContext, appends, output} = createRendererHarness(t);
  const audits = executionRecords();
  const resident = [];
  for (const [index, record] of audits.entries()) {
    resident.push(record);
    renderer.renderRecords({...state, records: [record]});
    assert.equal(appends.at(-1).content, '');
    assert.deepEqual(appends.at(-1).pending.codeExecution, expectedProgress(index));
    if ([0, 3, 5].includes(index)) {
      state.width = 160 - index * 5;
      renderer.renderDestructive({...state, records: resident, bannerContext});
      const frame = output.writes.at(-1);
      const text = stripAnsi(frame);
      assert.equal((text.match(/Run code #1/gu) || []).length, 1);
      assert.match(text, new RegExp(`Run code #1 · ${expectedProgress(index).status}`, 'u'));
      if (index === 0) {
        assert.doesNotMatch(text, /completed|0\/0/u);
      } else {
        assert.ok(text.includes(expectedProgress(index).summary));
      }
      assert.doesNotMatch(text, /#1 glob|#2 read_files|interrupted|Result:|Run code completed/u);
      assert.ok(frame.includes(ansi.clearVisibleScreen()));
      assert.ok(frame.includes(ansi.clearScrollback()));
      assert.doesNotMatch(frame, /\x1b\[\?1049[hl]/u);
    }
  }
  const pair = outerPair();
  renderer.renderRecords({...state, pending: null, records: pair});
  assertCompleteBlock(appends.at(-1).content);
  assert.equal(appends.at(-1).pending, null);
  for (const records of [[audits.at(-1)], pair, [...audits, ...pair]]) {
    renderer.renderRecords({...state, pending: null, records});
    assert.equal(appends.at(-1).content, '');
  }
  const terminalAppends = appends.filter(({content}) => content.includes('Run code'));
  assert.equal(terminalAppends.length, 1);
  const boundary = appends.length;
  renderer.render({...state, pending: {kind: 'streaming', text: 'next assistant'}});
  renderer.render({...state, pending: null}, {role: 'assistant', text: 'next assistant'});
  const assistant = stripAnsi(
    appends
      .slice(boundary)
      .map(({content}) => content)
      .join('')
  );
  assert.match(assistant, /next assistant/u);
  assert.doesNotMatch(assistant, /Run code|completed 2\/2|Result:|Logs:/u);
  renderer.renderDestructive({
    ...state,
    pending: null,
    records: [...resident, ...pair, {role: 'assistant', text: 'next assistant'}],
    bannerContext
  });
  const snapshot = stripAnsi(output.writes.at(-1));
  assert.equal((snapshot.match(/◆ ▌ Run code #1 · succeeded/gu) || []).length, 1);
  assert.match(snapshot, /  ▌ \]\n\n◆ next assistant/u);
});

test('destructive rendering rebuilds progress before footer layout instead of reusing a stale previous snapshot', (t) => {
  const {renderer, state, bannerContext, output, appends} = createRendererHarness(t);
  const audits = executionRecords();
  renderer.renderRecords({...state, records: audits.slice(0, 3)});
  assert.deepEqual(appends.at(-1).pending.codeExecution, expectedProgress(2));
  for (const [lastIndex, width] of [
    [3, 150],
    [5, 140],
    [1, 130]
  ]) {
    const records = audits.slice(0, lastIndex + 1);
    renderer.renderDestructive({...state, width, records, bannerContext});
    const frame = stripAnsi(output.writes.at(-1));
    const progress = expectedProgress(lastIndex);
    assert.ok(frame.includes(`Run code #1 · ${progress.status}`));
    assert.ok(frame.includes(progress.summary));
    assert.doesNotMatch(frame, /#1 glob|#2 read_files|interrupted|Result:/u);
    renderer.render({...state, width});
    assert.deepEqual(appends.at(-1).pending.codeExecution, progress);
    assert.equal(appends.at(-1).content, '');
  }
});

test('real assistant turn persists complete one-based audit facts while AppRenderer keeps their progress out of stable history', async (t) => {
  const rendererHarness = createRendererHarness(t);
  const {renderer, appends} = rendererHarness;
  const store = createFakeTranscriptStore();
  const config = createUserConfigSnapshot();
  const harness = createHarness({
    transcriptStore: store,
    userConfigContext: {capture: () => config}
  });
  const {appContext} = harness;
  const audits = executionRecords();
  const batches = [];
  function renderState() {
    return {
      ...appContext.createRenderState(),
      width: 160,
      rows: 40,
      streamingOwner: 'main',
      mainTranscript: {baseRecordIndex: 0, compaction: null}
    };
  }
  await runAssistantTurn({
    ...harness.input,
    renderRecords(records) {
      batches.push(structuredClone(records));
      renderer.renderRecords({...renderState(), records});
    },
    render(finalizeRecord) {
      renderer.render(renderState(), finalizeRecord);
    },
    async runAgent(_session, callbacks) {
      callbacks.onToolCall(CALL);
      assert.equal(appContext.turnContext.getPending().callId, CALL.callId);
      for (const [index, record] of audits.entries()) {
        callbacks.onCodeExecutionRecords([record]);
        assert.equal(appends.at(-1).content, '');
        assert.deepEqual(appends.at(-1).pending.codeExecution, expectedProgress(index));
        const projectionState = createCodeExecutionAppendState();
        const lines = renderTranscriptLines(
          appContext.transcriptContext.getCompleteRecords(),
          160,
          THEME,
          DEFAULT_RENDER_PREFERENCES,
          true,
          undefined,
          {state: projectionState, snapshot: true, activeToolCallIds: [CALL.callId]}
        );
        assert.doesNotMatch(
          lines.map(stripAnsi).join('\n'),
          /Run code|completed|PRIVATE-INTERMEDIATE/u
        );
        const projected = projectCodeExecutionPending(
          appContext.turnContext.getPending(),
          projectionState
        );
        assert.deepEqual(projected.codeExecution, expectedProgress(index));
      }
      callbacks.onToolResult({
        callId: CALL.callId,
        toolName: CALL.toolName,
        ok: true,
        text: JSON.stringify(resultValue()),
        details: {kind: 'generic'}
      });
      assertCompleteBlock(appends.at(-1).content);
      assert.equal(appContext.turnContext.getPending(), null);
      callbacks.onComplete('assistant done');
    }
  });
  const persisted = store.loadSession().session.records;
  assert.deepEqual(persisted, appContext.transcriptContext.getCompleteRecords());
  assert.deepEqual(
    persisted.filter((record) => record.role === 'code_execution'),
    audits
  );
  assert.deepEqual(
    batches.filter((batch) => batch[0]?.role === 'code_execution'),
    audits.map((record) => [record])
  );
  assert.deepEqual(
    persisted
      .filter((record) => ['tool_call', 'tool_result'].includes(record.role))
      .map((record) => record.role),
    ['tool_call', 'tool_result']
  );
  const result = persisted.find((record) => record.role === 'tool_result');
  assert.equal(result.text, JSON.stringify(resultValue()));
  const stable = stripAnsi(appends.map(({content}) => content).join(''));
  assert.equal((stable.match(/◆ ▌ Run code/gu) || []).length, 1);
  assert.equal((stable.match(/completed 2\/2/gu) || []).length, 1);
  assert.doesNotMatch(
    stable,
    /Run code #1 · running|finishing|Run code completed|PRIVATE-INTERMEDIATE|SOURCE-MUST/u
  );
  assert.match(stable, /  ▌ \]\n\n◆ assistant done/u);
  assert.equal(appContext.turnContext.responding, false);
  assert.equal(appends.at(-1).pending, null);
});

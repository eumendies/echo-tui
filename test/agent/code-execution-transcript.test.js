const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  convertTranscriptToAnthropicMessages
} = require('../../src/agent/anthropic/transcript-converter');
const {
  convertTranscriptToOpenAiChatMessages
} = require('../../src/agent/openai-chat/transcript-converter');
const {
  convertTranscriptToOpenAiInput
} = require('../../src/agent/openai-responses/transcript-converter');
const {
  shouldIncludeRecordInProviderContext
} = require('../../src/agent/transcript-converter-common');
const {
  computeCompactionBoundary,
  estimateRecordsTokens,
  generateCompactionSummary
} = require('../../src/agent/context/context-compaction');
const {estimateContextUsageSegments} = require('../../src/agent/context/context-usage-breakdown');
const {
  renderConversationReferenceSegments
} = require('../../src/agent/context/conversation-reference');
const {TranscriptContext} = require('../../src/app/state/transcript-context');
const {createTranscriptStore} = require('../../src/persistence/transcript-store');
const {
  createAppendRecordsOperation,
  createTruncateRecordsOperation,
  createTranscriptJournalStart,
  createTranscriptJournalEntry,
  replayTranscriptJournal,
  serializeTranscriptJournalLine
} = require('../../src/persistence/transcript-journal');
const {
  renderTranscriptBlocks,
  renderTranscriptLines
} = require('../../src/render/transcript-renderer');
const {
  createCodeExecutionAppendState,
  projectCodeExecutionPending
} = require('../../src/render/code-mode-renderer');
const {renderPendingAssistantLines} = require('../../src/render/blocks/pending-preview-renderer');
const {createTuiTheme} = require('../../src/config/theme-config');
const {displayWidth, safeRenderWidth, stripAnsi} = require('../../src/render/layout');

function audit(overrides = {}) {
  return {
    role: 'code_execution',
    text: 'LOCAL-AUDIT-ONLY',
    toolCallId: 'outer-code',
    executionId: 'execution-1',
    sequence: 0,
    event: 'start',
    ...overrides
  };
}

function executionRecords() {
  return [
    audit(),
    audit({
      sequence: 1,
      event: 'call_start',
      childCallId: 'child-1',
      toolName: 'read_files',
      text: '2 files'
    }),
    audit({
      sequence: 2,
      event: 'call_end',
      childCallId: 'child-1',
      toolName: 'read_files',
      status: 'succeeded',
      durationMs: 4
    }),
    audit({
      sequence: 3,
      event: 'end',
      status: 'succeeded',
      durationMs: 8,
      text: 'completed 1; failed 0'
    })
  ];
}

function journal(records) {
  return (
    [
      createTranscriptJournalStart('session-1', '/tmp/project', '2026-07-01T00:00:00.000Z'),
      createTranscriptJournalEntry(
        createAppendRecordsOperation(records),
        1,
        '2026-07-01T00:00:01.000Z'
      )
    ]
      .map(serializeTranscriptJournalLine)
      .join('\n') + '\n'
  );
}

test('code execution audits never alter any provider projection or outer tool pairing', () => {
  const visible = [
    {
      role: 'user',
      text: 'count files'
    },
    {
      role: 'tool_call',
      toolCallId: 'outer-code',
      toolName: 'run_code',
      argumentsText: '{"code":"return 2"}',
      text: ''
    },
    {
      role: 'tool_result',
      toolCallId: 'outer-code',
      toolName: 'run_code',
      ok: true,
      text: '{"result":2}',
      details: {kind: 'generic'}
    },
    {
      role: 'assistant',
      text: '2 files'
    }
  ];
  const records = [...visible.slice(0, 2), ...executionRecords(), ...visible.slice(2)];
  for (const record of executionRecords()) {
    assert.equal(shouldIncludeRecordInProviderContext(record), false);
  }
  for (const convert of [
    convertTranscriptToOpenAiInput,
    convertTranscriptToOpenAiChatMessages,
    convertTranscriptToAnthropicMessages
  ]) {
    assert.deepEqual(convert(records), convert(visible));
  }
});

test('bounded display previews leave the complete outer result unchanged for every provider', () => {
  const value = {
    status: 'failed',
    result: {
      has_more: false,
      truncated: false,
      content: '中文🧑‍💻\x1b[2J\r\n\t\x9b[?1049h'.repeat(400),
      tail: 'PROVIDER-RESULT-TAIL'
    },
    logs: Array.from({length: 30}, (_, index) => `returned-log-${index}`),
    logs_truncated: true,
    summary: {attempted: 1, completed: 1, failed: 0, cancelled: 0, duration_ms: 8},
    error: {phase: 'runtime', code: 'script_error', message: 'returned failure', line: 3, column: 2}
  };
  const result = {
    role: 'tool_result',
    toolCallId: 'outer-code',
    toolName: 'run_code',
    ok: false,
    details: {kind: 'generic'},
    text: JSON.stringify(value)
  };
  const records = [
    {role: 'user', text: 'inspect'},
    {
      role: 'tool_call',
      toolCallId: 'outer-code',
      toolName: 'run_code',
      argumentsText: JSON.stringify({code: 'throw new Error("SOURCE-MUST-NOT-EXECUTE")'}),
      text: ''
    },
    ...executionRecords(),
    result,
    {role: 'assistant', text: 'done'}
  ];
  const original = structuredClone(records);
  const converters = [
    convertTranscriptToOpenAiInput,
    convertTranscriptToOpenAiChatMessages,
    convertTranscriptToAnthropicMessages
  ];
  const before = converters.map((convert) => structuredClone(convert(records)));
  for (const width of [24, 80, 160]) {
    const state = createCodeExecutionAppendState();
    const snapshot = renderTranscriptLines(
      records,
      width,
      createTuiTheme(),
      undefined,
      true,
      undefined,
      {state, snapshot: true}
    );
    const text = snapshot.map(stripAnsi).join('\n');
    assert.match(text, /Result:/u);
    assert.doesNotMatch(text, /PROVIDER-RESULT-TAIL|SOURCE-MUST-NOT-EXECUTE/u);
    assert.equal(
      renderTranscriptBlocks(
        [result],
        width,
        createTuiTheme(),
        undefined,
        false,
        undefined,
        undefined,
        {state}
      ).join(''),
      ''
    );
    for (let index = 0; index < converters.length; index += 1) {
      assert.deepEqual(converters[index](records), before[index]);
      assert.ok(JSON.stringify(before[index]).includes('PROVIDER-RESULT-TAIL'));
      assert.ok(JSON.stringify(before[index]).includes('returned-log-29'));
    }
  }
  assert.equal(result.text, JSON.stringify(value));
  assert.deepEqual(records, original);
});

test('code execution audits are excluded from token estimates, references and compaction input', async () => {
  const visible = [
    {
      role: 'user',
      text: 'question'
    },
    {
      role: 'assistant',
      text: 'answer'
    }
  ];
  const records = [visible[0], ...executionRecords(), visible[1]];
  assert.equal(estimateRecordsTokens(records), estimateRecordsTokens(visible));
  assert.deepEqual(estimateContextUsageSegments(records), estimateContextUsageSegments(visible));
  assert.deepEqual(
    renderConversationReferenceSegments({records}),
    renderConversationReferenceSegments({records: visible})
  );
  let summaryInput;
  await generateCompactionSummary({
    agent: {
      async runTurn(input) {
        summaryInput = input;
        return {
          draft: 'summary',
          toolCalls: []
        };
      }
    },
    prefixRecords: [],
    compactedRecords: records,
    previousSummary: ''
  });
  assert.deepEqual(summaryInput.slice(0, -1), visible);
});

test('compaction cannot split an outer tool pair separated by local audit events', () => {
  const records = [
    {
      role: 'user',
      text: 'old'
    },
    {
      role: 'assistant',
      text: 'old answer'
    },
    {
      role: 'user',
      text: 'count files'
    },
    {
      role: 'tool_call',
      toolCallId: 'outer-code',
      toolName: 'run_code',
      argumentsText: '{}',
      text: ''
    },
    ...executionRecords(),
    {
      role: 'tool_result',
      toolCallId: 'outer-code',
      toolName: 'run_code',
      ok: true,
      text: '2',
      details: {kind: 'generic'}
    },
    {
      role: 'assistant',
      text: 'done'
    }
  ];
  assert.equal(computeCompactionBoundary(records, 2), 3);
});

test('journal round trips all code execution event fields', () => {
  const records = executionRecords();
  assert.deepEqual(replayTranscriptJournal(journal(records)).session.records, records);
});

test('journal rejects malformed audit identity, sequence, event and optional metadata', () => {
  for (const overrides of [
    {toolCallId: ''},
    {executionId: ''},
    {sequence: -1},
    {sequence: 1.5},
    {event: 'unknown'},
    {childCallId: 1},
    {toolName: {}},
    {status: true},
    {durationMs: -1},
    {durationMs: '4'}
  ]) {
    const malformed = journal([audit(overrides)]);
    const repaired = replayTranscriptJournal(malformed);
    assert.equal(repaired.requiresRepair, true, JSON.stringify(overrides));
    assert.deepEqual(repaired.session.records, []);
    const continuation = serializeTranscriptJournalLine(
      createTranscriptJournalEntry(
        createAppendRecordsOperation([
          {
            role: 'assistant',
            text: 'later'
          }
        ]),
        2,
        '2026-07-01T00:00:02.000Z'
      )
    );
    assert.equal(
      replayTranscriptJournal(malformed + continuation + '\n'),
      null,
      JSON.stringify(overrides)
    );
  }
});

test('restore, fork, preview and truncation preserve audits and returned data without execution', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-code-transcript-'));
  t.after(() =>
    fs.rmSync(rootDir, {
      recursive: true,
      force: true
    })
  );
  const cwd = '/tmp/echo-code-transcript-project';
  const store = createTranscriptStore({rootDir});
  const context = new TranscriptContext(store, () => cwd);
  const records = [
    {
      role: 'user',
      text: 'inspect'
    },
    {
      role: 'tool_call',
      toolCallId: 'outer-code',
      toolName: 'run_code',
      argumentsText: JSON.stringify({code: 'throw new Error("SOURCE-MUST-NOT-EXECUTE")'}),
      text: ''
    },
    ...executionRecords(),
    {
      role: 'tool_result',
      toolCallId: 'outer-code',
      toolName: 'run_code',
      ok: true,
      details: {kind: 'generic'},
      text: JSON.stringify({
        status: 'succeeded',
        result: {count: 1},
        logs: ['persisted'],
        logs_truncated: false,
        summary: {attempted: 1, completed: 1, failed: 0, cancelled: 0, duration_ms: 8},
        error: null
      })
    }
  ];
  const original = structuredClone(records);
  context.appendRecords(records);
  const sourceId = context.getCurrentSessionId();
  const restored = new TranscriptContext(store, () => cwd);
  assert.equal(restored.loadSession(sourceId), true);
  assert.deepEqual(restored.getCompleteRecords(), records);
  for (const width of [24, 80, 160]) {
    const lines = renderTranscriptLines(restored.getCompleteRecords(), width);
    const text = lines.map(stripAnsi).join('\n');
    assert.equal((text.match(/Result:/gu) || []).length, 1);
    assert.equal((text.match(/Logs:/gu) || []).length, 1);
    assert.match(text, /"count": 1/u);
    assert.match(text, /"persisted"/u);
    assert.doesNotMatch(text, /SOURCE-MUST-NOT-EXECUTE/u);
    assert.ok(lines.every((line) => displayWidth(line) <= safeRenderWidth(width)));
  }
  assert.deepEqual(records, original);
  assert.deepEqual(restored.getCompleteRecords(), original);
  const fork = restored.forkSession();
  assert.equal(fork.ok, true);
  assert.notEqual(fork.sessionId, sourceId);
  assert.deepEqual(store.loadSession(cwd, fork.sessionId).session.records, records);
  const preview = await store.loadSessionPreview(cwd, fork.sessionId);
  const audits = preview.previewRecords.filter((record) => record.role === 'code_execution');
  assert.equal(audits.length, 4);
  assert.match(audits.at(-1).text, /Run code · end · succeeded/);
  store.appendSession(
    cwd,
    store.loadSession(cwd, fork.sessionId).reference,
    createTruncateRecordsOperation(1)
  );
  assert.deepEqual(store.loadSession(cwd, fork.sessionId).session.records, [records[0]]);
  assert.deepEqual(store.loadSessionReadOnly(cwd, sourceId).session.records, records);
});

test('audit rendering stays compact, themed, width-safe and terminal-safe without mutating facts', () => {
  const records = executionRecords();
  records[1].toolName = '\x1b[2Jgrep\r\x07';
  records[1].childCallId = 'child\n\x1b[?1049h';
  records[1].text = '参数摘要\r\x00\x1b[31m\n' + 'x'.repeat(10_000);
  records[2].status = 'failed\x1b[?1049l\r\x07';
  const original = structuredClone(records);
  const theme = createTuiTheme({blocks: {colors: {text: [11, 22, 33]}}});
  const unwrap = (lines) =>
    lines
      .map((line) => stripAnsi(line).replace(/^(?:◆ |  )▌ /u, ''))
      .join('')
      .replace(/\s+/gu, '');
  const unwrapped = unwrap(renderTranscriptLines(records, 4096, theme));
  for (const width of [8, 24, 80, 120]) {
    const state = createCodeExecutionAppendState();
    for (const record of records) {
      assert.equal(
        renderTranscriptBlocks([record], width, theme, undefined, false, undefined, undefined, {
          state
        }).join(''),
        ''
      );
    }
    const lines = renderTranscriptLines(records, width, theme);
    // 共用 rail 后按真实可用列宽换行，不再用旧版单行截断的固定行数限制。
    assert.equal(unwrap(lines), unwrapped);
    for (const line of lines) {
      assert.ok(displayWidth(line) <= safeRenderWidth(width));
      assert.doesNotMatch(stripAnsi(line), /[\x00-\x1f\x7f-\x9f]/);
    }
    assert.match(lines.join('\n'), /\x1b\[38;2;11;22;33m/);
    assert.doesNotMatch(lines.join('\n'), /\x1b\[2J|\x1b\[\?1049[hl]/);
    assert.equal(renderTranscriptBlocks(records, width, theme).join(''), lines.join('\n') + '\n');
    const pending = projectCodeExecutionPending(
      {
        kind: 'tool_call',
        callId: 'outer-code',
        toolName: 'run_code',
        argumentsText: '{"code":"SOURCE-MUST-NOT-EXPAND"}'
      },
      state
    );
    assert.deepEqual(pending.codeExecution, {
      ordinal: 1,
      status: 'finishing',
      summary: 'completed 0/2 · failed 0 · cancelled 0 · unfinished 1 · unknown 1'
    });
    for (const line of renderPendingAssistantLines(pending, width, Infinity, theme)) {
      assert.ok(displayWidth(line) <= safeRenderWidth(width));
      assert.doesNotMatch(stripAnsi(line), /[\x00-\x1f\x7f-\x9f]/u);
      assert.doesNotMatch(line, /\x1b\[2J|\x1b\[\?1049[hl]|SOURCE-MUST-NOT-EXPAND/u);
    }
  }
  const plain = renderTranscriptLines(executionRecords(), 160).map(stripAnsi).join('\n');
  assert.match(plain, /◆ ▌ Run code #1 · succeeded/);
  assert.match(plain, /  ▌ #\?1 read_files · succeeded · 4ms/);
  assert.match(plain, /completed 1\/1 · failed 0 · cancelled 0 · 8ms/);
  assert.match(plain, /Result preview unavailable/u);
  assert.doesNotMatch(plain, /LOCAL-AUDIT-ONLY|completed 1; failed 0/u);
  assert.doesNotMatch(plain, /child-1|call_start|call_end|[├│]/u);
  assert.deepEqual(records, original);
});

test('audit previews sanitize metadata and retain events with empty summaries', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-code-preview-'));
  t.after(() =>
    fs.rmSync(rootDir, {
      recursive: true,
      force: true
    })
  );
  const store = createTranscriptStore({rootDir});
  const cwd = '/tmp/code-preview';
  const record = audit({
    text: '',
    toolName: 'grep\x1b[2J\x07\r',
    status: 'cancelled'
  });
  const reference = store.createSession(cwd, createAppendRecordsOperation([record]));
  const preview = await store.loadSessionPreview(cwd, reference.sessionId);
  assert.equal(preview.previewRecords[0].role, 'code_execution');
  assert.match(preview.previewRecords[0].text, /Run code · start · grep/);
  assert.doesNotMatch(preview.previewRecords[0].text, /[\x00-\x1f\x7f-\x9f]/);
  assert.deepEqual(store.loadSession(cwd, reference.sessionId).session.records, [record]);
});

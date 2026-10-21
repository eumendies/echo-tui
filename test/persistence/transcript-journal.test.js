const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createAppendRecordsOperation,
  createBatchOperation,
  createRepairedJournalText,
  createSetChangeHistoryOperation,
  createSetCompactionOperation,
  createSetTodoStateOperation,
  createTranscriptJournalEntry,
  createTranscriptJournalStart,
  createTruncateRecordsOperation,
  replayTranscriptJournal,
  replayTranscriptJournalFile,
  replayTranscriptJournalStream,
  serializeTranscriptJournalLine
} = require('../../src/persistence/transcript-journal');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'echo-journal-replay-'));
}

/** 统计一次操作实际读取的字节数，用来断言读取器在判定结果后立即停止。 */
function countBytesRead(run) {
  let bytes = 0;
  const countingFs = {
    ...fs,
    readSync(descriptor, buffer, offset, length, position) {
      const read = fs.readSync(descriptor, buffer, offset, length, position);
      bytes += read;
      return read;
    }
  };

  return {bytes, result: run(countingFs)};
}

function createJournalLines(operations) {
  return [
    serializeTranscriptJournalLine(createTranscriptJournalStart('session-1', '/tmp/project', '2026-07-01T00:00:00.000Z')),
    ...operations.map((operation, index) => serializeTranscriptJournalLine(createTranscriptJournalEntry(operation, index + 1, `2026-07-01T00:00:0${index + 1}.000Z`)))
  ];
}

test('replayTranscriptJournal replays records and keeps state updates independent', () => {
  const todoState = {
    updatedAt: '2026-07-01T00:00:02.000Z',
    items: [{id: 'todo_1', text: 'inspect journal', status: 'open'}]
  };
  const compaction = {
    summaryText: 'earlier context',
    activeStartIndex: 1,
    createdAt: '2026-07-01T00:00:03.000Z'
  };
  const changeHistory = [{
    id: 'checkpoint-1',
    createdAt: '2026-07-01T00:00:04.000Z',
    cwd: '/tmp/project',
    transcriptStartIndex: 1,
    status: 'ready',
    files: []
  }];
  const journal = createJournalLines([
    createAppendRecordsOperation([{role: 'user', text: 'hello'}]),
    createSetTodoStateOperation(todoState),
    createSetCompactionOperation(compaction),
    createSetChangeHistoryOperation(changeHistory),
    createAppendRecordsOperation([{role: 'assistant', text: 'world'}])
  ]).join('\n');

  const loaded = replayTranscriptJournal(journal);

  assert.deepEqual(loaded.session.records, [
    {role: 'user', text: 'hello'},
    {role: 'assistant', text: 'world'}
  ]);
  assert.deepEqual(loaded.session.todoState, todoState);
  assert.deepEqual(loaded.session.compaction, compaction);
  assert.deepEqual(loaded.session.changeHistory, changeHistory);
  assert.equal(loaded.reference.sequence, 5);
});

test('replayTranscriptJournal incrementally replays valid custom subagent process records without migration', () => {
  const base = {role: 'subagent', agentName: 'security-reviewer', parentToolCallId: 'outer-1', runId: 'run-1'};
  const records = [
    {...base, text: 'inspect', event: {kind: 'start', task: 'inspect'}},
    {...base, text: 'grep({"pattern":"x"})', event: {kind: 'tool_call', toolCallId: 'inner-1', toolName: 'grep', argumentsText: '{"pattern":"x"}'}},
    {...base, text: 'x found', event: {kind: 'tool_result', toolCallId: 'inner-1', toolName: 'grep', ok: true, details: {kind: 'grep', truncated: false}}},
    {...base, text: 'report', event: {kind: 'assistant'}},
    {...base, text: '', event: {kind: 'completed', durationMs: 42}}
  ];
  const journal = createJournalLines(records.map((record) => createAppendRecordsOperation([record]))).join('\n');
  const loaded = replayTranscriptJournal(journal);

  assert.deepEqual(loaded.session.records, records);
  assert.equal(loaded.reference.sequence, records.length);
});

test('replayTranscriptJournal keeps concise subagent failure and provider-facing handoff in their separate records', () => {
  const base = {role: 'subagent', agentName: 'explorer', parentToolCallId: 'outer-failed', runId: 'run-failed'};
  const errorText = 'Explorer failed：termination error';
  const handoffText = 'Subagent failure: Explorer failed：termination error\n\nStable output:\n    preserved finding';
  const processRecords = [
    {...base, text: 'inspect', event: {kind: 'start', task: 'inspect'}},
    {...base, text: 'preserved finding', event: {kind: 'assistant'}},
    {...base, text: errorText, event: {kind: 'failed', durationMs: 42}}
  ];
  const outerPair = [
    {role: 'tool_call', text: 'run_subagent', toolCallId: 'outer-failed', toolName: 'run_subagent', argumentsText: '{"agent":"explorer","task":"inspect"}'},
    {role: 'tool_result', text: handoffText, toolCallId: 'outer-failed', toolName: 'run_subagent', ok: false, details: {kind: 'generic'}}
  ];
  const journal = createJournalLines([
    ...processRecords.map((record) => createAppendRecordsOperation([record])),
    createAppendRecordsOperation(outerPair)
  ]).join('\n');

  const loaded = replayTranscriptJournal(journal);
  assert.deepEqual(loaded.session.records, [...processRecords, ...outerPair]);
  assert.equal(loaded.session.records[2].text, errorText);
  assert.doesNotMatch(loaded.session.records[2].text, /Subagent failure:/u);
  assert.equal(loaded.session.records[4].text, handoffText);
});

test('replayTranscriptJournal rejects malformed subagent identity and event payloads', () => {
  const validStart = {
    role: 'subagent',
    text: 'inspect',
    agentName: 'explorer',
    parentToolCallId: 'outer-1',
    runId: 'run-1',
    event: {kind: 'start', task: 'inspect'}
  };
  const malformed = {...validStart, runId: '', event: {kind: 'completed', durationMs: -1}};
  const journal = createJournalLines([
    createAppendRecordsOperation([validStart]),
    createAppendRecordsOperation([malformed]),
    createAppendRecordsOperation([{role: 'assistant', text: 'later'}])
  ]).join('\n');

  assert.equal(replayTranscriptJournal(journal), null);
});

test('replayTranscriptJournal applies batch operations atomically in journal order', () => {
  const journal = createJournalLines([
    createAppendRecordsOperation([
      {role: 'user', text: 'A'},
      {role: 'assistant', text: 'B'},
      {role: 'assistant', text: 'C'}
    ]),
    createBatchOperation([
      createTruncateRecordsOperation(1),
      createSetCompactionOperation(null),
      createAppendRecordsOperation([{role: 'assistant', text: 'D'}])
    ])
  ]).join('\n');

  const loaded = replayTranscriptJournal(journal);

  assert.deepEqual(loaded.session.records, [
    {role: 'user', text: 'A'},
    {role: 'assistant', text: 'D'}
  ]);
  assert.equal(loaded.session.compaction, undefined);
  assert.equal(loaded.reference.sequence, 2);
});

test('replayTranscriptJournal rejects a batch without applying its partial mutations', () => {
  const journal = createJournalLines([
    createAppendRecordsOperation([{role: 'user', text: 'saved'}]),
    createBatchOperation([
      createAppendRecordsOperation([{role: 'assistant', text: 'must not leak'}]),
      createTruncateRecordsOperation(99)
    ]),
    createAppendRecordsOperation([{role: 'assistant', text: 'later'}])
  ]).join('\n');

  assert.equal(replayTranscriptJournal(journal), null);
});

test('replayTranscriptJournal ignores an incomplete final line', () => {
  const journal = `${createJournalLines([
    createAppendRecordsOperation([{role: 'user', text: 'saved'}])
  ]).join('\n')}\n{"schemaVersion":1,"seq":2`;

  const loaded = replayTranscriptJournal(journal);

  assert.deepEqual(loaded.session.records, [{role: 'user', text: 'saved'}]);
  assert.equal(loaded.reference.sequence, 1);
  assert.equal(loaded.requiresRepair, true);
});

test('replayTranscriptJournal ignores a structurally invalid final line', () => {
  const journal = `${createJournalLines([
    createAppendRecordsOperation([{role: 'user', text: 'saved'}])
  ]).join('\n')}\n{"schemaVersion":1,"seq":2}`;

  const loaded = replayTranscriptJournal(journal);

  assert.deepEqual(loaded.session.records, [{role: 'user', text: 'saved'}]);
  assert.equal(loaded.reference.sequence, 1);
  assert.equal(loaded.requiresRepair, true);
});

test('replayTranscriptJournal rejects a corrupt middle line and non-contiguous sequences', () => {
  const lines = createJournalLines([
    createAppendRecordsOperation([{role: 'user', text: 'saved'}]),
    createAppendRecordsOperation([{role: 'assistant', text: 'later'}])
  ]);

  assert.equal(replayTranscriptJournal([lines[0], '{bad json', lines[2]].join('\n')), null);
  assert.equal(replayTranscriptJournal([
    lines[0],
    lines[1],
    serializeTranscriptJournalLine(createTranscriptJournalEntry(createAppendRecordsOperation([{role: 'assistant', text: 'later'}]), 3, '2026-07-01T00:00:03.000Z'))
  ].join('\n')), null);
});

test('journal replay tolerates only structural tail damage and never semantic failures', () => {
  const [start, first] = createJournalLines([createAppendRecordsOperation([{role: 'user', text: 'saved'}])]);
  const laterEntry = (seq) => serializeTranscriptJournalLine(createTranscriptJournalEntry(
    createAppendRecordsOperation([{role: 'assistant', text: 'later'}]), seq, `2026-07-01T00:00:0${seq}.000Z`
  ));
  const cases = [
    {name: '结构无效在末行', lines: [start, first, '{"schemaVersion":1,"seq":2'], recoverable: true},
    {name: '未知操作在末行', lines: [start, first, serializeTranscriptJournalLine({op: 'unknown_op', schemaVersion: 1, seq: 2, updatedAt: 'x'})], recoverable: true},
    {name: '无效尾行之后只有空行', lines: [start, first, '{"schemaVersion":1,"seq":2', '', '   '], recoverable: true},
    {name: '结构无效在中间行', lines: [start, first, '{bad json', laterEntry(3)], recoverable: false},
    {name: '未知操作在中间行', lines: [start, first, serializeTranscriptJournalLine({op: 'unknown_op', schemaVersion: 1, seq: 2, updatedAt: 'x'}), laterEntry(3)], recoverable: false},
    {name: 'seq 断裂在末行', lines: [start, first, laterEntry(9)], recoverable: false},
    {name: '越界截断在末行', lines: [start, first, serializeTranscriptJournalLine(createTranscriptJournalEntry(createTruncateRecordsOperation(9), 2, '2026-07-01T00:00:02.000Z'))], recoverable: false},
    {name: '空 journal', lines: [''], recoverable: false},
    {name: '无效 session_start', lines: ['{"schemaVersion":1,"seq":1,"updatedAt":"x"}'], recoverable: false}
  ];

  for (const item of cases) {
    const loaded = replayTranscriptJournal(`${item.lines.join('\n')}\n`);
    assert.equal(loaded !== null, item.recoverable, item.name);

    if (loaded) {
      assert.deepEqual(loaded.session.records, [{role: 'user', text: 'saved'}], item.name);
      assert.equal(loaded.requiresRepair, true, item.name);
    }
  }
});

test('text, file, and stream replay entry points agree on the same journals', async () => {
  const directory = createTempDir();

  try {
    const [start, first, batch, truncate] = createJournalLines([
      createAppendRecordsOperation([{role: 'user', text: 'first'}]),
      createBatchOperation([
        createAppendRecordsOperation([{role: 'assistant', text: 'batched'}]),
        createSetTodoStateOperation({items: [], updatedAt: '2026-07-01T00:00:02.000Z'})
      ]),
      createTruncateRecordsOperation(1)
    ]);
    const journals = [
      {name: 'normal', text: `${[start, first, batch, truncate].join('\n')}\n`},
      {name: 'no-trailing-newline', text: [start, first, batch, truncate].join('\n')},
      {name: 'torn-tail', text: `${[start, first].join('\n')}\n{"schemaVersion":1,"seq":2`},
      {name: 'corrupt-middle', text: `${[start, first, '{bad json', batch].join('\n')}\n`}
    ];

    for (const item of journals) {
      const filePath = path.join(directory, `${item.name}.jsonl`);
      fs.writeFileSync(filePath, item.text, 'utf8');
      const fromText = replayTranscriptJournal(item.text);
      assert.deepEqual(replayTranscriptJournalFile(filePath, fs), fromText, item.name);
      assert.deepEqual(await replayTranscriptJournalStream(fs.createReadStream(filePath)), fromText, item.name);
    }
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('chunked reading keeps multi-byte characters intact across chunk boundaries', async () => {
  const directory = createTempDir();
  const chunkBytes = 64 * 1024;
  const marker = '中文🙂尾巴';

  try {
    for (const delta of [-3, -2, -1, 0, 1, 2, 3]) {
      // 按完整序列化前缀反推 padding，让多字节字符的字节确实落在 chunk 边界两侧。
      const measure = `${createJournalLines([createAppendRecordsOperation([{role: 'user', text: marker}])]).join('\n')}\n`;
      const prefixBytes = Buffer.byteLength(measure.slice(0, measure.indexOf(marker)));
      const text = `${'a'.repeat(chunkBytes + delta - prefixBytes)}${marker}`;
      const journal = `${createJournalLines([createAppendRecordsOperation([{role: 'user', text}])]).join('\n')}\n`;
      const markerOffset = Buffer.byteLength(journal.slice(0, journal.indexOf(marker)));

      // 自校验：测试必须真的把字符切开，否则断言会失去意义。
      assert.equal(markerOffset, chunkBytes + delta, `delta=${delta}`);

      const filePath = path.join(directory, `multi-byte-${delta}.jsonl`);
      fs.writeFileSync(filePath, journal, 'utf8');

      const fromFile = replayTranscriptJournalFile(filePath, fs);
      assert.equal(fromFile.session.records[0].text, text, `file delta=${delta}`);

      const fromStream = await replayTranscriptJournalStream(fs.createReadStream(filePath));
      assert.equal(fromStream.session.records[0].text, text, `stream delta=${delta}`);
    }
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('repaired journal text keeps only the normalized valid prefix', () => {
  const directory = createTempDir();

  try {
    const [start, first, second] = createJournalLines([
      createAppendRecordsOperation([{role: 'user', text: 'saved'}]),
      createAppendRecordsOperation([{role: 'assistant', text: 'later'}])
    ]);
    const filePath = path.join(directory, 'torn.jsonl');
    // 夹空行、行首尾空白、CRLF 与无换行的无效尾行：修复必须按非空逻辑行计数并规范化。
    fs.writeFileSync(filePath, `${[start, '', `  ${first}  `, second].join('\r\n')}\r\n{"schemaVersion":1,"seq":3`, 'utf8');

    const loaded = replayTranscriptJournalFile(filePath, fs);

    assert.equal(loaded.requiresRepair, true);
    assert.equal(loaded.reference.sequence, 2);
    assert.equal(createRepairedJournalText(filePath, fs, loaded.reference.sequence), `${[start, first, second].join('\n')}\n`);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('journal replay reads in chunks without whole-file reads or duplicate deep copies', () => {
  const directory = createTempDir();
  const originalClone = globalThis.structuredClone;
  let cloneCalls = 0;
  const calls = {openSync: 0, readFileSync: 0};

  try {
    const filePath = path.join(directory, 'session.jsonl');
    fs.writeFileSync(filePath, `${createJournalLines([createAppendRecordsOperation([{role: 'user', text: 'saved'}])]).join('\n')}\n`, 'utf8');
    const countingFs = {
      ...fs,
      openSync(filePathToOpen, ...args) {
        if (String(filePathToOpen).endsWith('.jsonl')) calls.openSync += 1;
        return fs.openSync(filePathToOpen, ...args);
      },
      readFileSync(filePathToRead, ...args) {
        if (String(filePathToRead).endsWith('.jsonl')) calls.readFileSync += 1;
        return fs.readFileSync(filePathToRead, ...args);
      }
    };
    globalThis.structuredClone = (value, options) => {
      cloneCalls += 1;
      return originalClone(value, options);
    };

    const loaded = replayTranscriptJournalFile(filePath, countingFs);

    assert.deepEqual(loaded.session.records, [{role: 'user', text: 'saved'}]);
    assert.equal(calls.openSync, 1);
    assert.equal(calls.readFileSync, 0);
    assert.equal(cloneCalls, 0);
    // 正常路径不产出修复文本：字段缺省即为未构造。
    assert.equal('repairedJournalText' in loaded, false);
    assert.equal(loaded.requiresRepair, false);
  } finally {
    globalThis.structuredClone = originalClone;
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('readers stop as soon as the outcome is decided instead of scanning to EOF', () => {
  const directory = createTempDir();
  const chunkBytes = 64 * 1024;
  const tail = `${'x'.repeat(4 * chunkBytes)}\n`;

  try {
    const invalidFirstLine = path.join(directory, 'invalid-first-line.jsonl');
    fs.writeFileSync(invalidFirstLine, `{bad first line\n${tail}`, 'utf8');
    const replayed = countBytesRead((fsImpl) => replayTranscriptJournalFile(invalidFirstLine, fsImpl));
    assert.equal(replayed.result, null);
    assert.equal(replayed.bytes <= chunkBytes, true);

    // 修复路径收齐有效前缀后立即停止，不再等待下一条非空行。
    const torn = path.join(directory, 'torn.jsonl');
    fs.writeFileSync(torn, `header-line\nop-1\n${tail}`, 'utf8');
    const repaired = countBytesRead((fsImpl) => createRepairedJournalText(torn, fsImpl, 1));
    assert.equal(repaired.result, 'header-line\nop-1\n');
    assert.equal(repaired.bytes <= chunkBytes, true);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('a single append operation far beyond the spread argument limit replays without failing', async () => {
  const directory = createTempDir();

  try {
    // 单次 append 可能承载整段历史（例如 fork 的初始快照）：展开参数在 13 万条左右就会抛 RangeError。
    const records = Array.from({length: 130000}, (_value, index) => ({role: 'assistant', text: `r-${index}`}));
    const filePath = path.join(directory, 'bulk.jsonl');
    fs.writeFileSync(filePath, `${createJournalLines([createAppendRecordsOperation(records)]).join('\n')}\n`, 'utf8');

    assert.equal(replayTranscriptJournalFile(filePath, fs).session.records.length, records.length);
    assert.equal((await replayTranscriptJournalStream(fs.createReadStream(filePath))).session.records.length, records.length);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

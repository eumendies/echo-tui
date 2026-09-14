const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPendingConversationReference,
  createConversationReferenceProjection,
  expandConversationReferenceForUserText,
  prepareConversationReference,
  renderConversationReferenceMaterial,
  renderConversationReferenceSegments,
  resolveConversationReferenceBudget,
  resolveConversationReferenceSummaryInputLimit
} = require('../../src/agent/context/conversation-reference');
const {estimateTextTokens} = require('../../src/agent/context/token-estimator');

function createAgent(draft = '## Background and Goals\n- summary') {
  const calls = [];
  return {
    calls,
    async runTurn(records, callbacks, options) {
      calls.push({records, callbacks, options});
      return {draft, toolCalls: []};
    }
  };
}

test('conversation reference material keeps useful records as neutral text and filters local records', () => {
  const records = [
    {role: 'user', text: 'hidden provider text', displayText: 'visible request'},
    {role: 'assistant', text: 'answer'},
    {role: 'tool_call', text: '', toolCallId: 'secret-id', toolName: 'grep', argumentsText: '{"pattern":"needle"}'},
    {role: 'tool_result', text: 'match', toolCallId: 'secret-id', toolName: 'grep', ok: true, details: {kind: 'grep', truncated: false}},
    {role: 'shell', text: 'shell display', command: 'pwd', output: '/tmp/project', includeInContext: true},
    {role: 'shell', text: 'local only', command: 'cat secret', output: 'secret', includeInContext: false},
    {role: 'local_notice', text: 'notice'},
    {role: 'error', text: 'error'},
    {role: 'compaction_notice', text: 'compacted'},
    {role: 'reasoning_summary', text: 'reasoning'},
    {role: 'extension', text: '', extension: {kind: 'unknown', name: 'private', payload: {value: true}}}
  ];
  const material = renderConversationReferenceMaterial(renderConversationReferenceSegments({records}));

  assert.match(material, /\[user\]\nvisible request/);
  assert.match(material, /\[assistant\]\nanswer/);
  assert.match(material, /\[tool_call grep\]/);
  assert.match(material, /\[tool_result grep\]/);
  assert.match(material, /\[shell\]\ncommand: pwd/);
  assert.doesNotMatch(material, /secret-id|local only|notice|reasoning|private/);
});

test('conversation reference budget follows the bounded context ratio', () => {
  assert.equal(resolveConversationReferenceBudget(8_000), 2_000);
  assert.equal(resolveConversationReferenceBudget(50_000), 5_000);
  assert.equal(resolveConversationReferenceBudget(1_000_000), 12_000);
});

test('conversation reference summary input limit follows the bounded window ratio', () => {
  assert.equal(resolveConversationReferenceSummaryInputLimit(1_000), 500);
  assert.equal(resolveConversationReferenceSummaryInputLimit(8_000), 4_000);
  assert.equal(resolveConversationReferenceSummaryInputLimit(16_384), 8_192);
  assert.equal(resolveConversationReferenceSummaryInputLimit(100_000), 50_000);
  assert.equal(resolveConversationReferenceSummaryInputLimit(1_000_000), 64_000);
});

test('short references stay full while long references use a tool-free compaction-style summary', async () => {
  const shortAgent = createAgent();
  const short = await createConversationReferenceProjection({
    agent: shortAgent,
    contextWindow: 128_000,
    materialSegments: [{kind: 'record', header: '[user]', text: 'hello'}]
  });
  assert.deepEqual(short, {mode: 'full', text: '[user]\nhello', omittedRecordCount: 0});
  assert.equal(shortAgent.calls.length, 0);

  const longAgent = createAgent('## Background and Goals\n- long summary');
  const long = await createConversationReferenceProjection({
    agent: longAgent,
    contextWindow: 8_000,
    materialSegments: [{kind: 'record', header: '[user]', text: '中'.repeat(4_000)}]
  });
  assert.equal(long.mode, 'summary');
  assert.equal(long.omittedRecordCount, 0);
  assert.equal(longAgent.calls.length, 1);
  assert.deepEqual(longAgent.calls[0].callbacks, {});
  assert.equal(longAgent.calls[0].options.isCompaction, true);
  assert.equal(longAgent.calls[0].records[1].text, `[user]\n${'中'.repeat(4_000)}`);
  assert.doesNotMatch(longAgent.calls[0].records[1].text, /已省略/);
});

test('long reference reports provider usage to the caller', async () => {
  const observed = [];
  const agent = {
    async runTurn() {
      return {
        draft: '## Background and Goals\n- summary',
        toolCalls: [],
        usage: {inputTokens: 3200, cacheReadInputTokens: 200, outputTokens: 120},
        usageInputTokens: 3100
      };
    }
  };

  await createConversationReferenceProjection({
    agent,
    contextWindow: 8_000,
    materialSegments: [{kind: 'record', header: '[user]', text: '中'.repeat(4_000)}],
    onProviderUsage(result) {
      observed.push(result);
    }
  });

  assert.deepEqual(observed, [{
    usage: {inputTokens: 3200, cacheReadInputTokens: 200, outputTokens: 120},
    usageInputTokens: 3100
  }]);
});

test('conversation reference summary rejects empty output and respects cancellation', async () => {
  await assert.rejects(
    createConversationReferenceProjection({
      agent: createAgent(''),
      contextWindow: 8_000,
      materialSegments: [{kind: 'record', header: '[user]', text: '中'.repeat(4_000)}]
    }),
    /引用总结为空/
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    createConversationReferenceProjection({
      agent: createAgent(),
      abortSignal: controller.signal,
      contextWindow: 8_000,
      materialSegments: [{kind: 'record', header: '[user]', text: '中'.repeat(4_000)}]
    }),
    /模型回答已中断/
  );
});

test('compacted source sessions project the active window with a compacted summary block', () => {
  const session = {
    schemaVersion: 1,
    sessionId: 'compacted-session',
    cwd: '/tmp/project',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    records: [
      {role: 'user', text: 'old compacted question'},
      {role: 'user', text: 'recent question'},
      {role: 'assistant', text: 'recent answer'}
    ],
    compaction: {summaryText: 'compacted-history-summary', activeStartIndex: 1, createdAt: '2026-01-02T00:00:00.000Z'}
  };
  const pending = createPendingConversationReference({
    contextWindow: 128_000,
    session,
    sourcePath: '/tmp/compacted.jsonl',
    sourceSessionId: session.sessionId,
    title: 'compacted'
  });
  const material = renderConversationReferenceMaterial(pending.materialSegments);

  assert.equal(pending.projectionMode, 'full');
  assert.match(material, /\[compacted_summary\]\ncompacted-history-summary/);
  assert.match(material, /\[user\]\nrecent question/);
  assert.match(material, /\[assistant\]\nrecent answer/);
  assert.doesNotMatch(material, /old compacted question/);
});

test('compaction with empty summary falls back to full final records', () => {
  const session = {
    schemaVersion: 1,
    sessionId: 'empty-summary-session',
    cwd: '/tmp/project',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    records: [{role: 'user', text: 'only question'}],
    compaction: {summaryText: '', activeStartIndex: 1, createdAt: '2026-01-02T00:00:00.000Z'}
  };
  const pending = createPendingConversationReference({
    contextWindow: 128_000,
    session,
    sourcePath: '/tmp/empty.jsonl',
    sourceSessionId: session.sessionId,
    title: 'empty summary'
  });

  assert.match(renderConversationReferenceMaterial(pending.materialSegments), /\[user\]\nonly question/);
});

test('reference selection is provider-free and final preparation does not mutate source session', async () => {
  const session = {
    schemaVersion: 1,
    sessionId: 'source-session',
    cwd: '/tmp/project',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    records: [{role: 'user', text: 'old question'}, {role: 'assistant', text: 'old answer'}]
  };
  const snapshot = structuredClone(session);
  const pending = createPendingConversationReference({
    contextWindow: 128_000,
    session,
    sourcePath: '/tmp/history.jsonl',
    sourceSessionId: 'source-session',
    title: 'old question'
  });
  const agent = createAgent();
  assert.equal(pending.projectionMode, 'full');
  assert.equal(agent.calls.length, 0);

  const reference = await prepareConversationReference({agent, contextWindow: 128_000, pending});
  const expanded = expandConversationReferenceForUserText(reference, 'continue here');

  assert.deepEqual(session, snapshot);
  assert.match(expanded, /title: old question/);
  assert.match(expanded, /source_file: \/tmp\/history\.jsonl/);
  assert.match(expanded, /\[user\]\nold question/);
  assert.match(expanded, /<current_request>\ncontinue here/);
  assert.doesNotMatch(expanded, /session_id:|updated_at:|created_at:|message_count:/i);
  assert.doesNotMatch(expanded, /read_files/);

  const summaryExpanded = expandConversationReferenceForUserText(
    {...reference, projectionMode: 'summary', projectionText: 'summary', omittedRecordCount: 0},
    'continue'
  );
  assert.match(summaryExpanded, /read_files/);
  assert.match(summaryExpanded, /append-only JSONL journal/);
  assert.doesNotMatch(summaryExpanded, /omits/);
});

test('long compacted reference summarizes the active window once with the compacted summary', async () => {
  const session = {
    schemaVersion: 1,
    sessionId: 'compacted-session',
    cwd: '/tmp/project',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    records: [
      {role: 'user', text: 'history-marker'},
      {role: 'user', text: 'recent question'},
      {role: 'tool_result', text: '中'.repeat(4_000), toolCallId: 'call-1', toolName: 'read_files', ok: true, details: {kind: 'read_files', truncated: false}}
    ],
    compaction: {summaryText: 'compacted-summary-marker', activeStartIndex: 1, createdAt: '2026-01-02T00:00:00.000Z'}
  };
  const pending = createPendingConversationReference({
    contextWindow: 8_000,
    session,
    sourcePath: '/tmp/compacted.jsonl',
    sourceSessionId: session.sessionId,
    title: 'compacted'
  });
  const agent = createAgent('## Background and Goals\n- summarized once');

  const reference = await prepareConversationReference({agent, contextWindow: 8_000, pending});
  const summaryInput = agent.calls[0].records[1].text;

  assert.equal(agent.calls.length, 1);
  assert.equal(agent.calls[0].options.isCompaction, true);
  assert.match(summaryInput, /\[compacted_summary\]\ncompacted-summary-marker/);
  assert.match(summaryInput, /recent question/);
  assert.doesNotMatch(summaryInput, /history-marker/);
  assert.equal(reference.omittedRecordCount, 0);
});

test('oversized reference material degrades to one head-and-tail truncated summary request', async () => {
  const materialSegments = [];
  for (let index = 0; index < 10; index += 1) {
    materialSegments.push({kind: 'record', header: '[user]', text: `marker-${index}-${'中'.repeat(1_497)}`});
  }
  const agent = createAgent('## Background and Goals\n- truncated summary');

  const projection = await createConversationReferenceProjection({
    agent,
    contextWindow: 16_000,
    materialSegments
  });
  const summaryInput = agent.calls[0].records[1].text;
  const totalInputTokens = agent.calls[0].records.reduce((sum, record) => sum + estimateTextTokens(record.text), 0);

  assert.equal(agent.calls.length, 1);
  assert.equal(projection.mode, 'summary');
  assert.equal(projection.omittedRecordCount, 3);
  assert.match(summaryInput, /\[user\]\nmarker-0-/);
  assert.match(summaryInput, /marker-1-/);
  assert.match(summaryInput, /marker-9-/);
  assert.doesNotMatch(summaryInput, /marker-2-|marker-3-|marker-4-/);
  assert.match(summaryInput, /已省略 3 条记录/);
  assert.ok(totalInputTokens <= 8_000);

  const expanded = expandConversationReferenceForUserText(
    {
      projectionMode: projection.mode,
      sourcePath: '/tmp/history.jsonl',
      sourceSessionId: 'history-id',
      title: 'history',
      projectionText: projection.text,
      omittedRecordCount: projection.omittedRecordCount
    },
    'continue'
  );
  assert.match(expanded, /omits 3 middle conversation records/);
  assert.match(expanded, /read_files/);
});

test('oversized compacted summary block is capped and remaining records are omitted in one request', async () => {
  const session = {
    schemaVersion: 1,
    sessionId: 'huge-summary-session',
    cwd: '/tmp/project',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    records: [{role: 'user', text: 'recent question'}],
    compaction: {summaryText: '中'.repeat(24_000), activeStartIndex: 0, createdAt: '2026-01-02T00:00:00.000Z'}
  };
  const pending = createPendingConversationReference({
    contextWindow: 16_000,
    session,
    sourcePath: '/tmp/huge.jsonl',
    sourceSessionId: session.sessionId,
    title: 'huge summary'
  });
  const agent = createAgent('## Background and Goals\n- truncated summary');

  const projection = await createConversationReferenceProjection({
    agent,
    contextWindow: 16_000,
    materialSegments: pending.materialSegments
  });
  const summaryInput = agent.calls[0].records[1].text;
  const totalInputTokens = agent.calls[0].records.reduce((sum, record) => sum + estimateTextTokens(record.text), 0);

  assert.equal(agent.calls.length, 1);
  assert.match(summaryInput, /^\[compacted_summary\]\n/);
  assert.match(summaryInput, /\[summary truncated\]/);
  assert.match(summaryInput, /已省略 1 条记录/);
  assert.doesNotMatch(summaryInput, /recent question/);
  assert.ok(totalInputTokens <= 8_000);
  assert.equal(projection.omittedRecordCount, 1);
});

test('reference preparation recomputes budget with the submission-time model window', async () => {
  const session = {
    schemaVersion: 1,
    sessionId: 'source-session',
    cwd: '/tmp/project',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    records: [{role: 'user', text: '中'.repeat(4_000)}]
  };
  const pending = createPendingConversationReference({
    contextWindow: 128_000,
    session,
    sourcePath: '/tmp/history.jsonl',
    sourceSessionId: 'source-session',
    title: 'history'
  });
  assert.equal(pending.projectionMode, 'full');

  const agent = createAgent('## Background and Goals\n- recompute summary');
  const reference = await prepareConversationReference({agent, contextWindow: 8_000, pending});

  assert.equal(agent.calls.length, 1);
  assert.equal(reference.projectionMode, 'summary');
});

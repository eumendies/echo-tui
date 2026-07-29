const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPendingConversationReference,
  createConversationReferenceProjection,
  expandConversationReferenceForUserText,
  prepareConversationReference,
  renderConversationReferenceMaterial,
  resolveConversationReferenceBudget
} = require('../../src/agent/context/conversation-reference');

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
  const material = renderConversationReferenceMaterial(records);

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

test('short references stay full while long references use a tool-free compaction-style summary', async () => {
  const shortAgent = createAgent();
  const short = await createConversationReferenceProjection({
    agent: shortAgent,
    contextWindow: 128_000,
    material: '[user]\nhello'
  });
  assert.deepEqual(short, {mode: 'full', text: '[user]\nhello'});
  assert.equal(shortAgent.calls.length, 0);

  const longAgent = createAgent('## Background and Goals\n- long summary');
  const long = await createConversationReferenceProjection({
    agent: longAgent,
    contextWindow: 8_000,
    material: '中'.repeat(4_000)
  });
  assert.equal(long.mode, 'summary');
  assert.match(long.text, /long summary/);
  assert.equal(longAgent.calls.length, 1);
  assert.deepEqual(longAgent.calls[0].callbacks, {});
  assert.equal(longAgent.calls[0].options.isCompaction, true);
  assert.doesNotMatch(longAgent.calls[0].records[1].text, /Existing compaction summary/);
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
    material: '中'.repeat(4_000),
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
    createConversationReferenceProjection({agent: createAgent(''), contextWindow: 8_000, material: '中'.repeat(4_000)}),
    /引用总结为空/
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    createConversationReferenceProjection({agent: createAgent(), abortSignal: controller.signal, contextWindow: 8_000, material: '中'.repeat(4_000)}),
    /模型回答已中断/
  );
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

  const summaryExpanded = expandConversationReferenceForUserText({...reference, projectionMode: 'summary', projectionText: 'summary'}, 'continue');
  assert.match(summaryExpanded, /read_files/);
  assert.match(summaryExpanded, /append-only JSONL journal/);
});

test('long reference summary uses replayed records once and does not prepend compaction summary', async () => {
  const session = {
    schemaVersion: 1,
    sessionId: 'compacted-session',
    cwd: '/tmp/project',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    records: [{role: 'user', text: `history-marker-${'中'.repeat(4_000)}`}],
    compaction: {summaryText: 'duplicate-compaction-marker', boundaryRecordCount: 1}
  };
  const pending = createPendingConversationReference({
    contextWindow: 8_000,
    session,
    sourcePath: '/tmp/compacted.jsonl',
    sourceSessionId: session.sessionId,
    title: 'compacted'
  });
  const agent = createAgent('## Background and Goals\n- summarized once');

  await prepareConversationReference({agent, contextWindow: 8_000, pending});

  assert.equal(agent.calls.length, 1);
  assert.match(agent.calls[0].records[1].text, /history-marker/);
  assert.doesNotMatch(agent.calls[0].records[1].text, /duplicate-compaction-marker/);
});

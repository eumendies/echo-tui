const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeCompactionBoundary,
  estimateContextTokens,
  estimateTextTokens,
  exceedsCompactionThreshold,
  runCompaction
} = require('../../src/agent/context/context-compaction');

function createSummaryAgent(summaryDraft = '结构化摘要内容') {
  const calls = [];
  return {
    calls,
    async runTurn(records, callbacks, options) {
      calls.push({options, records});
      return { draft: summaryDraft, toolCalls: [] };
    }
  };
}

function buildRecords(count) {
  const records = [];
  for (let i = 0; i < count; i += 1) {
    records.push({ role: i % 2 === 0 ? 'user' : 'assistant', text: `message ${i}` });
  }
  return records;
}

test('estimateTextTokens distinguishes CJK and other characters', () => {
  // 4 个 ASCII 字符约 1 token；纯 CJK 字符按更高密度计。
  assert.equal(estimateTextTokens('abcd'), 1);
  assert.equal(estimateTextTokens(''), 0);
  assert.ok(estimateTextTokens('你好世界') >= estimateTextTokens('abcd'));
});

test('exceedsCompactionThreshold compares against window * ratio', () => {
  // 默认阈值比例 0.8：80000 未超 100000*0.8，80001 超。
  assert.equal(exceedsCompactionThreshold(80000, 100000), false);
  assert.equal(exceedsCompactionThreshold(80001, 100000), true);
});

test('estimateContextTokens uses usage anchor plus added record increment', () => {
  const activeRecords = [
    { role: 'user', text: 'aaaa' },
    { role: 'assistant', text: 'bbbb' },
    { role: 'user', text: 'cccc' }
  ];
  // 锚点覆盖前 2 条，真值 1000，再叠加第 3 条字符估算（'cccc' => 1 token）。
  const estimated = estimateContextTokens({
    activeRecords,
    anchor: { usageInputTokens: 1000, measuredAtRecordCount: 2 }
  });

  assert.equal(estimated, 1001);
});

test('estimateContextTokens falls back to pure char estimate without anchor', () => {
  const activeRecords = [
    { role: 'user', text: 'aaaa' },
    { role: 'assistant', text: 'bbbb' }
  ];
  const estimated = estimateContextTokens({ activeRecords, summaryText: 'cccc' });

  // 2 条记录 + 摘要，各 4 个 ASCII 字符 => 各 1 token。
  assert.equal(estimated, 3);
});

test('estimateContextTokens skips non-provider roles', () => {
  const anthropicThinkingBlock = {type: 'redacted_thinking', data: 'abcd'};
  const activeRecords = [
    { role: 'user', text: 'aaaa' },
    { role: 'error', text: 'eeee' },
    { role: 'compaction_notice', text: 'nnnn' },
    { role: 'local_notice', text: 'llll' },
    { role: 'reasoning_summary', text: 'rrrr' },
    { role: 'anthropic_thinking', text: '', block: anthropicThinkingBlock },
    { role: 'assistant', text: 'bbbb' }
  ];
  const estimated = estimateContextTokens({ activeRecords });

  // Anthropic thinking 会回放给 provider，需要计入；本地提示不发给模型不计入。
  assert.equal(estimated, 2 + estimateTextTokens(JSON.stringify(anthropicThinkingBlock)));
});

test('estimateContextTokens skips local shell records', () => {
  const activeRecords = [
    { role: 'user', text: 'aaaa' },
    { role: 'shell', text: '$ env [local]\n\nSECRET=1', command: 'env', includeInContext: false, output: 'SECRET=1\n' },
    { role: 'shell', text: '$ pwd\n\n/workspace', command: 'pwd', includeInContext: true, output: '/workspace\n' }
  ];
  const estimated = estimateContextTokens({ activeRecords });

  assert.equal(estimated, 6);
});

test('computeCompactionBoundary keeps recent K and snaps off tool pairs', () => {
  const records = [];
  for (let i = 0; i < 30; i += 1) {
    records.push({ role: 'user', text: `u${i}` });
  }
  // keepCount=10 => 初始边界 20，落在普通 user 上无需吸附。
  assert.equal(computeCompactionBoundary(records, 10), 20);
});

test('computeCompactionBoundary snaps backward to avoid splitting tool pair', () => {
  const records = [
    { role: 'user', text: 'u0' },
    { role: 'assistant', text: 'a0' },
    { role: 'tool_call', text: '', toolCallId: 'c1' },
    { role: 'tool_result', text: 'r1', toolCallId: 'c1' },
    { role: 'user', text: 'u1' },
    { role: 'assistant', text: 'a1' }
  ];
  // keepCount=3 => 初始边界 3（指向 tool_result），应向前吸附越过整对到 index 2 之前 => 2。
  const boundary = computeCompactionBoundary(records, 3);

  assert.ok(boundary <= 2);
  assert.notEqual(records[boundary] && records[boundary].role, 'tool_result');
});

test('computeCompactionBoundary protects use_skill tool pair like ordinary tools', () => {
  const records = [
    { role: 'user', text: 'u0' },
    { role: 'tool_call', text: '', toolCallId: 'skill1', toolName: 'use_skill', argumentsText: '{"name":"review"}' },
    { role: 'tool_result', text: '# Review', toolCallId: 'skill1', toolName: 'use_skill', ok: true },
    { role: 'user', text: 'u1' },
    { role: 'assistant', text: 'a1' }
  ];

  const boundary = computeCompactionBoundary(records, 3);

  assert.ok(boundary <= 1);
  assert.notEqual(records[boundary] && records[boundary].role, 'tool_result');
});

test('runCompaction summarizes use_skill results when they leave active region', async () => {
  const agent = createSummaryAgent('## 重要工具结果\n- 使用了 review skill。');
  const records = [
    { role: 'user', text: 'review' },
    { role: 'tool_call', text: '', toolCallId: 'skill1', toolName: 'use_skill', argumentsText: '{"name":"review"}' },
    { role: 'tool_result', text: 'skill: review\n# Review Skill', toolCallId: 'skill1', toolName: 'use_skill', ok: true },
    ...buildRecords(30)
  ];

  const result = await runCompaction({ records, force: true, agent });

  assert.equal(result.didCompact, true);
  assert.match(agent.calls[0].records[1].text, /skill: review/);
  assert.match(result.compaction.summaryText, /review skill/);
});

test('runCompaction summarizes slash skill user records like ordinary user records', async () => {
  const agent = createSummaryAgent('## 决策\n- 使用了 review slash skill。');
  const records = [
    {
      role: 'user',
      text: '[Skill Invocation]\nskill: review\n# Review Skill',
      skillInvocation: { source: 'slash', skillName: 'review' }
    },
    ...buildRecords(30)
  ];

  const result = await runCompaction({ records, force: true, agent });

  assert.equal(result.didCompact, true);
  assert.match(agent.calls[0].records[1].text, /Skill Invocation/);
  assert.match(result.compaction.summaryText, /review slash skill/);
});

test('runCompaction does not include local_notice in summary input', async () => {
  const agent = createSummaryAgent('summary');
  const records = [
    { role: 'user', text: 'before' },
    { role: 'local_notice', text: '已中断模型回答' },
    ...buildRecords(30)
  ];

  const result = await runCompaction({ records, force: true, agent });

  assert.equal(result.didCompact, true);
  assert.doesNotMatch(agent.calls[0].records[1].text, /已中断模型回答/);
  assert.match(agent.calls[0].records[1].text, /before/);
});

test('runCompaction does not include local shell output in summary input', async () => {
  const agent = createSummaryAgent('summary');
  const records = [
    { role: 'user', text: 'before' },
    { role: 'shell', text: '$ env [local]\n\nSECRET=1', command: 'env', includeInContext: false, output: 'SECRET=1\n' },
    { role: 'shell', text: '$ pwd\n\n/workspace', command: 'pwd', includeInContext: true, output: '/workspace\n' },
    ...buildRecords(30)
  ];

  const result = await runCompaction({ records, force: true, agent });

  assert.equal(result.didCompact, true);
  assert.doesNotMatch(agent.calls[0].records[1].text, /SECRET=1/);
  assert.match(agent.calls[0].records[1].text, /\/workspace/);
});

test('runCompaction does not include reasoning summary in summary input', async () => {
  const agent = createSummaryAgent('summary');
  const records = [
    { role: 'user', text: 'before' },
    { role: 'reasoning_summary', text: 'I am thinking about hidden details.' },
    { role: 'tool_call', text: '', toolCallId: 'call_1', toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}' },
    { role: 'tool_result', text: 'exit_code: 0', toolCallId: 'call_1', toolName: 'run_bash_command', ok: true },
    ...buildRecords(30)
  ];

  const result = await runCompaction({ records, force: true, agent });

  assert.equal(result.didCompact, true);
  assert.doesNotMatch(agent.calls[0].records[1].text, /hidden details/);
  assert.match(agent.calls[0].records[1].text, /before/);
  assert.notEqual(records[result.compaction.activeStartIndex] && records[result.compaction.activeStartIndex].role, 'tool_result');
});

test('computeCompactionBoundary returns 0 when records are within K', () => {
  const records = [
    { role: 'user', text: 'u0' },
    { role: 'assistant', text: 'a0' }
  ];
  assert.equal(computeCompactionBoundary(records, 10), 0);
});

test('runCompaction force mode compacts and returns new state', async () => {
  const agent = createSummaryAgent('结构化摘要内容');
  const records = buildRecords(30);

  const result = await runCompaction({ records, force: true, agent });

  assert.equal(result.didCompact, true);
  assert.equal(result.reason, 'compacted');
  assert.equal(result.compaction.summaryText, '结构化摘要内容');
  assert.ok(result.compaction.activeStartIndex > 0);
  // force 模式不传 contextWindow 也不阻塞，且仍发起了一次摘要请求。
  assert.equal(agent.calls.length, 1);
});

test('runCompaction non-force below threshold does not compact', async () => {
  const agent = createSummaryAgent();
  const records = buildRecords(30);

  // 极大 contextWindow 使预估远低于阈值。
  const result = await runCompaction({ records, contextWindow: 1_000_000, force: false, agent });

  assert.equal(result.didCompact, false);
  assert.equal(result.reason, 'below_threshold');
  assert.equal(agent.calls.length, 0);
});

test('runCompaction returns no_boundary when records are too few', async () => {
  const agent = createSummaryAgent();
  const records = buildRecords(2);

  const result = await runCompaction({ records, force: true, agent });

  assert.equal(result.didCompact, false);
  assert.equal(result.reason, 'no_boundary');
  assert.equal(agent.calls.length, 0);
});

test('runCompaction passes abort signal to summary request', async () => {
  const agent = createSummaryAgent('summary');
  const controller = new AbortController();
  const records = buildRecords(30);

  const result = await runCompaction({ records, force: true, agent, abortSignal: controller.signal });

  assert.equal(result.didCompact, true);
  assert.equal(agent.calls[0].options.abortSignal, controller.signal);
});

test('runCompaction does not return compaction when summary returns after abort', async () => {
  const controller = new AbortController();
  const agent = {
    calls: [],
    async runTurn(records, callbacks, options) {
      this.calls.push({options, records});
      controller.abort();
      return { draft: 'late summary', toolCalls: [] };
    }
  };
  const records = buildRecords(30);

  await assert.rejects(
    () => runCompaction({ records, force: true, agent, abortSignal: controller.signal }),
    { name: 'AgentAbortError' }
  );
});

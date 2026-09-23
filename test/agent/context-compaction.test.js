const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeCompactionBoundary,
  createCompactionNoticeRecord,
  estimateContextTokens,
  estimateTextTokens,
  exceedsCompactionThreshold,
  runCompaction
} = require('../../src/agent/context/context-compaction');
const {buildProviderRequestPrefix} = require('../../src/agent/context/provider-request-prefix');

const SUMMARY_CWD = '/tmp/echo_tui';
const SUMMARY_SECTIONS = [
  '## Background and Goals',
  '## Key Decisions and Conclusions',
  '## Files and Paths Involved',
  '## To-Do Items',
  '## Important Tool Results'
];

/** 摘要请求前导统一经共享构造生成，与生产调用同源；不额外拼接任何拍平文本。 */
function buildSummaryPrefix(compaction) {
  return buildProviderRequestPrefix({
    agentInstructions: [{content: 'Keep answers short.', filePath: `${SUMMARY_CWD}/AGENTS.md`, label: '.', sourceKind: 'project'}],
    cwd: SUMMARY_CWD,
    memoryPrompts: ['## User-managed memories\nUse concise Chinese.'],
    ...(compaction ? {compaction} : {})
  });
}

/** 把一次摘要请求输入拼成文本，断言被压缩内容时不必逐条定位。 */
function joinSummaryInput(records) {
  return records.map((record) => record.text).join('\n');
}

function createSummaryAgent(summaryDraft = '结构化摘要内容', turnResult = {}) {
  const calls = [];
  return {
    calls,
    async runTurn(records, callbacks, options) {
      calls.push({options, records});
      return {draft: summaryDraft, toolCalls: [], ...turnResult};
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
  assert.equal(exceedsCompactionThreshold(60000, 100000, 0.6), false);
  assert.equal(exceedsCompactionThreshold(60001, 100000, 0.6), true);
});

test('createCompactionNoticeRecord renders compacted count only', () => {
  const record = createCompactionNoticeRecord({
    summaryText: 'summary',
    activeStartIndex: 7,
    createdAt: '2026-06-29T00:00:00.000Z'
  });

  assert.equal(record.role, 'compaction_notice');
  assert.equal(record.text, '已将较早的 7 条历史压缩为摘要');
});

test('runCompaction uses a custom threshold while force bypasses it', async () => {
  const records = buildRecords(30).map((record) => ({...record, text: 'abcdefghij'}));
  const belowAgent = createSummaryAgent();
  const below = await runCompaction({records, contextWindow: 100, thresholdRatio: 0.95, agent: belowAgent, promptPrefix: buildSummaryPrefix()});
  assert.equal(below.didCompact, false);
  assert.equal(belowAgent.calls.length, 0);

  const customAgent = createSummaryAgent();
  const custom = await runCompaction({records, contextWindow: 100, thresholdRatio: 0.5, agent: customAgent, promptPrefix: buildSummaryPrefix()});
  assert.equal(custom.didCompact, true);

  const forcedAgent = createSummaryAgent();
  const forced = await runCompaction({records, contextWindow: 100000, thresholdRatio: 0.95, force: true, agent: forcedAgent, promptPrefix: buildSummaryPrefix()});
  assert.equal(forced.didCompact, true);
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
    {role: 'subagent', text: 'ssss', agentName: 'explorer', parentToolCallId: 'outer', runId: 'run', event: {kind: 'assistant'}},
    { role: 'extension', text: '', extension: {kind: 'anthropic_thinking', block: anthropicThinkingBlock} },
    { role: 'assistant', text: 'bbbb' }
  ];
  const estimated = estimateContextTokens({ activeRecords });

  // Anthropic thinking 会回放给 provider，需要计入；本地提示不发给模型不计入。
  assert.equal(estimated, 2 + estimateTextTokens(JSON.stringify({kind: 'anthropic_thinking', block: anthropicThinkingBlock})));
});

test('computeCompactionBoundary counts provider-facing records before mapping to physical indices', () => {
  const records = [
    {role: 'user', text: 'old'},
    ...Array.from({length: 20}, (_, index) => ({
      role: 'subagent',
      text: `process ${index}`,
      agentName: 'explorer',
      parentToolCallId: 'outer',
      runId: 'run',
      event: {kind: 'assistant'}
    })),
    {role: 'assistant', text: 'recent one'},
    {role: 'user', text: 'recent two'}
  ];

  assert.equal(computeCompactionBoundary(records, 2), 21);
});

test('computeCompactionBoundary still protects an outer subagent tool pair', () => {
  const records = [
    {role: 'user', text: 'old'},
    {role: 'tool_call', text: 'run_subagent', toolCallId: 'outer', toolName: 'run_subagent', argumentsText: '{"agent":"explorer","task":"inspect"}'},
    {role: 'tool_result', text: 'report', toolCallId: 'outer', toolName: 'run_subagent', ok: true, details: {kind: 'generic'}},
    {role: 'assistant', text: 'recent'}
  ];

  assert.equal(computeCompactionBoundary(records, 2), 1);
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

test('computeCompactionBoundary keeps a trailing extension record on the active side', () => {
  const reasoningRecord = {role: 'extension', text: '', extension: {kind: 'openai_reasoning', item: {type: 'reasoning', encrypted_content: 'opaque'}}};
  const records = [
    {role: 'user', text: 'u0'},
    {role: 'assistant', text: 'a0'},
    reasoningRecord,
    {role: 'assistant', text: 'a1'},
    {role: 'user', text: 'u1'},
    {role: 'assistant', text: 'a2'}
  ];
  // keepCount=3 => 初始边界 3；若边界停在 extension 之后会把 reasoning 回传与其后续记录切开。
  const boundary = computeCompactionBoundary(records, 3);

  assert.equal(boundary, 2);
  assert.notEqual(records[boundary - 1].role, 'extension');
});

test('computeCompactionBoundary iterates extension snapping to a stable boundary', () => {
  const reasoningRecord = {role: 'extension', text: '', extension: {kind: 'anthropic_thinking', block: {type: 'redacted_thinking', data: 'opaque'}}};
  const records = [
    {role: 'user', text: 'u0'},
    {role: 'tool_call', text: '', toolCallId: 'c1', toolName: 'read_files', argumentsText: '{}'},
    {role: 'tool_result', text: 'r1', toolCallId: 'c1', toolName: 'read_files', ok: true, details: {kind: 'read_files', truncated: false}},
    reasoningRecord,
    {role: 'assistant', text: 'a1'},
    {role: 'user', text: 'u1'},
    {role: 'assistant', text: 'a2'}
  ];
  const boundary = computeCompactionBoundary(records, 3);

  // 初始边界落在 extension 与其后续 assistant 之间：向前吸附到该 extension 之前即稳定，工具配对保持同侧。
  assert.equal(boundary, 3);
  assert.notEqual(records[boundary - 1].role, 'extension');
  assert.equal(records.slice(boundary).includes(reasoningRecord), true);
  assert.equal(records.slice(0, boundary).some((record) => record.role === 'tool_call'), true);
  assert.equal(records.slice(0, boundary).some((record) => record.role === 'tool_result'), true);
});

test('computeCompactionBoundary keeps snapping across consecutive extension records', () => {
  const firstReasoning = {role: 'extension', text: '', extension: {kind: 'openai_reasoning', item: {type: 'reasoning', encrypted_content: 'first'}}};
  const secondReasoning = {role: 'extension', text: '', extension: {kind: 'openai_reasoning', item: {type: 'reasoning', encrypted_content: 'second'}}};
  const records = [
    {role: 'user', text: 'u0'},
    {role: 'assistant', text: 'a0'},
    firstReasoning,
    secondReasoning,
    {role: 'assistant', text: 'a1'},
    {role: 'user', text: 'u1'},
    {role: 'assistant', text: 'a2'}
  ];
  const boundary = computeCompactionBoundary(records, 3);

  // 单步吸附需连续执行两次，才能让两条 extension 都与其后续记录同处活跃区间。
  assert.equal(boundary, 2);
  assert.equal(records.slice(boundary).includes(firstReasoning), true);
  assert.equal(records.slice(boundary).includes(secondReasoning), true);
});

test('runCompaction sends the shared prefix, native compacted records, and a trailing instruction', async () => {
  const agent = createSummaryAgent('summary');
  const records = [
    {role: 'user', text: 'old user message'},
    {role: 'assistant', text: 'old assistant message'},
    ...buildRecords(30)
  ];
  const promptPrefix = buildSummaryPrefix();
  const result = await runCompaction({records, force: true, agent, promptPrefix, sessionId: 'session-1'});

  assert.equal(result.didCompact, true);

  const input = agent.calls[0].records;
  const compacted = records.slice(0, result.compaction.activeStartIndex);
  const instruction = input[input.length - 1];

  // 前导逐条一致 + 被压缩记录保持原生形态 + 末尾一条携带模板要求的指令 user 消息。
  assert.deepEqual(input.slice(0, promptPrefix.length), promptPrefix);
  assert.deepEqual(input.slice(promptPrefix.length, promptPrefix.length + compacted.length), compacted);
  assert.equal(input.length, promptPrefix.length + compacted.length + 1);
  assert.equal(instruction.role, 'user');
  for (const section of SUMMARY_SECTIONS) {
    assert.equal(instruction.text.includes(section), true);
  }
  assert.equal(joinSummaryInput(input).includes('[user] old user message'), false);
  assert.equal(agent.calls[0].options.isCompaction, true);
  assert.equal(agent.calls[0].options.sessionId, 'session-1');
  // 压缩摘要显式开启工具目录携带：与普通请求共享工具定义段前缀。
  assert.equal(agent.calls[0].options.includeToolDefinitions, true);
});

test('runCompaction omits sessionId when the session has no identity', async () => {
  const agent = createSummaryAgent('summary');
  const result = await runCompaction({records: buildRecords(30), force: true, agent, promptPrefix: buildSummaryPrefix()});

  assert.equal(result.didCompact, true);
  assert.equal('sessionId' in agent.calls[0].options, false);
});

test('runCompaction keeps extension records in the summary input', async () => {
  const agent = createSummaryAgent('summary');
  const thinkingRecord = {role: 'extension', text: '', extension: {kind: 'anthropic_thinking', block: {type: 'redacted_thinking', data: 'OPAQUE-THINKING'}}};
  const records = [
    {role: 'user', text: 'before'},
    thinkingRecord,
    {role: 'assistant', text: 'after'},
    ...buildRecords(30)
  ];
  const result = await runCompaction({records, force: true, agent, promptPrefix: buildSummaryPrefix()});

  assert.equal(result.didCompact, true);
  const input = agent.calls[0].records;

  // extension 随原生投影进入摘要输入，不被额外过滤，也不参与拍平文本。
  assert.equal(input.includes(thinkingRecord), true);
  assert.equal(input[input.length - 1].text.includes('OPAQUE-THINKING'), false);
});

test('runCompaction keeps the existing summary in place and does not embed it in the instruction', async () => {
  const agent = createSummaryAgent('updated summary');
  const compaction = {summaryText: 'EXISTING SUMMARY BODY', activeStartIndex: 4, createdAt: '2026-07-01T00:00:00.000Z'};
  const records = buildRecords(40);
  const promptPrefix = buildSummaryPrefix(compaction);
  const result = await runCompaction({records, compaction, force: true, agent, promptPrefix});

  assert.equal(result.didCompact, true);
  const input = agent.calls[0].records;
  const instruction = input[input.length - 1].text;

  assert.deepEqual(input.slice(0, promptPrefix.length), promptPrefix);
  assert.equal(input[1].role, 'user');
  assert.match(input[1].text, /EXISTING SUMMARY BODY/);
  assert.match(instruction, /existing summary/i);
  assert.equal(instruction.includes('EXISTING SUMMARY BODY'), false);
});

test('runCompaction returns the summary provider usage', async () => {
  const agent = createSummaryAgent('summary', {
    usage: {cacheReadInputTokens: 80, inputTokens: 100, outputTokens: 5},
    usageInputTokens: 100
  });
  const result = await runCompaction({records: buildRecords(30), force: true, agent, promptPrefix: buildSummaryPrefix()});

  assert.equal(result.didCompact, true);
  assert.deepEqual(result.usage, {cacheReadInputTokens: 80, inputTokens: 100, outputTokens: 5});
  assert.equal(result.usageInputTokens, 100);
});

test('runCompaction still returns usage when the summary is empty', async () => {
  const agent = createSummaryAgent('   ', {usage: {inputTokens: 42}, usageInputTokens: 42});
  const result = await runCompaction({records: buildRecords(30), force: true, agent, promptPrefix: buildSummaryPrefix()});

  assert.equal(result.didCompact, false);
  assert.equal(result.reason, 'no_boundary');
  assert.deepEqual(result.usage, {inputTokens: 42});
  assert.equal(result.usageInputTokens, 42);
});

test('runCompaction omits usage fields when no summary request happens', async () => {
  const agent = createSummaryAgent();
  const below = await runCompaction({records: buildRecords(30), contextWindow: 1_000_000, agent, promptPrefix: buildSummaryPrefix()});
  assert.equal(below.didCompact, false);
  assert.equal(below.reason, 'below_threshold');
  assert.equal('usage' in below, false);
  assert.equal('usageInputTokens' in below, false);

  const tooFew = await runCompaction({records: buildRecords(2), force: true, agent, promptPrefix: buildSummaryPrefix()});
  assert.equal(tooFew.didCompact, false);
  assert.equal(tooFew.reason, 'no_boundary');
  assert.equal('usage' in tooFew, false);
  assert.equal(agent.calls.length, 0);
});

test('runCompaction accepts non-empty summaries with non-template wording', async () => {
  const chinese = createSummaryAgent('## 背景与目标\n- 已完成探查。\n\n## 后续事项\n- 无。');
  const chineseResult = await runCompaction({records: buildRecords(30), force: true, agent: chinese, promptPrefix: buildSummaryPrefix()});

  assert.equal(chineseResult.didCompact, true);
  assert.equal(chineseResult.compaction.summaryText, '## 背景与目标\n- 已完成探查。\n\n## 后续事项\n- 无。');

  const freeform = createSummaryAgent('Earlier work established the compactor shape without template headings.');
  const freeformResult = await runCompaction({records: buildRecords(30), force: true, agent: freeform, promptPrefix: buildSummaryPrefix()});

  assert.equal(freeformResult.didCompact, true);
  assert.equal(freeformResult.compaction.summaryText, 'Earlier work established the compactor shape without template headings.');
});

test('runCompaction summarizes use_skill results when they leave active region', async () => {
  const agent = createSummaryAgent('## 重要工具结果\n- 使用了 review skill。');
  const records = [
    { role: 'user', text: 'review' },
    { role: 'tool_call', text: '', toolCallId: 'skill1', toolName: 'use_skill', argumentsText: '{"name":"review"}' },
    { role: 'tool_result', text: 'skill: review\n# Review Skill', toolCallId: 'skill1', toolName: 'use_skill', ok: true },
    ...buildRecords(30)
  ];

  const result = await runCompaction({ records, force: true, agent, promptPrefix: buildSummaryPrefix() });

  assert.equal(result.didCompact, true);
  assert.match(joinSummaryInput(agent.calls[0].records), /skill: review/);
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

  const result = await runCompaction({ records, force: true, agent, promptPrefix: buildSummaryPrefix() });

  assert.equal(result.didCompact, true);
  assert.match(joinSummaryInput(agent.calls[0].records), /Skill Invocation/);
  assert.match(result.compaction.summaryText, /review slash skill/);
});

test('runCompaction does not include local_notice in summary input', async () => {
  const agent = createSummaryAgent('summary');
  const records = [
    { role: 'user', text: 'before' },
    { role: 'local_notice', text: '已中断模型回答' },
    ...buildRecords(30)
  ];

  const result = await runCompaction({ records, force: true, agent, promptPrefix: buildSummaryPrefix() });

  assert.equal(result.didCompact, true);
  assert.doesNotMatch(joinSummaryInput(agent.calls[0].records), /已中断模型回答/);
  assert.match(joinSummaryInput(agent.calls[0].records), /before/);
});

test('runCompaction does not include local shell output in summary input', async () => {
  const agent = createSummaryAgent('summary');
  const records = [
    { role: 'user', text: 'before' },
    { role: 'shell', text: '$ env [local]\n\nSECRET=1', command: 'env', includeInContext: false, output: 'SECRET=1\n' },
    { role: 'shell', text: '$ pwd\n\n/workspace', command: 'pwd', includeInContext: true, output: '/workspace\n' },
    ...buildRecords(30)
  ];

  const result = await runCompaction({ records, force: true, agent, promptPrefix: buildSummaryPrefix() });

  assert.equal(result.didCompact, true);
  assert.doesNotMatch(joinSummaryInput(agent.calls[0].records), /SECRET=1/);
  assert.match(joinSummaryInput(agent.calls[0].records), /\/workspace/);
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

  const result = await runCompaction({ records, force: true, agent, promptPrefix: buildSummaryPrefix() });

  assert.equal(result.didCompact, true);
  assert.doesNotMatch(joinSummaryInput(agent.calls[0].records), /hidden details/);
  assert.match(joinSummaryInput(agent.calls[0].records), /before/);
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

  const result = await runCompaction({ records, force: true, agent, promptPrefix: buildSummaryPrefix() });

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
  const result = await runCompaction({ records, contextWindow: 1_000_000, force: false, agent, promptPrefix: buildSummaryPrefix() });

  assert.equal(result.didCompact, false);
  assert.equal(result.reason, 'below_threshold');
  assert.equal(agent.calls.length, 0);
});

test('runCompaction returns no_boundary when records are too few', async () => {
  const agent = createSummaryAgent();
  const records = buildRecords(2);

  const result = await runCompaction({ records, force: true, agent, promptPrefix: buildSummaryPrefix() });

  assert.equal(result.didCompact, false);
  assert.equal(result.reason, 'no_boundary');
  assert.equal(agent.calls.length, 0);
});

test('runCompaction passes abort signal to summary request', async () => {
  const agent = createSummaryAgent('summary');
  const controller = new AbortController();
  const records = buildRecords(30);

  const result = await runCompaction({ records, force: true, agent, promptPrefix: buildSummaryPrefix(), abortSignal: controller.signal });

  assert.equal(result.didCompact, true);
  assert.equal(agent.calls[0].options.abortSignal, controller.signal);
  assert.equal(agent.calls[0].options.isCompaction, true);
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
    () => runCompaction({ records, force: true, agent, promptPrefix: buildSummaryPrefix(), abortSignal: controller.signal }),
    { name: 'AgentAbortError' }
  );
});

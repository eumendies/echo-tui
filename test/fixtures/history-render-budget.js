// 纯合成的共享长历史：不读取 session、配置、时钟或随机数，所有工具内容只作为渲染数据。
const HISTORY_RENDER_BUDGET_FIXTURE_VERSION = 'history-render-budget-v1';

function markdownReport(id, paragraphCount = 3) {
  return [
    `## 合成报告 ${id}`,
    '',
    ...Array.from({length: paragraphCount}, (_, index) =>
      `段落 ${index + 1}：这是可公开分享的确定性历史。**完整消息块**应保留中文、ASCII、emoji 🌱 与 \`inline code\`。 ` +
      `Synthetic item ${id} checks wrapping, Markdown and UTF-8 output without any private session data.\n`),
    '| 项目 | 数值 | 说明 |',
    '| --- | ---: | --- |',
    ...Array.from({length: 6}, (_, index) => `| row-${index} | ${index * 17} | 固定表格内容 ${id} |`),
    '',
    '```typescript',
    ...Array.from({length: 16}, (_, index) => `const item${index} = {id: '${id}-${index}', enabled: ${index % 2 === 0}};`),
    '```',
    '',
    '- 保持原始顺序与工具调用身份。',
    '- 预算仅控制历史投影，不删除记录。',
    `> 合成结论 ${id}：不执行工具，不发起网络请求。`
  ].join('\n');
}

function subagentRecord(runId, text, event) {
  return {role: 'subagent', runId, parentToolCallId: `outer-${runId}`, agentName: 'explorer', text, event};
}

function outerPair(runId, report) {
  return [
    {role: 'tool_call', text: '', toolCallId: `outer-${runId}`, toolName: 'run_subagent',
      argumentsText: JSON.stringify({agent: 'explorer', task: `合成调查 ${runId}`})},
    {role: 'tool_result', text: report, toolCallId: `outer-${runId}`, toolName: 'run_subagent', ok: true,
      details: {kind: 'generic'}}
  ];
}

/** 生成独立的驻留快照；单委派报告与外层结果之间插入其他块，以覆盖不可拆的展示依赖区间。 */
function createHistoryRenderBudgetFixture({turnCount = 240} = {}) {
  if (!Number.isSafeInteger(turnCount) || turnCount < 1) throw new Error('turnCount must be a positive safe integer');
  const records = [];
  for (let turn = 0; turn < turnCount; turn += 1) {
    const id = String(turn).padStart(4, '0');
    records.push(
      {role: 'user', text: `合成请求 ${id}：检查代码、表格和工具结果，保留完整块。`, metadata: {interactionMode: turn % 2 ? 'plan' : 'normal'}},
      {role: 'system', text: `不可见系统信息 ${id}`},
      {role: 'extension', text: `不可见扩展 ${id}`, extension: {kind: 'unknown', name: 'synthetic-private', payload: {turn}}},
      {role: 'reasoning_summary', text: `合成推理摘要 ${id}：先检查输入，再整理结论。\n这里不是私人模型推理，也不进入 provider。`},
      {role: 'tool_call', text: '', toolCallId: `bash-${id}`, toolName: 'run_bash_command',
        argumentsText: JSON.stringify({command: `printf 'synthetic-${id}\\n'`})},
      {role: 'tool_result', text: `synthetic-${id}\n检查通过：仅为 fixture 数据。`, toolCallId: `bash-${id}`,
        toolName: 'run_bash_command', ok: true, details: {kind: 'bash', exitCode: 0, durationMs: 12}},
      {role: 'assistant', text: markdownReport(id, 2 + turn % 4)}
    );

    if (turn % 8 === 7) {
      const runId = `single-${id}`;
      const report = markdownReport(runId, 4);
      records.push(
        subagentRecord(runId, `合成调查 ${runId}`, {kind: 'start', task: `合成调查 ${runId}`}),
        subagentRecord(runId, '', {kind: 'tool_call', toolCallId: `inner-${id}`, toolName: 'read_files',
          argumentsText: JSON.stringify({files: [{path: `/fixture/${id}.ts`}]})}),
        subagentRecord(runId, `合成文件 ${id}\nexport const answer = 42;`, {kind: 'tool_result', toolCallId: `inner-${id}`,
          toolName: 'read_files', ok: true, details: {kind: 'read_files', truncated: false}}),
        subagentRecord(runId, '合成的可见过程摘要。', {kind: 'reasoning_summary'}),
        subagentRecord(runId, report, {kind: 'assistant'}),
        {role: 'assistant', text: `关联区间 ${id}：此块位于单委派报告和完成状态之间。`},
        subagentRecord(runId, '', {kind: 'completed', durationMs: 1234}),
        {role: 'assistant', text: `关联区间 ${id}：外层折叠结果仍依赖较早的过程报告。`},
        ...outerPair(runId, report)
      );
    }

    if (turn % 16 === 7) {
      const runIds = [`parallel-a-${id}`, `parallel-b-${id}`];
      // 交错过程模拟并行；主窗口应过滤 rail，只保留两个外层结果中的报告。
      for (const runId of runIds) records.push(subagentRecord(runId, `合成调查 ${runId}`, {kind: 'start', task: `合成调查 ${runId}`, parallelSize: 2}));
      for (const runId of runIds) records.push(subagentRecord(runId, markdownReport(runId, 2), {kind: 'assistant'}));
      for (const runId of runIds) records.push(subagentRecord(runId, '', {kind: 'completed', durationMs: 2345}));
      for (const runId of runIds) records.push(...outerPair(runId, markdownReport(runId, 2)));
    }

    if (turn % 24 === 23) {
      records.push(
        {role: 'shell', text: '$ synthetic-command\n固定的 shell 输出。', command: 'synthetic-command', output: '固定的 shell 输出。', exitCode: 0},
        {role: 'error', text: `合成本地错误 ${id}：用于显示测试，不代表实际失败。`},
        {role: 'local_notice', text: `合成通知 ${id}：历史保持完整。`}
      );
    }
  }

  const activeSubagentRunId = 'active-synthetic';
  records.push(
    subagentRecord(activeSubagentRunId, '合成的当前任务', {kind: 'start', task: '合成的当前任务'}),
    subagentRecord(activeSubagentRunId, '稳定过程已提交，内部调用仍由 footer 展示。', {kind: 'assistant'}),
    subagentRecord(activeSubagentRunId, '', {kind: 'tool_call', toolCallId: 'pending-synthetic', toolName: 'read_files',
      argumentsText: '{"files":[{"path":"/fixture/pending.ts"}]}'})
  );
  return {version: HISTORY_RENDER_BUDGET_FIXTURE_VERSION, turnCount, records, activeSubagentRunId};
}

module.exports = {HISTORY_RENDER_BUDGET_FIXTURE_VERSION, createHistoryRenderBudgetFixture};

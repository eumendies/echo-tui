const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const agentSetupModule = require('../../src/agent/agent-setup');
const {createSubagentLoopRuntime} = require('../../src/agent/loop-runtime/subagent-loop-runtime');
const {freezeSubagentDefinition} = require('../../src/agent/subagent/definition');
const {disabledObservation} = require('../../src/observation/observation');
const {createSkillManager} = require('../../src/skills/skill-manager');
const {captureSkillSnapshot} = require('../../src/skills/skill-snapshot');
const {createToolRegistry} = require('../../src/tools/tool-registry');

for (const kind of ['interactive', 'headless']) {
  test(`subagent compaction releases each prefix and keeps global boundaries in ${kind} continuation`, async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-subagent-compaction-'));
    const originalPrepareAgent = agentSetupModule.prepareAgent;
    const config = {
      agentType: 'fake', apiKey: '', model: 'fake', contextWindow: 20,
      tools: {bash: {timeoutMs: 1000, maxOutputBytes: 1024}, sandbox: {mode: 'off', network: false, extraWritablePaths: []}}
    };
    const requests = [];
    const summaries = [];
    const compactions = [];
    let turns = 0;
    const agent = {async runTurn(records, _callbacks, options) {
      if (options.isCompaction) {
        summaries.push(records);
        return {draft: `summary-${summaries.length}`, toolCalls: [], usageInputTokens: 1000};
      }
      requests.push(records);
      turns += 1;
      if (turns <= 2) return {
        draft: '',
        toolCalls: Array.from({length: 25}, (_, index) => ({callId: `batch-${turns}-${index}`, toolName: 'missing_tool', argumentsText: '{}'})),
        ...(turns === 1 ? {providerRecords: [{role: 'extension', text: '', extension: {kind: 'openai_reasoning', item: {type: 'reasoning', encrypted_content: 'old reasoning'}}}]} : {}),
        usageInputTokens: 1000
      };
      return {draft: 'done', toolCalls: []};
    }};
    try {
      agentSetupModule.prepareAgent = () => ({agent, config, registry: createToolRegistry([])});
      const inherited = {
        agentInstructions: [],
        memoryPrompt: {sections: [], estimatedTokens: 0, userMemoryCount: 0, agentMemory: {mode: 'none', text: '', estimatedTokens: 0, catalogCount: 0, itemCount: 0}},
        skillCatalogContextRatio: 0.02,
        skillSnapshot: captureSkillSnapshot(createSkillManager({cwd, builtinSkillsDir: path.join(cwd, 'builtin'), userSkillsDir: path.join(cwd, 'user')}))
      };
      const definition = freezeSubagentDefinition({name: 'explorer', description: 'investigate', effortPolicy: 'inherit', executionPolicy: 'readonly_investigation', includeMcpTools: false, localToolNames: ['read_files'], prompt: '# Explorer'});
      const diagnostics = [];
      const observation = {
        ...disabledObservation,
        compactionCompleted({compaction}) { compactions.push(compaction); },
        providerRequestBuilt({request}) { diagnostics.push({count: request.activeRecordCount, boundary: request.activeStartIndex}); }
      };
      const result = await createSubagentLoopRuntime(cwd, inherited, definition, observation)({
        configSnapshot: {revision: 1, resolveLlmConfig: () => config, getAppSettings: () => ({compactionThresholdRatio: 0.8})},
        executionMode: kind === 'interactive' ? {kind} : {kind, approvalPolicy: 'deny'},
        interactionMode: 'normal', metadata: {agentName: 'explorer', depth: 1, parentToolCallId: 'outer', runId: 'child'}, task: 'investigate'
      });
      assert.equal(result, 'done');
      assert.deepEqual(compactions.map((next) => next.activeStartIndex), [32, 83]);
      assert.deepEqual(diagnostics, [{count: 1, boundary: 0}, {count: 21, boundary: 32}, {count: 21, boundary: 83}]);
      for (let round = 1; round <= 2; round += 1) {
        const active = requests[round].slice(2);
        assert.equal(active[0].role, 'tool_call');
        assert.equal(active[0].toolCallId, `batch-${round}-15`);
        assert.equal(active.filter((record) => record.role === 'tool_result').length, 10);
        assert.equal(active.filter((record) => record.role === 'compaction_notice').length, 1);
        assert.equal(active.some((record) => record.role === 'extension'), false);
      }
      assert.equal(summaries[0].some((record) => record.role === 'extension'), true);
      assert.equal(summaries[1].some((record) => record.role === 'extension'), false);
      assert.equal(summaries[1].some((record) => record.toolCallId === 'batch-1-0'), false);
      assert.equal(summaries[1].some((record) => record.toolCallId === 'batch-1-15'), true);
      assert.equal(summaries[1][1].text.includes('summary-1'), true);
    } finally {
      agentSetupModule.prepareAgent = originalPrepareAgent;
      fs.rmSync(cwd, {recursive: true, force: true});
    }
  });
}

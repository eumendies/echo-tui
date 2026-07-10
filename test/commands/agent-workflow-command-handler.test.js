const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AgentWorkflowCommandHandler,
  parseAgentWorkflowText
} = require('../../src/commands/agent-workflows/agent-workflow-command-handler');

function createHost(interactionMode = 'normal') {
  const modeSelections = [];
  const transcriptAppends = [];
  let currentMode = interactionMode;

  return {
    modeSelections,
    transcriptAppends,
    host: {
      transcript: {
        append(record) {
          transcriptAppends.push(record);
        }
      },
      mode: {
        getInteractionMode() {
          return currentMode;
        },
        setInteractionMode(mode) {
          currentMode = mode;
          modeSelections.push(mode);
        }
      }
    }
  };
}

test('AgentWorkflowCommandHandler matches argument policy and preserves optional arguments', () => {
  const noneDefinition = {
    name: 'init',
    description: 'Initialize',
    argumentPolicy: 'none',
    modePolicy: 'preserve',
    createPrompt() {
      return 'init prompt';
    }
  };
  const optionalDefinition = {
    name: 'review',
    description: 'Review',
    argumentPolicy: 'optional',
    modePolicy: 'preserve',
    createPrompt({argumentsText}) {
      return `review:${argumentsText || 'all'}`;
    }
  };
  const initHandler = new AgentWorkflowCommandHandler(noneDefinition);
  const reviewHandler = new AgentWorkflowCommandHandler(optionalDefinition);

  assert.deepEqual(parseAgentWorkflowText('/init', noneDefinition), {});
  assert.equal(parseAgentWorkflowText('/init src', noneDefinition), null);
  assert.equal(initHandler.match('/init'), true);
  assert.equal(initHandler.match('/init src'), false);
  assert.equal(reviewHandler.match('/review'), true);
  assert.equal(reviewHandler.match('/review src/foo.ts'), true);

  const {host} = createHost();
  assert.deepEqual(reviewHandler.start('/review src/foo.ts', host), {
    kind: 'submit_user_message',
    text: 'review:src/foo.ts',
    historyText: '/review src/foo.ts',
    displayText: '/review src/foo.ts',
    metadata: {
      agentWorkflow: {
        source: 'builtin',
        name: 'review',
        argumentsText: 'src/foo.ts'
      }
    }
  });
});

test('AgentWorkflowCommandHandler switches plan to normal before returning the agent request', () => {
  const handler = new AgentWorkflowCommandHandler({
    name: 'init',
    description: 'Initialize',
    argumentPolicy: 'none',
    modePolicy: 'switch_plan_to_normal',
    createPrompt() {
      return 'init prompt';
    }
  });
  const plan = createHost('plan');
  const result = handler.start('/init', plan.host);

  assert.deepEqual(plan.modeSelections, ['normal']);
  assert.equal(plan.host.mode.getInteractionMode(), 'normal');
  assert.deepEqual(plan.transcriptAppends, [{role: 'local_notice', text: '已从 plan mode 切换到 normal mode 以运行 /init 流程。'}]);
  assert.deepEqual(result.metadata, {
    agentWorkflow: {
      source: 'builtin',
      name: 'init'
    }
  });

  const normal = createHost('normal');
  handler.start('/init', normal.host);
  assert.deepEqual(normal.modeSelections, []);
  assert.deepEqual(normal.transcriptAppends, []);
});

test('AgentWorkflowCommandHandler appends mode switch notice for any actual plan switch', () => {
  const handler = new AgentWorkflowCommandHandler({
    name: 'review',
    description: 'Review',
    argumentPolicy: 'optional',
    modePolicy: 'switch_plan_to_normal',
    createPrompt() {
      return 'review prompt';
    }
  });
  const plan = createHost('plan');

  handler.start('/review src/foo.ts', plan.host);

  assert.deepEqual(plan.modeSelections, ['normal']);
  assert.deepEqual(plan.transcriptAppends, [{role: 'local_notice', text: '已从 plan mode 切换到 normal mode 以运行 /review 流程。'}]);

  const normal = createHost('normal');
  handler.start('/review', normal.host);
  assert.deepEqual(normal.transcriptAppends, []);
});

test('AgentWorkflowCommandHandler returns not_matched when start receives invalid text', () => {
  const handler = new AgentWorkflowCommandHandler({
    name: 'init',
    description: 'Initialize',
    argumentPolicy: 'none',
    modePolicy: 'preserve',
    createPrompt() {
      return 'init prompt';
    }
  });

  assert.deepEqual(handler.start('/init extra', createHost().host), {kind: 'not_matched'});
});

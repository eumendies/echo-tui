const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {createConversationReferenceCommandPort} = require('../../src/app/command/conversation-reference-command-port');
const {ConversationReferenceContext} = require('../../src/app/state/conversation-reference-context');
const {UserConfigContext} = require('../../src/config/user-config-context');

test('conversation reference finalization uses the current turn model override', async () => {
  const originalHomedir = os.homedir;
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-reference-port-'));
  const configPath = path.join(homeDir, '.echo', 'config.json');
  fs.mkdirSync(path.dirname(configPath), {recursive: true});
  fs.writeFileSync(configPath, JSON.stringify({
    llm: {
      selectedModel: 'small',
      providers: {
        fake: {preset: 'fake-agent'}
      },
      models: [
        {id: 'small', provider: 'fake', model: 'echo-fake-small', contextWindow: 8_000},
        {id: 'large', provider: 'fake', model: 'echo-fake-large', contextWindow: 128_000}
      ]
    }
  }), 'utf8');
  os.homedir = () => homeDir;

  try {
    const conversationReferenceContext = new ConversationReferenceContext();
    conversationReferenceContext.setPending({
      materialText: '中'.repeat(8_000),
      projectionMode: 'summary',
      sourcePath: '/tmp/history.jsonl',
      sourceSessionId: 'history-id',
      title: 'history'
    });
    const appContext = {
      conversationReferenceContext,
      getCurrentCwd() {
        return '/tmp/project';
      },
      getInteractionMode() {
        return 'normal';
      },
      getAgentSession(overrides = {}) {
        return {
          modelProfileId: overrides.modelProfileIdOverride || 'small',
          ...(overrides.reasoningEffortOverride !== undefined
            ? {reasoningEffortOverride: overrides.reasoningEffortOverride}
            : {})
        };
      },
      turnContext: {
        startSpinner() {},
        stopSpinner() {},
        clearWorking() {}
      }
    };
    const port = createConversationReferenceCommandPort({
      appContext,
      renderFooter() {},
      userConfigContext: new UserConfigContext(),
      usageStore: {
        appendEvent() {
          throw new Error('full projection must not record provider usage');
        },
        listDailyUsage() {
          return [];
        }
      }
    });

    const result = await port.prepareForSubmission({modelProfileIdOverride: 'large', reasoningEffortOverride: 'high'});

    assert.equal(result.ok, true);
    assert.equal(result.reference.projectionMode, 'full');
    assert.equal(result.reference.projectionText.length, 8_000);
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(homeDir, {recursive: true, force: true});
  }
});

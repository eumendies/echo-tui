const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const {ComposerSubmissionController} = require('../../src/app/composer-submission-controller');
const composerOps = require('../../src/input/composer');
const {createAppContext} = require('./controller-test-helpers');

function createHarness(options = {}) {
  const appContext = createAppContext(options.cwd);
  const submissions = [];
  const commandTexts = [];
  const errors = [];
  let renders = 0;
  const controller = new ComposerSubmissionController({
    appContext,
    command: {
      hasActiveSession: options.hasActiveSession || (() => false),
      matches: options.matches || ((text) => text.startsWith('/')),
      startFromText(text, startOptions) {
        commandTexts.push(text);
        return options.startFromText ? options.startFromText(text, startOptions) : {kind: 'not_matched'};
      }
    },
    reference: {
      prepareForSubmission: options.prepareForSubmission || (async () => ({ok: false, reason: 'cancelled'}))
    },
    startAssistantTurn: options.startAssistantTurn || (async (submission) => {
      submissions.push(submission);
    }),
    submitShellCommand: async () => {},
    showReferenceError(error) {
      errors.push(error);
    },
    render() {
      renders += 1;
    }
  });

  return {appContext, commandTexts, controller, errors, getRenders: () => renders, submissions};
}

test('ComposerSubmissionController consumes one live draft and preserves a later draft', async () => {
  const harness = createHarness();
  harness.appContext.setMcpBootstrapStatus('ready');
  harness.appContext.composerContext.setText('first');

  await harness.controller.submitComposer();
  harness.appContext.composerContext.setText('later draft');

  assert.equal(harness.submissions.length, 1);
  assert.equal(harness.submissions[0].userText, 'first');
  assert.equal(composerOps.getText(harness.appContext.composerContext.composer), 'later draft');
  assert.deepEqual(harness.commandTexts, ['first']);
});

test('ComposerSubmissionController executes an allowed response-time command without using pending', async () => {
  const harness = createHarness({
    startFromText(text, options) {
      return text === '/status' && options?.duringAssistantTurn ? {kind: 'handled'} : {kind: 'not_matched'};
    }
  });
  harness.appContext.setMcpBootstrapStatus('ready');
  harness.appContext.turnContext.beginUserTurn('running');
  harness.appContext.turnContext.beginAssistantTurn();
  harness.appContext.composerContext.setText('/status');

  await harness.controller.submitComposer();

  assert.equal(harness.appContext.pendingMessageContext.getPending(), null);
  assert.equal(composerOps.getText(harness.appContext.composerContext.composer), '');
  assert.deepEqual(harness.commandTexts, ['/status']);
  assert.equal(harness.submissions.length, 0);
});

test('ComposerSubmissionController preserves a queued command while another command session is active', async () => {
  let activeSession = true;
  const harness = createHarness({
    hasActiveSession: () => activeSession,
    startFromText(text) {
      return text === '/config' ? {kind: 'handled'} : {kind: 'not_matched'};
    }
  });
  harness.appContext.pendingMessageContext.enqueue('/config');

  await harness.controller.dispatchPendingMessage();
  assert.equal(harness.appContext.pendingMessageContext.getPending(), '/config');
  assert.deepEqual(harness.commandTexts, []);

  activeSession = false;
  await harness.controller.dispatchPendingMessage();
  assert.equal(harness.appContext.pendingMessageContext.getPending(), null);
  assert.deepEqual(harness.commandTexts, ['/config']);
});

test('ComposerSubmissionController locks pending dispatch while asynchronous preparation is running', async () => {
  let release;
  let starts = 0;
  const blocked = new Promise((resolve) => { release = resolve; });
  const harness = createHarness({
    async startAssistantTurn(submission) {
      starts += 1;
      assert.equal(submission.userText, 'queued');
      await blocked;
    }
  });
  harness.appContext.pendingMessageContext.enqueue('queued');

  const first = harness.controller.dispatchPendingMessage();
  const second = harness.controller.dispatchPendingMessage();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(starts, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(starts, 1);
});

test('ComposerSubmissionController expands pending file mentions at dispatch time', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-controller-'));
  const harness = createHarness({cwd});
  harness.appContext.pendingMessageContext.enqueue('read @note.txt');
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'latest contents');

  await harness.controller.dispatchPendingMessage();

  assert.match(harness.submissions[0].userText, /latest contents/);
  assert.equal(harness.submissions[0].displayText, 'read @note.txt');
});

test('ComposerSubmissionController forwards image mention attachments', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-controller-image-'));
  const image = await sharp({create: {width: 2, height: 2, channels: 3, background: '#112233'}}).png().toBuffer();
  fs.writeFileSync(path.join(cwd, 'image.png'), image);
  const harness = createHarness({cwd});
  harness.appContext.pendingMessageContext.enqueue('inspect @image.png');

  await harness.controller.dispatchPendingMessage();

  assert.equal(harness.submissions[0].attachments.length, 1);
  assert.match(harness.submissions[0].userText, /\[image attached\]/);
});

test('ComposerSubmissionController restores composer and reports failed reference preparation', async () => {
  const harness = createHarness({
    prepareForSubmission: async () => ({ok: false, reason: 'failed', error: 'summary failed'})
  });
  harness.appContext.setMcpBootstrapStatus('ready');
  harness.appContext.conversationReferenceContext.setPending({
    projectionMode: 'full',
    sourcePath: '/tmp/session.jsonl',
    sourceSessionId: 'old-session',
    title: 'Old session',
    records: []
  });
  harness.appContext.composerContext.setText('continue');

  await harness.controller.submitComposer();

  assert.equal(composerOps.getText(harness.appContext.composerContext.composer), 'continue');
  assert.deepEqual(harness.errors, ['summary failed']);
  assert.equal(harness.getRenders(), 1);
});

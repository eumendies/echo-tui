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
  const shellCommands = [];
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
    submitShellCommand: async (text) => { shellCommands.push(text); },
    showReferenceError(error) {
      errors.push(error);
    },
    render() {
      renders += 1;
    }
  });

  return {appContext, commandTexts, controller, errors, getRenders: () => renders, shellCommands, submissions};
}

function tempDir(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-controller-'));
  t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
  return cwd;
}

function setFileDraft(harness, prefix, filePath) {
  const context = harness.appContext.composerContext;
  context.setText(prefix);
  const composer = context.composer;
  composerOps.replaceWithFileMentions(composer, composer.cursor, composer.cursor, [filePath]);
  composerOps.backspace(composer);
  return composerOps.captureSnapshot(composer);
}

test('ComposerSubmissionController consumes one live draft and preserves a later draft', async () => {
  const harness = createHarness();
  harness.appContext.setMcpBootstrapStatus('ready');
  harness.appContext.composerContext.setText('first');

  await harness.controller.submitComposer();
  harness.appContext.composerContext.setText('later draft');

  assert.equal(harness.submissions.length, 1);
  assert.equal(harness.submissions[0].userText, 'first');
  assert.equal(harness.submissions[0].userRequestText, 'first');
  assert.equal(composerOps.getText(harness.appContext.composerContext.composer), 'later draft');
  assert.deepEqual(harness.commandTexts, ['first']);
});

test('ComposerSubmissionController submits command results without re-parsing slash text', async () => {
  const harness = createHarness({
    startFromText() {
      throw new Error('slash parsing must be skipped for command results');
    }
  });
  harness.appContext.setMcpBootstrapStatus('ready');

  const submitted = await harness.controller.submitCommandMessage({
    text: '[MCP prompt: docs:code_review]\n\n[user]\nbody',
    displayText: '/docs:code_review code=1',
    metadata: {mcpPrompt: {server: 'docs', name: 'code_review', argumentsText: 'code=1'}}
  });

  assert.equal(submitted, true);
  assert.deepEqual(harness.commandTexts, []);
  assert.equal(harness.submissions.length, 1);
  assert.equal(harness.submissions[0].userText, '[MCP prompt: docs:code_review]\n\n[user]\nbody');
  assert.equal(harness.submissions[0].userRequestText, '[MCP prompt: docs:code_review]\n\n[user]\nbody');
  assert.equal(harness.submissions[0].displayText, '/docs:code_review code=1');
  assert.deepEqual(harness.submissions[0].metadata, {interactionMode: 'normal', mcpPrompt: {server: 'docs', name: 'code_review', argumentsText: 'code=1'}});
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

test('ComposerSubmissionController expands only pending A at dispatch time without borrowing live B', async (t) => {
  const cwd = tempDir(t);
  const harness = createHarness({cwd});
  harness.appContext.setMcpBootstrapStatus('ready');
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'old contents');
  fs.writeFileSync(path.join(cwd, 'other.txt'), 'LIVE B CONTENTS');
  harness.appContext.turnContext.beginUserTurn('running');
  const turn = harness.appContext.turnContext.beginAssistantTurn(undefined, 'pending');
  t.after(() => harness.appContext.turnContext.stopSpinner());
  const original = setFileDraft(harness, 'read ', 'note.txt');
  await harness.controller.submitComposer();
  assert.equal(harness.appContext.pendingMessageContext.getPending(), original.text);
  assert.equal(harness.submissions.length, 0);
  const later = setFileDraft(harness, 'later ', 'other.txt');
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'latest contents');
  harness.appContext.turnContext.finishAssistantTurn('done');
  harness.appContext.turnContext.clearAssistantTurnIfCurrent(turn);

  await harness.controller.dispatchPendingMessage();

  assert.equal(harness.submissions.length, 1);
  assert.match(harness.submissions[0].userText, /latest contents/);
  assert.doesNotMatch(harness.submissions[0].userText, /old contents|LIVE B CONTENTS/);
  assert.equal(harness.submissions[0].displayText, 'read @note.txt');
  assert.equal(harness.submissions[0].userRequestText, 'read @note.txt');
  assert.deepEqual(composerOps.captureSnapshot(harness.appContext.composerContext.composer), later);
  harness.appContext.composerContext.reset();
  assert.equal(harness.appContext.composerContext.browseHistory(-1), true);
  assert.deepEqual(harness.appContext.composerContext.composer.fileMentions, original.fileMentions);
});

test('ComposerSubmissionController forwards confirmed image mention attachments', async (t) => {
  const cwd = tempDir(t);
  const image = await sharp({create: {width: 2, height: 2, channels: 3, background: '#112233'}}).png().toBuffer();
  fs.writeFileSync(path.join(cwd, 'image.png'), image);
  const harness = createHarness({cwd});
  harness.appContext.setMcpBootstrapStatus('ready');
  setFileDraft(harness, 'inspect ', 'image.png');

  await harness.controller.submitComposer();

  assert.equal(harness.submissions[0].attachments.length, 1);
  assert.match(harness.submissions[0].userText, /\[image attached\]/);
  assert.equal(harness.submissions[0].userRequestText, 'inspect @image.png');
});

test('ComposerSubmissionController keeps slash command and conversation reference expansion out of userRequestText', async () => {
  const reference = {
    projectionMode: 'full',
    sourcePath: '/tmp/old.jsonl',
    sourceSessionId: 'old',
    title: 'Old session',
    materialSegments: [{kind: 'record', header: '[user]', text: 'history'}]
  };
  const harness = createHarness({
    startFromText(text) {
      return text === '/skill fix it'
        ? {kind: 'submit_user_message', text: '[Skill Instructions]\nprivate instructions\n[User Request]\nfix it', displayText: text}
        : {kind: 'not_matched'};
    },
    prepareForSubmission: async () => ({ok: true, reference: {...reference, projectionText: 'private referenced history'}})
  });
  harness.appContext.setMcpBootstrapStatus('ready');
  harness.appContext.conversationReferenceContext.setPending(reference);
  harness.appContext.composerContext.setText('/skill fix it');

  await harness.controller.submitComposer();

  assert.equal(harness.submissions[0].userRequestText, '/skill fix it');
  assert.match(harness.submissions[0].userText, /private instructions/);
  assert.match(harness.submissions[0].userText, /private referenced history/);
});

test('ComposerSubmissionController keeps workflow prompt expansion out of userRequestText', async () => {
  const harness = createHarness({
    startFromText(text) {
      return text === '/review focus security'
        ? {kind: 'submit_user_message', text: 'long internal review workflow prompt', displayText: text}
        : {kind: 'not_matched'};
    }
  });
  harness.appContext.setMcpBootstrapStatus('ready');
  harness.appContext.composerContext.setText('/review focus security');

  await harness.controller.submitComposer();

  assert.equal(harness.submissions[0].userRequestText, '/review focus security');
  assert.equal(harness.submissions[0].userText, 'long internal review workflow prompt');
});

test('ComposerSubmissionController forwards workflow run policies to the assistant turn', async () => {
  const harness = createHarness({
    startFromText(text) {
      return text === '/review'
        ? {kind: 'submit_user_message', text: 'review prompt', displayText: text, toolPolicy: 'readonly', sandboxModeOverride: 'read-only'}
        : {kind: 'not_matched'};
    }
  });
  harness.appContext.setMcpBootstrapStatus('ready');
  harness.appContext.composerContext.setText('/review');

  await harness.controller.submitComposer();

  assert.equal(harness.submissions.length, 1);
  assert.equal(harness.submissions[0].toolPolicy, 'readonly');
  assert.equal(harness.submissions[0].sandboxModeOverride, 'read-only');
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
    materialSegments: []
  });
  harness.appContext.composerContext.setText('continue');

  await harness.controller.submitComposer();

  assert.equal(composerOps.getText(harness.appContext.composerContext.composer), 'continue');
  assert.deepEqual(harness.errors, ['summary failed']);
  assert.equal(harness.getRenders(), 1);
});

test('ComposerSubmissionController leaves typed existing @ paths as ordinary text', async (t) => {
  const cwd = tempDir(t);
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'PRIVATE FILE CONTENTS');
  const harness = createHarness({cwd});
  harness.appContext.setMcpBootstrapStatus('ready');
  const text = 'email @note.txt and @missing.txt';
  harness.appContext.composerContext.setText(text);

  await harness.controller.submitComposer();

  assert.equal(harness.submissions[0].userText, text);
  assert.equal(harness.submissions[0].userRequestText, text);
  assert.equal(harness.submissions[0].attachments, undefined);
  assert.deepEqual(harness.appContext.composerContext.getInputHistory(), [text]);
});

test('ComposerSubmissionController pending plain A never borrows confirmed live B', async (t) => {
  const cwd = tempDir(t);
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'MUST NOT LEAK');
  const harness = createHarness({cwd});
  harness.appContext.setMcpBootstrapStatus('ready');
  harness.appContext.turnContext.beginUserTurn('running');
  const turn = harness.appContext.turnContext.beginAssistantTurn(undefined, 'pending');
  t.after(() => harness.appContext.turnContext.stopSpinner());
  harness.appContext.composerContext.setText('read @note.txt');
  await harness.controller.submitComposer();
  const later = setFileDraft(harness, 'read ', 'note.txt');
  harness.appContext.turnContext.finishAssistantTurn('done');
  harness.appContext.turnContext.clearAssistantTurnIfCurrent(turn);

  await harness.controller.dispatchPendingMessage();

  assert.equal(harness.submissions[0].userText, 'read @note.txt');
  assert.deepEqual(composerOps.captureSnapshot(harness.appContext.composerContext.composer), later);
});

test('ComposerSubmissionController pending slot refusal preserves confirmed draft and cursor', async (t) => {
  const harness = createHarness();
  harness.appContext.setMcpBootstrapStatus('ready');
  harness.appContext.turnContext.beginUserTurn('running');
  harness.appContext.turnContext.beginAssistantTurn(undefined, 'pending');
  t.after(() => harness.appContext.turnContext.stopSpinner());
  setFileDraft(harness, 'first ', 'first.txt');
  await harness.controller.submitComposer();
  setFileDraft(harness, 'second 👩‍💻 ', 'second.txt');
  harness.appContext.composerContext.composer.cursor = 2;
  const later = composerOps.captureSnapshot(harness.appContext.composerContext.composer);

  await harness.controller.submitComposer();

  assert.equal(harness.appContext.pendingMessageContext.getPending(), 'first @first.txt');
  assert.deepEqual(composerOps.captureSnapshot(harness.appContext.composerContext.composer), later);
  assert.deepEqual(harness.appContext.composerContext.getInputHistory(), ['first @first.txt']);
});

for (const reason of ['failed', 'cancelled']) {
  for (const liveState of ['empty', 'later', 'reset']) {
    test(`ComposerSubmissionController ${reason} reference preserves snapshot with ${liveState} live draft`, async (t) => {
      const cwd = tempDir(t);
      fs.writeFileSync(path.join(cwd, 'original.txt'), 'ORIGINAL');
      let release;
      let started;
      const preparing = new Promise((resolve) => { started = resolve; });
      const result = new Promise((resolve) => { release = resolve; });
      const harness = createHarness({cwd, prepareForSubmission() { started(); return result; }});
      harness.appContext.setMcpBootstrapStatus('ready');
      harness.appContext.conversationReferenceContext.setPending({
        projectionMode: 'full', sourcePath: '/tmp/old.jsonl', sourceSessionId: 'old', title: 'old', materialSegments: []
      });
      setFileDraft(harness, 'original 👩‍💻 ', 'original.txt');
      harness.appContext.composerContext.composer.cursor = 3;
      const original = composerOps.captureSnapshot(harness.appContext.composerContext.composer);
      const submitting = harness.controller.submitComposer();
      await preparing;
      let later;
      if (liveState !== 'empty') {
        setFileDraft(harness, 'later ', 'later.txt');
        harness.appContext.composerContext.composer.cursor = 1;
        later = composerOps.captureSnapshot(harness.appContext.composerContext.composer);
        if (liveState === 'reset') harness.appContext.composerContext.reset();
      }
      release({ok: false, reason, error: 'reference failed'});
      await submitting;

      assert.deepEqual(composerOps.captureSnapshot(harness.appContext.composerContext.composer), liveState === 'later' ? later : original);
      assert.deepEqual(harness.appContext.composerContext.getInputHistory(), [original.text]);
      assert.deepEqual(harness.appContext.composerContext.inputHistory, [original]);
      assert.equal(harness.submissions.length, 0);
      assert.deepEqual(harness.errors, reason === 'failed' ? ['reference failed'] : []);
    });
  }
}

for (const command of ['/review', '/skill']) {
  for (const confirmed of [false, true]) {
    test(`ComposerSubmissionController ${command} transformed text keeps only original confirmed refs (${confirmed})`, async (t) => {
      const cwd = tempDir(t);
      fs.writeFileSync(path.join(cwd, 'original.txt'), 'ORIGINAL MATERIAL');
      fs.writeFileSync(path.join(cwd, 'injected.txt'), 'INJECTED MATERIAL');
      const harness = createHarness({cwd, startFromText(text) {
        return {kind: 'submit_user_message', text: 'internal prompt @injected.txt', displayText: text};
      }});
      harness.appContext.setMcpBootstrapStatus('ready');
      if (confirmed) setFileDraft(harness, `${command} `, 'original.txt');
      else harness.appContext.composerContext.setText(`${command} @original.txt`);

      await harness.controller.submitComposer();

      const submission = harness.submissions[0];
      assert.equal(submission.userRequestText, `${command} @original.txt`);
      assert.equal(submission.displayText, `${command} @original.txt`);
      assert.doesNotMatch(submission.userText, /INJECTED MATERIAL/);
      if (confirmed) {
        assert.match(submission.userText, /ORIGINAL MATERIAL/);
        assert.match(submission.userText, /^internal prompt @injected.txt/);
      } else {
        assert.equal(submission.userText, 'internal prompt @injected.txt');
      }
    });
  }
}

test('ComposerSubmissionController submitCommandMessage never borrows live confirmed refs', async (t) => {
  const cwd = tempDir(t);
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'MUST NOT LEAK');
  const harness = createHarness({cwd});
  const live = setFileDraft(harness, 'draft ', 'note.txt');

  assert.equal(await harness.controller.submitCommandMessage({text: 'generated @note.txt', displayText: '/generated'}), true);

  assert.equal(harness.submissions[0].userText, 'generated @note.txt');
  assert.deepEqual(composerOps.captureSnapshot(harness.appContext.composerContext.composer), live);
  assert.deepEqual(harness.appContext.composerContext.getInputHistory(), []);
});

for (const route of ['shell', 'shell-local', 'handled']) {
  test(`ComposerSubmissionController ${route} skips confirmed file expansion`, async () => {
    const harness = createHarness({startFromText: () => ({kind: route === 'handled' ? 'handled' : 'not_matched'})});
    harness.appContext.setMcpBootstrapStatus('ready');
    if (route !== 'handled') harness.appContext.setInteractionMode(route);
    const original = setFileDraft(harness, route === 'handled' ? '/status ' : 'cat ', 'missing.txt');

    await harness.controller.submitComposer();

    assert.equal(harness.submissions.length, 0);
    assert.deepEqual(harness.errors, []);
    assert.deepEqual(harness.shellCommands, route === 'handled' ? [] : [original.text]);
    assert.equal(harness.appContext.composerContext.getText(), '');
    assert.equal(harness.appContext.composerContext.browseHistory(-1), true);
    assert.deepEqual(harness.appContext.composerContext.composer.fileMentions, original.fileMentions);
  });
}

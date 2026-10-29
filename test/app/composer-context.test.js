const test = require('node:test');
const assert = require('node:assert/strict');

const {ComposerContext} = require('../../src/app/state/composer-context');
const composerOps = require('../../src/input/composer');

function confirmedSnapshot(context, filePath = 'note.txt') {
  context.setText('read ');
  const composer = context.composer;
  composerOps.replaceWithFileMentions(composer, composer.cursor, composer.cursor, [filePath]);
  composerOps.backspace(composer);
  return composerOps.captureSnapshot(composer);
}

test('ComposerContext identical history text restores each entry own confirmation state', () => {
  const context = new ComposerContext(() => false);
  const confirmed = confirmedSnapshot(context);
  context.recordInput(confirmed);
  context.setText(confirmed.text);
  const plain = composerOps.captureSnapshot(context.composer);
  assert.deepEqual(plain.fileMentions, []);
  context.recordInput(plain);
  context.reset();

  assert.deepEqual(context.getInputHistory(), [confirmed.text, confirmed.text]);
  assert.equal(context.browseHistory(-1), true);
  assert.equal(context.getText(), confirmed.text);
  assert.deepEqual(context.composer.fileMentions, []);
  assert.equal(context.browseHistory(-1), true);
  assert.deepEqual(context.composer.fileMentions, confirmed.fileMentions);
  assert.equal(context.browseHistory(1), true);
  assert.equal(context.getText(), confirmed.text);
  assert.deepEqual(context.composer.fileMentions, []);
  assert.equal(context.browseHistory(1), true);
  assert.equal(context.getText(), '');
  assert.deepEqual(context.composer.fileMentions, []);
});

test('ComposerContext clones recorded snapshots and restores independent history edits', () => {
  const context = new ComposerContext(() => false);
  const input = confirmedSnapshot(context);
  context.composer.cursor = 1;
  const saved = composerOps.captureSnapshot(context.composer);
  const expected = structuredClone(saved);
  context.recordInput(saved);
  saved.text = 'changed';
  saved.cursor = 0;
  saved.fileMentions[0].path = 'changed.txt';
  saved.fileMentions.push({...saved.fileMentions[0]});
  confirmedSnapshot(context, 'later.txt');
  context.reset();

  assert.deepEqual(context.inputHistory, [expected]);
  assert.equal(context.browseHistory(-1), true);
  assert.equal(context.getText(), input.text);
  assert.deepEqual(context.composer.fileMentions, expected.fileMentions);
  assert.equal(context.composer.cursor, context.composer.chars.length);
  context.composer.fileMentions[0].path = 'mutated-live.txt';
  composerOps.insertText(context.composer, ' edited');
  assert.equal(context.browseHistory(1), true);
  assert.equal(context.browseHistory(-1), true);
  assert.deepEqual(context.composer.fileMentions, expected.fileMentions);
  assert.equal(context.getText(), expected.text);
  const exposedHistory = context.getInputHistory();
  exposedHistory[0] = 'mutated history';
  assert.deepEqual(context.getInputHistory(), [expected.text]);
});

test('ComposerContext snapshot retains A through live B set/reset and restores cursor without aliasing', () => {
  const context = new ComposerContext(() => false);
  confirmedSnapshot(context);
  context.composer.cursor = 2;
  const original = composerOps.captureSnapshot(context.composer);
  const expected = structuredClone(original);
  context.composer.fileMentions[0].path = 'changed-live.txt';
  confirmedSnapshot(context, 'later.txt');
  context.reset();

  assert.deepEqual(original, expected);
  composerOps.restoreSnapshot(context.composer, original);
  assert.deepEqual(composerOps.captureSnapshot(context.composer), expected);
  context.composer.fileMentions[0].path = 'changed-restored.txt';
  assert.deepEqual(original, expected);
});

test('ComposerContext plain snapshot history never confirms typed @ paths', () => {
  const context = new ComposerContext(() => false);
  context.setText('read @note.txt');
  context.recordInput(composerOps.captureSnapshot(context.composer));
  confirmedSnapshot(context);
  context.reset();

  assert.equal(context.browseHistory(-1), true);
  assert.equal(context.getText(), 'read @note.txt');
  assert.deepEqual(context.composer.fileMentions, []);
});

test('ComposerContext equal text with different confirmed subsets restores the selected entry only', () => {
  const context = new ComposerContext(() => false);
  confirmedSnapshot(context, 'first.txt');
  composerOps.insertText(context.composer, ' @second.txt');
  const first = composerOps.captureSnapshot(context.composer);
  context.recordInput(first);
  context.setText('read @first.txt ');
  composerOps.replaceWithFileMentions(context.composer, context.composer.cursor, context.composer.cursor, ['second.txt']);
  composerOps.backspace(context.composer);
  const second = composerOps.captureSnapshot(context.composer);
  context.recordInput(second);
  assert.equal(first.text, second.text);
  context.reset();

  assert.equal(context.browseHistory(-1), true);
  assert.deepEqual(context.composer.fileMentions, second.fileMentions);
  assert.equal(context.browseHistory(-1), true);
  assert.deepEqual(context.composer.fileMentions, first.fileMentions);
  assert.equal(context.browseHistory(1), true);
  assert.deepEqual(context.composer.fileMentions, second.fileMentions);
});

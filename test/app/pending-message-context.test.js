const test = require('node:test');
const assert = require('node:assert/strict');

const {PendingMessageContext} = require('../../src/app/state/pending-message-context');

test('PendingMessageContext stores one text value and rejects replacement', () => {
  const context = new PendingMessageContext();

  assert.equal(context.enqueue('first\nmessage'), true);
  assert.equal(context.enqueue('second'), false);
  assert.equal(context.getPending(), 'first\nmessage');
  assert.deepEqual(context.getRenderState(), {preview: 'first message'});
});

test('PendingMessageContext claims once and clears', () => {
  const context = new PendingMessageContext();

  assert.equal(context.enqueue('queued'), true);
  const claimed = context.claim();
  assert.equal(claimed, 'queued');
  assert.equal(context.claim(), null);
  assert.equal(context.getRenderState(), null);

  assert.equal(context.enqueue('replacement'), true);
  context.clear();
  assert.equal(context.getPending(), null);
  assert.equal(context.enqueue(''), false);
});

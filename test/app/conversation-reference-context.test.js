const test = require('node:test');
const assert = require('node:assert/strict');

const {ConversationReferenceContext} = require('../../src/app/state/conversation-reference-context');

function createReference(title = 'history') {
  return {
    materialText: '[user]\nold request',
    projectionMode: 'full',
    sourcePath: '/tmp/history.jsonl',
    sourceSessionId: 'history-id',
    title
  };
}

test('ConversationReferenceContext completes, replaces, clones, and clears one pending attachment', () => {
  const context = new ConversationReferenceContext();
  context.setPending(createReference('first'));
  const firstController = context.beginPreparation();
  assert.equal(context.isPreparing(), true);
  assert.equal(context.completePreparation(firstController), true);
  assert.deepEqual(context.getRenderState(), {preparing: false, projectionMode: 'full', title: 'first'});

  const returned = context.getPending();
  returned.title = 'mutated';
  assert.equal(context.getPending().title, 'first');

  context.setPending({...createReference('second'), projectionMode: 'summary'});
  assert.equal(context.getPending().title, 'second');
  assert.equal(context.getPending().projectionMode, 'summary');

  context.clearPending();
  assert.equal(context.getPending(), null);
});

test('ConversationReferenceContext cancellation isolates late completion', () => {
  const context = new ConversationReferenceContext();
  context.setPending(createReference());
  const controller = context.beginPreparation();
  assert.equal(context.getRenderState().preparing, true);

  assert.equal(context.cancelPreparation(), true);
  assert.equal(controller.signal.aborted, true);
  assert.equal(context.completePreparation(controller), false);
  assert.equal(context.getPending().title, 'history');
  assert.equal(context.cancelPreparation(), false);
});

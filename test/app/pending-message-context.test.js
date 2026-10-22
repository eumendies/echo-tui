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
  const claimed = context.claimForDispatch();
  assert.deepEqual(claimed, {text: 'queued'});
  assert.equal(context.claimForDispatch(), null);
  assert.equal(context.getRenderState(), null);

  assert.equal(context.enqueue('replacement'), true);
  context.clear();
  assert.equal(context.getPending(), null);
  assert.equal(context.enqueue(''), false);
});

const userRecord = (text) => ({role: 'user', text});

test('steering reserves the shared slot while preparing, failed and ready', () => {
  const context = new PendingMessageContext();
  const port = context.createSteeringInputPort(7);
  let notifications = 0;
  const unsubscribe = port.subscribe(() => { notifications += 1; });
  assert.equal(context.beginSteer('', 7), null);
  const id = context.beginSteer('first\n message', 7);
  assert.ok(id);
  assert.equal(context.enqueue('pending'), false);
  assert.equal(context.beginSteer('second', 7), null);
  assert.equal(context.claimForDispatch(), null);
  assert.equal(port.hasReady(), false);
  assert.deepEqual(context.getRenderState(), {preview: 'first message', status: 'preparing'});
  assert.equal(context.failPreparation(id, 'read failed'), true);
  assert.deepEqual(context.getRenderState(), {preview: 'first message', status: 'failed', error: 'read failed'});
  assert.equal(notifications, 0);
  assert.equal(context.claimForDispatch(), null);
  context.clear();
  assert.equal(context.completePreparation(id, userRecord('late')), false);
  assert.equal(context.failPreparation(id, 'late failure'), false);
  const readyId = context.beginSteer('next', 7);
  const record = userRecord('next expanded');
  assert.equal(context.completePreparation(readyId, record), true);
  assert.equal(notifications, 1);
  assert.equal(context.enqueue('replacement'), false);
  assert.deepEqual(context.getRenderState(), {preview: 'next', status: 'ready'});
  assert.equal(port.claim(), record);
  assert.equal(port.claim(), null);
  assert.equal(context.claimForDispatch(), null);
  unsubscribe();
  const last = context.beginSteer('last', 7);
  context.completePreparation(last, userRecord('last'));
  assert.equal(notifications, 1);
});

test('steering target isolation and old finally preserve the new turn and slot identity', () => {
  const context = new PendingMessageContext();
  const old = context.createSteeringInputPort(1);
  const oldId = context.beginSteer('old', 1);
  context.clear();
  const current = context.createSteeringInputPort(2);
  const id = context.beginSteer('current', 2);
  assert.equal(context.completePreparation(oldId, userRecord('late old')), false);
  context.completePreparation(id, userRecord('current'));
  context.finishTurn(1);
  assert.equal(old.hasReady(), false);
  assert.equal(old.claim(), null);
  assert.equal(current.hasReady(), true);
  assert.equal(context.getRenderState().status, 'ready');
  context.finishTurn(2);
  assert.equal(current.hasReady(), false);
  assert.equal(context.getRenderState().status, 'ready');
  assert.deepEqual(context.claimForDispatch(), {text: 'current', record: userRecord('current')});
  assert.equal(context.claimForDispatch(), null);
});

test('preparation crossing final stays owned by idle dispatch and never notifies another target', () => {
  const context = new PendingMessageContext();
  context.createSteeringInputPort(1);
  const id = context.beginSteer('file mention', 1);
  context.finishTurn(1);
  const next = context.createSteeringInputPort(2);
  let notified = false;
  next.subscribe(() => { notified = true; });
  assert.equal(context.claimForDispatch(), null);
  const record = userRecord('expanded once');
  context.completePreparation(id, record);
  assert.equal(notified, false);
  assert.equal(next.claim(), null);
  assert.deepEqual(context.claimForDispatch(), {text: 'file mention', record});
  assert.equal(context.getPending(), null);
});

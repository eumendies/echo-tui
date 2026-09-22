const assert = require('node:assert/strict');
const test = require('node:test');

const {ActiveInputResolver, createActiveInputRouting} = require('../../src/app/active-input-resolver');
const {INPUT_EVENTS} = require('../../src/input/event-types');

test('ActiveInputResolver returns the first active consumer and restores the next one', () => {
  let questionActive = true;
  let approvalActive = true;
  const resolver = new ActiveInputResolver([
    {
      id: 'question',
      isActive: () => questionActive,
      handleEvent: () => true,
      isModal: true,
      getSurface: () => ({kind: 'info', title: 'question', lines: [], dismissHint: 'Esc'})
    },
    {
      id: 'approval',
      isActive: () => approvalActive,
      handleEvent: () => true,
      isModal: true,
      getSurface: () => ({kind: 'info', title: 'approval', lines: [], dismissHint: 'Esc'})
    }
  ]);

  assert.equal(resolver.resolve().id, 'question');
  assert.equal(resolver.getActiveModalSurface().title, 'question');

  questionActive = false;
  assert.equal(resolver.resolve().id, 'approval');
  assert.equal(resolver.getActiveModalSurface().title, 'approval');

  approvalActive = false;
  assert.equal(resolver.resolve(), null);
  assert.equal(resolver.getActiveModalSurface(), null);
});

test('ActiveInputResolver exposes pass-through consumer results and matching pointer consumers', () => {
  const calls = [];
  const resolver = new ActiveInputResolver([{
    id: 'slash',
    isActive: () => true,
    handleEvent: (event) => {
      calls.push(event.type);
      return false;
    },
    handlePointer: (target, activate) => calls.push(`${target.kind}:${activate}`)
  }]);

  const consumer = resolver.resolve();
  assert.equal(consumer.handleEvent({type: INPUT_EVENTS.SUBMIT}), false);
  assert.equal(resolver.getPointerConsumer().id, 'slash');
  resolver.getPointerConsumer().handlePointer({kind: 'slash_suggestion', index: 0}, true);
  assert.deepEqual(calls, ['submit', 'slash_suggestion:true']);
  assert.equal(resolver.hasActiveExcept('slash'), false);
});

test('createActiveInputRouting keeps modal priority and exposes modal pointer semantics', () => {
  const calls = [];
  const routing = createActiveInputRouting({
    appContext: {},
    autoUpdate: {getSurface: () => null, handleEvent: () => false, hasActiveRequest: () => false},
    cancelReferencePreparation() {},
    command: {getSurface: () => null, handleEvent: () => undefined, hasActiveSession: () => false},
    dispatchPendingMessage: async () => {},
    exit() {},
    filePicker: {getSurface: () => null, handleEvent() {}, handlePointerEntry: () => false, hasActiveRequest: () => false},
    localSurface: {dismiss() {}, getSurface: () => null},
    render() {},
    subagentView: {handleEvent: () => false, isActive: () => false},
    toolApproval: {
      getSurface: () => ({kind: 'info', title: 'approval', lines: [], dismissHint: 'Esc'}),
      handleEvent: () => true,
      handlePointerOption: () => false,
      hasActiveRequest: () => true
    },
    userQuestion: {
      getSurface: () => ({kind: 'info', title: 'question', lines: [], dismissHint: 'Esc'}),
      handleEvent: () => true,
      handlePointerOption(index, activate) { calls.push(`option:${index}:${activate}`); return true; },
      handlePointerTab: () => false,
      hasActiveRequest: () => true
    }
  });

  assert.equal(routing.resolve().id, 'user-question');
  assert.equal(routing.getSurface('btw').title, 'question');
  routing.getPointerConsumer().handlePointer({kind: 'choice_option', index: 1, inlineInput: false}, true);
  assert.deepEqual(calls, ['option:1:true']);
});

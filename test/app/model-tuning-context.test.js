const test = require('node:test');
const assert = require('node:assert/strict');

const {ModelTuningContext} = require('../../src/app/state/model-tuning-context');

const MODEL_INFO = {
  models: [
    {id: 'fast', model: 'gpt-fast', provider: 'openai'},
    {id: 'deep', model: 'gpt-deep', provider: 'openai', reasoningEffort: 'high'}
  ],
  selectedIndex: 0
};

test('ModelTuningContext opens from model info without mutating the source', () => {
  const context = new ModelTuningContext();
  const source = structuredClone(MODEL_INFO);

  assert.equal(context.open(source), true);
  assert.deepEqual(source, MODEL_INFO);
  assert.deepEqual(context.getSelection(), {
    effort: 'medium',
    modelId: 'fast',
    originalModelId: 'fast'
  });
  assert.deepEqual(context.getRenderState(), {
    activeField: 'model',
    effort: 'medium',
    modelLabel: 'gpt-fast'
  });
});

test('ModelTuningContext rejects unavailable model info and cancels without a selection', () => {
  const context = new ModelTuningContext();

  assert.equal(context.open({error: 'unavailable'}), false);
  assert.equal(context.isActive(), false);
  assert.equal(context.getSelection(), null);

  assert.equal(context.open(MODEL_INFO), true);
  context.cancel();
  assert.equal(context.getSelection(), null);
});

test('ModelTuningContext cycles models and loads each profile effort', () => {
  const context = new ModelTuningContext();
  context.open(MODEL_INFO);

  context.cycle(1);
  assert.deepEqual(context.getSelection(), {
    effort: 'high',
    modelId: 'deep',
    originalModelId: 'fast'
  });

  context.cycle(1);
  assert.deepEqual(context.getSelection(), {
    effort: 'medium',
    modelId: 'fast',
    originalModelId: 'fast'
  });

  context.cycle(-1);
  assert.equal(context.getSelection().modelId, 'deep');
});

test('ModelTuningContext toggles fields and cycles all explicit efforts', () => {
  const context = new ModelTuningContext();
  context.open(MODEL_INFO);
  context.toggleField();

  assert.equal(context.getRenderState().activeField, 'effort');
  const efforts = [];
  for (let index = 0; index < 6; index += 1) {
    context.cycle(1);
    efforts.push(context.getSelection().effort);
  }
  assert.deepEqual(efforts, ['high', 'xhigh', 'max', 'none', 'low', 'medium']);
});

test('ModelTuningContext clears transient errors when selection changes', () => {
  const context = new ModelTuningContext();
  context.open(MODEL_INFO);
  context.setError('保存失败');
  assert.equal(context.getRenderState().error, '保存失败');

  context.toggleField();
  assert.equal(context.getRenderState().error, undefined);
});

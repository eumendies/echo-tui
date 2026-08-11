const assert = require('node:assert/strict');
const test = require('node:test');

const {TranscriptContext} = require('../../src/app/state/transcript-context');

function createCandidate(index, fingerprint = {size: index, mtimeMs: index}) {
  return {
    sessionId: `session-${index}`,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    cwd: '/tmp/example',
    messageCount: index,
    title: `session ${index}`,
    fingerprint
  };
}

function createContext(loads, text = (sessionId) => sessionId) {
  return new TranscriptContext({
    async loadSessionPreview(_cwd, sessionId) {
      loads.push(sessionId);
      return {sessionId, previewRecords: [{role: 'assistant', text: text(sessionId)}]};
    }
  }, () => '/tmp/example');
}

test('TranscriptContext bounds shared session preview LRU and invalidates by fingerprint', async () => {
  const loads = [];
  const context = createContext(loads);
  const candidates = Array.from({length: 6}, (_value, index) => createCandidate(index + 1));

  for (const candidate of candidates.slice(0, 5)) {
    await context.loadSessionPreview(candidate);
  }
  await context.loadSessionPreview(candidates[0]);
  await context.loadSessionPreview(candidates[5]);
  await context.loadSessionPreview(candidates[1]);
  await context.loadSessionPreview(createCandidate(1, {size: 99, mtimeMs: 99}));

  assert.deepEqual(loads, [
    'session-1', 'session-2', 'session-3', 'session-4', 'session-5',
    'session-6', 'session-2', 'session-1'
  ]);
});

test('TranscriptContext returns cloned cached session previews', async () => {
  const loads = [];
  const context = createContext(loads, () => 'saved');
  const candidate = createCandidate(1);
  const first = await context.loadSessionPreview(candidate);
  first.previewRecords[0].text = 'mutated';

  assert.deepEqual(await context.loadSessionPreview(candidate), {
    sessionId: 'session-1',
    previewRecords: [{role: 'assistant', text: 'saved'}]
  });
  assert.equal(await context.loadSessionPreview({...candidate, cwd: '/tmp/other'}), null);
  assert.deepEqual(loads, ['session-1']);
});

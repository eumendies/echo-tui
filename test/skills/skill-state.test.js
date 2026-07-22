const test = require('node:test');
const assert = require('node:assert/strict');

const {createSkillStateStore, readSkillStateFile} = require('../../src/skills/skill-state');

function readState(value) {
  return readSkillStateFile('/skills/skills.json', () => value);
}

test('skill state keeps version 1 disabled state and defaults strategy overrides', () => {
  assert.deepEqual(readState(JSON.stringify({
    schemaVersion: 1,
    disabled: [' review ', '']
  })), {
    schemaVersion: 3,
    disabled: ['review'],
    effortOverrides: {},
    modelOverrides: {}
  });
});

test('skill state normalizes disabled, model, and effort fields independently', () => {
  assert.deepEqual(readState(JSON.stringify({
    schemaVersion: 2,
    disabled: ['review'],
    modelOverrides: ['invalid']
  })), {
    schemaVersion: 3,
    disabled: ['review'],
    effortOverrides: {},
    modelOverrides: {}
  });

  assert.deepEqual(readState(JSON.stringify({
    schemaVersion: 2,
    disabled: 'invalid',
    effortOverrides: {
      review: 'none',
      deep: ' high ',
      unknown: 'extreme',
      broken: 42
    },
    modelOverrides: {
      review: ' fast ',
      broken: 42,
      empty: ''
    }
  })), {
    schemaVersion: 3,
    disabled: [],
    effortOverrides: {review: 'none'},
    modelOverrides: {review: 'fast'}
  });
});

test('skill state falls back to empty state when file content is corrupt', () => {
  assert.deepEqual(readState('{not-json'), {
    schemaVersion: 3,
    disabled: [],
    effortOverrides: {},
    modelOverrides: {}
  });
});

test('skill state writer sorts and preserves explicit none effort overrides', () => {
  let written = '';
  const store = createSkillStateStore({
    createTempPath: () => '/skills/skills.json.tmp',
    mkdir() {},
    rename() {},
    writeFile(_filePath, data) {
      written = data;
    }
  });

  store.writeState('/skills', {
    disabled: ['zeta', 'alpha', 'alpha'],
    effortOverrides: {zeta: 'high', alpha: 'none'},
    modelOverrides: {zeta: 'deep', alpha: 'fast'}
  });

  assert.deepEqual(JSON.parse(written), {
    schemaVersion: 3,
    disabled: ['alpha', 'zeta'],
    effortOverrides: {alpha: 'none', zeta: 'high'},
    modelOverrides: {alpha: 'fast', zeta: 'deep'}
  });
});

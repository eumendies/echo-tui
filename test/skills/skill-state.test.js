const test = require('node:test');
const assert = require('node:assert/strict');

const {readSkillStateFile} = require('../../src/skills/skill-state');

function readState(value) {
  return readSkillStateFile('/skills/skills.json', () => value);
}

test('skill state keeps version 1 disabled state and defaults model overrides', () => {
  assert.deepEqual(readState(JSON.stringify({
    schemaVersion: 1,
    disabled: [' review ', '']
  })), {
    schemaVersion: 2,
    disabled: ['review'],
    modelOverrides: {}
  });
});

test('skill state normalizes disabled and model fields independently', () => {
  assert.deepEqual(readState(JSON.stringify({
    schemaVersion: 2,
    disabled: ['review'],
    modelOverrides: ['invalid']
  })), {
    schemaVersion: 2,
    disabled: ['review'],
    modelOverrides: {}
  });

  assert.deepEqual(readState(JSON.stringify({
    schemaVersion: 2,
    disabled: 'invalid',
    modelOverrides: {
      review: ' fast ',
      broken: 42,
      empty: ''
    }
  })), {
    schemaVersion: 2,
    disabled: [],
    modelOverrides: {review: 'fast'}
  });
});

test('skill state falls back to empty state when file content is corrupt', () => {
  assert.deepEqual(readState('{not-json'), {
    schemaVersion: 2,
    disabled: [],
    modelOverrides: {}
  });
});

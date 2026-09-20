const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {getDefaultUpdateStatePath, readUpdateState, writeUpdateState} = require('../../src/update/update-state');

test('readUpdateState tolerates missing, malformed, and partially invalid files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-update-state-'));

  try {
    assert.deepEqual(readUpdateState(path.join(dir, 'missing.json')), {});

    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, '{broken');
    assert.deepEqual(readUpdateState(broken), {});

    const partial = path.join(dir, 'partial.json');
    fs.writeFileSync(partial, JSON.stringify({lastCheckedAt: 'yesterday', latestVersion: '1.4.5', ignoredVersion: 7, restartGuardAt: 'soon'}));
    assert.deepEqual(readUpdateState(partial), {latestVersion: '1.4.5'});

    const guarded = path.join(dir, 'guarded.json');
    fs.writeFileSync(guarded, JSON.stringify({restartGuardAt: 789}));
    assert.deepEqual(readUpdateState(guarded), {restartGuardAt: 789});

    const array = path.join(dir, 'array.json');
    fs.writeFileSync(array, JSON.stringify([1, 2]));
    assert.deepEqual(readUpdateState(array), {});
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('writeUpdateState replaces the state file under a freshly created directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-update-state-'));

  try {
    const statePath = path.join(dir, 'nested', 'update-state.json');
    writeUpdateState({lastCheckedAt: 123, latestVersion: '1.4.5', ignoredVersion: '1.4.0', restartGuardAt: 456}, statePath);

    assert.deepEqual(readUpdateState(statePath), {lastCheckedAt: 123, latestVersion: '1.4.5', ignoredVersion: '1.4.0', restartGuardAt: 456});
    assert.deepEqual(fs.readdirSync(path.join(dir, 'nested')), ['update-state.json']);

    writeUpdateState({lastCheckedAt: 456, latestVersion: '1.5.0'}, statePath);
    assert.deepEqual(readUpdateState(statePath), {lastCheckedAt: 456, latestVersion: '1.5.0'});
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('getDefaultUpdateStatePath points at the echo user directory', () => {
  assert.equal(getDefaultUpdateStatePath(), path.join(os.homedir(), '.echo', 'update-state.json'));
});

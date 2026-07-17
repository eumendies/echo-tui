const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {watchUserConfig} = require('../../src/config/user-config');

test('watchUserConfig observes atomic replacement of the user config file', async () => {
  const originalHomedir = os.homedir;
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-user-config-watcher-'));
  const configDirectory = path.join(homeDir, '.echo');
  const configPath = path.join(configDirectory, 'config.json');
  const tempPath = `${configPath}.tmp-test`;
  let watcher;

  fs.mkdirSync(configDirectory, {recursive: true});
  fs.writeFileSync(configPath, '{}\n', 'utf8');
  os.homedir = () => homeDir;

  try {
    const changed = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out waiting for config change')), 2000);

      watcher = watchUserConfig(() => {
        clearTimeout(timeout);
        resolve();
      });
    });

    fs.writeFileSync(tempPath, '{"llm": {}}\n', 'utf8');
    fs.renameSync(tempPath, configPath);
    await changed;
    assert.equal(fs.readFileSync(configPath, 'utf8'), '{"llm": {}}\n');
  } finally {
    watcher?.close();
    os.homedir = originalHomedir;
    fs.rmSync(homeDir, {recursive: true, force: true});
  }
});

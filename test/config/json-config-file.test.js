const test = require('node:test');
const assert = require('node:assert/strict');

const {
  JsonConfigFile,
  JsonConfigFileError
} = require('../../src/config/json-config-file');

function createReadError(code) {
  return () => {
    const error = new Error(code);
    error.code = code;
    throw error;
  };
}

test('JsonConfigFile classifies strict read failures and supports optional reads', () => {
  const missing = new JsonConfigFile('/tmp/echo/missing.json', {readFile: createReadError('ENOENT')});
  const invalidJson = new JsonConfigFile('/tmp/echo/invalid.json', {readFile: () => '{bad'});
  const invalidRoot = new JsonConfigFile('/tmp/echo/array.json', {readFile: () => '[]'});

  assert.throws(() => missing.read(), (error) => error instanceof JsonConfigFileError && error.kind === 'missing');
  assert.throws(() => invalidJson.read(), (error) => error instanceof JsonConfigFileError && error.kind === 'invalid_json');
  assert.throws(() => invalidRoot.read(), (error) => error instanceof JsonConfigFileError && error.kind === 'invalid_root');
  assert.deepEqual(missing.readOptional(), {});
  assert.deepEqual(invalidJson.readOptional(), {});
  assert.deepEqual(missing.readOrEmpty(), {});
});

test('JsonConfigFile update preserves current root fields and replaces the file atomically', () => {
  const targetPath = '/tmp/echo/config.json';
  const tempPath = `${targetPath}.tmp-test`;
  const writes = new Map();
  const mkdirs = [];
  const renames = [];
  const configFile = new JsonConfigFile(targetPath, {
    createTempPath: () => tempPath,
    mkdir(dirPath, options) {
      mkdirs.push([dirPath, options]);
    },
    readFile() {
      return JSON.stringify({unrelated: true, llm: {selectedModel: 'old'}});
    },
    rename(from, to) {
      renames.push([from, to]);
    },
    writeFile(filePath, data) {
      writes.set(filePath, data);
    }
  });

  configFile.update((rootConfig) => {
    rootConfig.llm.selectedModel = 'new';
  }, {allowMissing: false});

  assert.deepEqual(mkdirs, [['/tmp/echo', {recursive: true}]]);
  assert.deepEqual(renames, [[tempPath, targetPath]]);
  assert.deepEqual(JSON.parse(writes.get(tempPath)), {
    unrelated: true,
    llm: {selectedModel: 'new'}
  });
});

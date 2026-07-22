const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  capUtf8HeadText,
  capUtf8TailText,
  createOffloadedTextPreview,
  createToolResultStore
} = require('../../src/tools/tool-result-offloading');
const {createReadFilesToolHandler} = require('../../src/tools/read-files');
const {createGrepToolHandler} = require('../../src/tools/grep-tool-handler');
const {createToolExecutor} = require('../../src/tools/tool-executor');
const {createToolRegistry} = require('../../src/tools/tool-registry');

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'echo-tool-results-'));
}

function extractMarkerPath(text) {
  return text.match(/\[tool result truncated: ([^\]]+)\]/)?.[1];
}

function createFsImpl(overrides = {}) {
  return {
    mkdirSync: fs.mkdirSync,
    writeFileSync: fs.writeFileSync,
    renameSync: fs.renameSync,
    rmSync: fs.rmSync,
    openSync: fs.openSync,
    writeSync: fs.writeSync,
    closeSync: fs.closeSync,
    ...overrides
  };
}

test('tool result store writes atomically under the user-level cwd project partition', () => {
  const rootDir = createTempRoot();
  const cwd = path.join(rootDir, 'workspace');
  const store = createToolResultStore({cwd, rootDir});
  const result = store.writeText('complete result');
  const cwdHash = crypto.createHash('sha1').update(cwd).digest('hex');

  assert.equal(result.ok, true);
  assert.equal(result.path.startsWith(path.join(rootDir, 'projects', cwdHash, 'tool-results')), true);
  assert.equal(fs.readFileSync(result.path, 'utf8'), 'complete result');
  assert.equal(fs.statSync(result.path).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(result.path)).filter((name) => name.endsWith('.tmp')), []);
  assert.equal(fs.existsSync(path.join(cwd, '.echo')), false);
});

test('head and tail previews preserve UTF-8 boundaries and use one positional marker', () => {
  const rootDir = createTempRoot();
  const store = createToolResultStore({cwd: '/tmp/echo-preview', rootDir});
  const text = `HEAD-${'你'.repeat(10)}-TAIL`;
  const head = createOffloadedTextPreview({maxPreviewBytes: 11, strategy: 'head', store, text});
  const tail = createOffloadedTextPreview({maxPreviewBytes: 11, strategy: 'tail', store, text});
  const headPath = extractMarkerPath(head.text);
  const tailPath = extractMarkerPath(tail.text);

  assert.equal(head.truncated, true);
  assert.equal(tail.truncated, true);
  assert.equal(head.text.endsWith(`[tool result truncated: ${headPath}]`), true);
  assert.equal(tail.text.startsWith(`[tool result truncated: ${tailPath}]`), true);
  assert.doesNotMatch(head.text, /\uFFFD/);
  assert.doesNotMatch(tail.text, /\uFFFD/);
  assert.equal(fs.readFileSync(headPath, 'utf8'), text);
  assert.equal(fs.readFileSync(tailPath, 'utf8'), text);
  assert.equal((head.text.match(/tool result truncated/g) || []).length, 1);
  assert.equal((tail.text.match(/tool result truncated/g) || []).length, 1);
});

test('short previews do not create artifacts', () => {
  const rootDir = createTempRoot();
  const store = createToolResultStore({cwd: '/tmp/echo-short', rootDir});
  const result = createOffloadedTextPreview({maxPreviewBytes: 100, strategy: 'head', store, text: 'short'});

  assert.deepEqual(result, {text: 'short', truncated: false});
  assert.equal(fs.existsSync(path.join(rootDir, 'projects')), false);
});

test('artifact hard limits preserve a strict UTF-8 head and stop after the first omitted character', () => {
  const rootDir = createTempRoot();
  const store = createToolResultStore({cwd: '/tmp/echo-hard-cap', rootDir, maxArtifactBytes: 7});
  const textResult = store.writeText('你你你');
  const writer = store.createStreamWriter();

  writer.append('ab');
  writer.append('你你');
  writer.append('tail');
  const streamResult = writer.finish();

  assert.equal(textResult.ok, true);
  assert.equal(textResult.truncated, true);
  assert.equal(fs.readFileSync(textResult.path, 'utf8'), '你你');
  assert.equal(streamResult.ok, true);
  assert.equal(streamResult.truncated, true);
  assert.equal(fs.readFileSync(streamResult.path, 'utf8'), 'ab你');
  assert.equal(fs.statSync(streamResult.path).mode & 0o777, 0o600);
});

test('stream writers preserve UTF-8 characters split across buffer chunks', () => {
  const rootDir = createTempRoot();
  const store = createToolResultStore({cwd: '/tmp/echo-split-utf8', rootDir, maxArtifactBytes: 4});
  const writer = store.createStreamWriter();
  const encoded = Buffer.from('a你b', 'utf8');

  writer.append(encoded.subarray(0, 3));
  writer.append(encoded.subarray(3));
  const result = writer.finish();

  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.equal(fs.readFileSync(result.path, 'utf8'), 'a你');
  assert.doesNotMatch(fs.readFileSync(result.path, 'utf8'), /\uFFFD/);
});

test('offloading failure returns a bounded preview without an invalid marker', () => {
  const rootDir = createTempRoot();
  const blockingFile = path.join(rootDir, 'not-a-directory');
  fs.writeFileSync(blockingFile, 'block', 'utf8');
  const store = createToolResultStore({cwd: '/tmp/echo-failure', rootDir: blockingFile});
  const result = createOffloadedTextPreview({maxPreviewBytes: 4, strategy: 'tail', store, text: '123456789'});

  assert.deepEqual(result, {text: '6789', truncated: true});
  assert.doesNotMatch(result.text, /tool result truncated/);
});

test('stream write and atomic rename failures clean temporary artifacts', () => {
  const writeRoot = createTempRoot();
  const writeStore = createToolResultStore({
    cwd: '/tmp/echo-stream-write-failure',
    rootDir: writeRoot,
    fsImpl: createFsImpl({
      writeSync() {
        throw new Error('write failed');
      }
    })
  });
  const writer = writeStore.createStreamWriter();

  writer.append('content');
  assert.deepEqual(writer.finish(), {ok: false});
  assert.deepEqual(fs.readdirSync(path.join(writeRoot, 'projects'), {recursive: true}).filter((name) => String(name).endsWith('.tmp')), []);

  const renameRoot = createTempRoot();
  const renameStore = createToolResultStore({
    cwd: '/tmp/echo-rename-failure',
    rootDir: renameRoot,
    fsImpl: createFsImpl({
      renameSync() {
        throw new Error('rename failed');
      }
    })
  });
  const result = renameStore.writeText('content');

  assert.deepEqual(result, {ok: false});
  assert.deepEqual(fs.readdirSync(path.join(renameRoot, 'projects'), {recursive: true}).filter((name) => String(name).endsWith('.tmp')), []);
});

test('UTF-8 head and tail helpers never split multibyte characters', () => {
  assert.deepEqual(capUtf8HeadText('你a', 2), {text: '', truncated: true});
  assert.deepEqual(capUtf8HeadText('你a', 3), {text: '你', truncated: true});
  assert.deepEqual(capUtf8TailText('a你', 2), {text: '', truncated: true});
  assert.deepEqual(capUtf8TailText('a你', 3), {text: '你', truncated: true});
});

test('offloading artifacts are readable through read_files and searchable through grep', async () => {
  const rootDir = createTempRoot();
  const cwd = path.join(rootDir, 'workspace');
  fs.mkdirSync(cwd, {recursive: true});
  const store = createToolResultStore({cwd, rootDir});
  const written = store.writeText('alpha\nneedle value\nomega\n');
  const executor = createToolExecutor(createToolRegistry([
    createReadFilesToolHandler({cwd}),
    createGrepToolHandler({cwd})
  ]));
  const readResult = await executor.execute({
    callId: 'read_1',
    toolName: 'read_files',
    argumentsText: JSON.stringify({files: [{path: written.path, offset: 0, limit: 10}]})
  });
  const grepResult = await executor.execute({
    callId: 'grep_1',
    toolName: 'grep',
    argumentsText: JSON.stringify({pattern: 'needle', paths: [written.path]})
  });

  assert.equal(readResult.ok, true);
  assert.match(readResult.text, /needle value/);
  assert.equal(grepResult.ok, true);
  assert.match(grepResult.text, /needle value/);
});

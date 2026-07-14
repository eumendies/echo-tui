const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { HELP_TEXT, parseCliArgs, runCli } = require('../../src/cli/main');

test('parseCliArgs starts app only for the no-args path', () => {
  assert.deepEqual(parseCliArgs([]), {kind: 'start'});
});

test('parseCliArgs recognizes once prompts and full-access', () => {
  assert.deepEqual(parseCliArgs(['--once', 'explain', 'this', 'project']), {
    kind: 'once',
    fullAccess: false,
    prompt: 'explain this project'
  });
  assert.deepEqual(parseCliArgs(['--once', '--full-access', 'make', 'a', 'change']), {
    kind: 'once',
    fullAccess: true,
    prompt: 'make a change'
  });
  assert.deepEqual(parseCliArgs(['--once']), {kind: 'invalid', message: '--once requires a prompt'});
  assert.deepEqual(parseCliArgs(['--once', '   ']), {kind: 'invalid', message: '--once requires a prompt'});
  assert.deepEqual(parseCliArgs(['--full-access']), {kind: 'invalid', message: '--full-access can only be used with --once'});
});

test('help warns about full-access workspace and system changes', () => {
  assert.match(HELP_TEXT, /--once/);
  assert.match(HELP_TEXT, /workspace\/system/);
  assert.match(HELP_TEXT, /no transcript session or undo history/);
});

test('parseCliArgs recognizes help and version aliases', () => {
  assert.deepEqual(parseCliArgs(['--help']), {kind: 'help'});
  assert.deepEqual(parseCliArgs(['-h']), {kind: 'help'});
  assert.deepEqual(parseCliArgs(['--version']), {kind: 'version'});
  assert.deepEqual(parseCliArgs(['-v']), {kind: 'version'});
});

test('parseCliArgs reports unknown commands', () => {
  assert.deepEqual(parseCliArgs(['unknown']), {kind: 'unknown', command: 'unknown'});
});

test('parseCliArgs treats config and init as unknown commands', () => {
  assert.deepEqual(parseCliArgs(['config']), {kind: 'unknown', command: 'config'});
  assert.deepEqual(parseCliArgs(['init']), {kind: 'unknown', command: 'init'});
});

test('package metadata points echo-tui bin at built JavaScript output', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  const builtinThemeDir = path.join(process.cwd(), 'dist', 'src', 'config', 'themes');

  assert.equal(packageJson.bin['echo-tui'], 'dist/bin/echo-tui.js');
  assert.equal(fs.existsSync(path.join(process.cwd(), 'dist', 'bin', 'echo-tui.js')), true);
  assert.equal(fs.readFileSync(path.join(process.cwd(), 'dist', 'bin', 'echo-tui.js'), 'utf8').startsWith('#!/usr/bin/env node'), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'default.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'default-light.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'acid-lime.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'amber.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'aurora.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'crimson.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'desert.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'evergreen.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'frost.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'graphite.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'ink-wash.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'lagoon.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'lavender.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'macaron.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'monochrome.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'paper-dark.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'paper-light.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'plum-gold.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'porcelain.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'rose-dusk.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'solarized-light.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'spring-mist.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'sunbeam.json')), true);
  assert.equal(fs.existsSync(path.join(builtinThemeDir, 'violet.json')), true);
});

test('runCli bootstraps user setup only for normal TUI startup', async () => {
  const calls = [];
  const writes = [];
  const options = {
    argv: [],
    bootstrap() {
      calls.push('bootstrap');
    },
    runApp() {
      calls.push('run');
    },
    stdout: {write: (text) => writes.push(['stdout', text])},
    stderr: {write: (text) => writes.push(['stderr', text])}
  };

  assert.equal(await runCli(options), 0);
  assert.deepEqual(calls, ['bootstrap', 'run']);
  assert.deepEqual(writes, []);
});

test('runCli does not bootstrap help, version, or unknown command paths', async () => {
  for (const argv of [['--help'], ['--version'], ['config'], ['init']]) {
    const calls = [];
    const writes = [];
    const exitCode = await runCli({
      argv,
      bootstrap() {
        calls.push('bootstrap');
      },
      runApp() {
        calls.push('run');
      },
      stdout: {write: (text) => writes.push(['stdout', text])},
      stderr: {write: (text) => writes.push(['stderr', text])}
    });

    assert.deepEqual(calls, []);
    assert.equal(exitCode, argv[0].startsWith('-') ? 0 : 1);
    assert.equal(writes.length, 1);
  }
});

test('runCli reports bootstrap failure before starting TUI', async () => {
  const calls = [];
  const writes = [];
  const exitCode = await runCli({
    argv: [],
    bootstrap() {
      calls.push('bootstrap');
      throw new Error('permission denied');
    },
    runApp() {
      calls.push('run');
    },
    stdout: {write: (text) => writes.push(['stdout', text])},
    stderr: {write: (text) => writes.push(['stderr', text])}
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(calls, ['bootstrap']);
  assert.deepEqual(writes, [['stderr', 'Failed to initialize echo-tui user setup: permission denied\n']]);
});

test('runCli bootstraps and awaits one-shot execution', async () => {
  const calls = [];
  const stdout = {write: (text) => calls.push(['stdout', text])};
  const stderr = {write: (text) => calls.push(['stderr', text])};

  const exitCode = await runCli({
    argv: ['--once', '--full-access', 'hello', 'world'],
    bootstrap() {
      calls.push(['bootstrap']);
    },
    runOnce: async (options) => {
      calls.push(['once', options.prompt, options.fullAccess, options.stdout === stdout]);
    },
    stdout,
    stderr
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [
    ['bootstrap'],
    ['once', 'hello world', true, true]
  ]);
});

test('runCli reports one-shot bootstrap and execution failures', async () => {
  const writes = [];
  const stderr = {write: (text) => writes.push(text)};

  assert.equal(await runCli({
    argv: ['--once', 'hello'],
    bootstrap() {
      throw new Error('bootstrap failed');
    },
    stderr
  }), 1);
  assert.match(writes[0], /Failed to run echo-tui once: bootstrap failed/);

  writes.length = 0;
  assert.equal(await runCli({
    argv: ['--once', 'hello'],
    bootstrap() {},
    runOnce: async () => {
      throw new Error('provider failed');
    },
    stderr
  }), 1);
  assert.match(writes[0], /Failed to run echo-tui once: provider failed/);
});

test('postinstall script is best-effort and uses compiled bootstrap module', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

  assert.equal(packageJson.scripts.postinstall, "node -e \"try{require('./dist/src/config/postinstall-user-setup.js')}catch{}\"");
  assert.equal(HELP_TEXT.includes('echo-tui config'), false);
});

test('npm start remains non-debug while npm start:debug enables debug on built output', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

  assert.equal(packageJson.scripts.start, 'npm run build && node dist/bin/echo-tui.js');
  assert.equal(packageJson.scripts['start:debug'], 'npm run build && ECHO_TUI_DEBUG=1 node dist/bin/echo-tui.js');
});

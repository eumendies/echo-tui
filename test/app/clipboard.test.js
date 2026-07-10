const test = require('node:test');
const assert = require('node:assert/strict');

const {getClipboardCommands, runClipboardCommand} = require('../../src/app/clipboard');

test('getClipboardCommands returns platform-specific clipboard commands', () => {
  assert.deepEqual(getClipboardCommands('darwin'), [{command: 'pbcopy', args: []}]);
  assert.deepEqual(getClipboardCommands('win32'), [{command: 'clip', args: []}]);
  assert.deepEqual(getClipboardCommands('linux'), [
    {command: 'wl-copy', args: []},
    {command: 'xclip', args: ['-selection', 'clipboard']},
    {command: 'xsel', args: ['--clipboard', '--input']}
  ]);
});

test('runClipboardCommand normalizes success and failure results', async () => {
  const success = await runClipboardCommand({
    command: process.execPath,
    args: ['-e', 'process.stdin.resume(); process.stdin.on("end", () => process.exit(0));']
  }, 'hello');
  assert.deepEqual(success, {ok: true});

  const failure = await runClipboardCommand({
    command: process.execPath,
    args: ['-e', 'process.stderr.write("bad clipboard"); process.exit(7);']
  }, 'hello');
  assert.equal(failure.ok, false);
  assert.match(failure.error, /bad clipboard/);
});

test('runClipboardCommand reports missing command as a structured failure', async () => {
  const result = await runClipboardCommand({command: 'echo-tui-missing-clipboard-command', args: []}, 'hello');

  assert.equal(result.ok, false);
  assert.match(result.error, /echo-tui-missing-clipboard-command/);
});

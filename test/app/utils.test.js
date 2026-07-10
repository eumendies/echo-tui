const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { expandFileMentionsForUserText } = require('../../src/app/utils');

test('expandFileMentionsForUserText keeps selected file context focused on useful content', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-file-context-'));
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'alpha\nbeta\n');

  const expanded = await expandFileMentionsForUserText('总结 @note.txt', cwd);

  assert.match(expanded.text, /<selected_files>/);
  assert.match(expanded.text, /--- selected_file: note\.txt/);
  assert.match(expanded.text, /1 │ alpha/);
  assert.match(expanded.text, /2 │ beta/);
  assert.doesNotMatch(expanded.text, /offset:/);
  assert.doesNotMatch(expanded.text, /limit:/);
  assert.doesNotMatch(expanded.text, /has_more:/);
  assert.doesNotMatch(expanded.text, /content_truncated:/);
  assert.doesNotMatch(expanded.text, /returned_lines:/);
});

test('expandFileMentionsForUserText formats directory mentions as bounded direct entries', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-directory-context-'));
  fs.mkdirSync(path.join(cwd, 'src', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'src', 'main.ts'), 'export const main = true;\n');

  const expanded = await expandFileMentionsForUserText('查看 @src', cwd);

  assert.match(expanded.text, /--- selected_directory: src/);
  assert.match(expanded.text, /direct_entries:/);
  assert.match(expanded.text, /src\/main\.ts; file; size_bytes:/);
  assert.match(expanded.text, /src\/nested; directory/);
  assert.doesNotMatch(expanded.text, /unavailable/);
  assert.doesNotMatch(expanded.text, /effective_limit:/);
  assert.doesNotMatch(expanded.text, /total_entries:/);
  assert.doesNotMatch(expanded.text, /recursive:/);
});

test('expandFileMentionsForUserText marks omitted directory entries without verbose metadata', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-directory-context-large-'));
  const directory = path.join(cwd, 'large');
  fs.mkdirSync(directory);

  for (let index = 0; index < 201; index += 1) {
    fs.writeFileSync(path.join(directory, `file-${String(index).padStart(3, '0')}.txt`), String(index));
  }

  const expanded = await expandFileMentionsForUserText('查看 @large', cwd);

  assert.match(expanded.text, /\[additional direct entries omitted\]/);
  assert.doesNotMatch(expanded.text, /has_more:/);
  assert.doesNotMatch(expanded.text, /limit_capped:/);
});

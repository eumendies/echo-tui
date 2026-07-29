const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

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

test('expandFileMentionsForUserText compresses oversized image mentions once and honors the disabled setting', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-image-context-'));
  const width = 1_500;
  const height = 1_500;
  const pixels = Buffer.allocUnsafe(width * height * 3);
  let value = 0x12345678;

  for (let index = 0; index < pixels.length; index += 1) {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    pixels[index] = value & 0xff;
  }

  const imageBytes = await sharp(pixels, {raw: {width, height, channels: 3}}).png().toBuffer();
  assert.ok(imageBytes.length > 5_000_000);
  fs.writeFileSync(path.join(cwd, 'large.png'), imageBytes);

  const compressed = await expandFileMentionsForUserText('比较 @large.png 和 @large.png', cwd, {autoCompressImages: true});
  const disabled = await expandFileMentionsForUserText('查看 @large.png', cwd, {autoCompressImages: false});

  assert.equal(compressed.attachments.length, 1);
  assert.ok(compressed.attachments[0].sizeBytes <= 5_000_000);
  assert.match(compressed.text, /--- selected_file: large\.png\n\[image attached\]/);
  assert.equal(disabled.attachments, undefined);
  assert.match(disabled.text, /image exceeds max size/);
});

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

  const expanded = await expandFileMentionsForUserText('总结 @note.txt', cwd, {autoCompressImages: true, paths: ['note.txt']});

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

  const expanded = await expandFileMentionsForUserText('查看 @src', cwd, {autoCompressImages: true, paths: ['src']});

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

  const expanded = await expandFileMentionsForUserText('查看 @large', cwd, {autoCompressImages: true, paths: ['large']});

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

  const compressed = await expandFileMentionsForUserText('比较 @large.png 和 @large.png', cwd, {autoCompressImages: true, paths: ['large.png', 'large.png']});
  const disabled = await expandFileMentionsForUserText('查看 @large.png', cwd, {autoCompressImages: false, paths: ['large.png']});

  assert.equal(compressed.attachments.length, 1);
  assert.ok(compressed.attachments[0].sizeBytes <= 5_000_000);
  assert.match(compressed.text, /--- selected_file: large\.png\n\[image attached\]/);
  assert.equal(disabled.attachments, undefined);
  assert.match(disabled.text, /image exceeds max size/);
});

test('expandFileMentionsForUserText leaves existing and missing path text untouched without confirmed paths', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-unconfirmed-context-'));
  t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'must not be attached');
  fs.writeFileSync(path.join(cwd, 'my note.txt'), 'quoted path must not be attached');
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.writeFileSync(path.join(cwd, 'broken.pdf'), '%PDF-1.4\nbroken');
  const text = '手写或粘贴 @note.txt @"my note.txt" @src @broken.pdf @missing.txt user@example.com';
  const stat = t.mock.method(fs, 'statSync', fs.statSync);
  const read = t.mock.method(fs, 'readFileSync', fs.readFileSync);
  const stream = t.mock.method(fs, 'createReadStream', fs.createReadStream);
  const list = t.mock.method(fs, 'readdirSync', fs.readdirSync);

  assert.deepEqual(await expandFileMentionsForUserText(text, cwd), {text});
  assert.deepEqual(await expandFileMentionsForUserText(text, cwd, {autoCompressImages: false}), {text});
  assert.deepEqual(await expandFileMentionsForUserText(text, cwd, {autoCompressImages: true, paths: []}), {text});
  assert.equal(stat.mock.callCount(), 0);
  assert.equal(read.mock.callCount(), 0);
  assert.equal(stream.mock.callCount(), 0);
  assert.equal(list.mock.callCount(), 0);
});

test('expandFileMentionsForUserText uses explicit quoted and punctuation paths without parsing surrounding text', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-explicit-path-context-'));
  t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
  const paths = Object.freeze(['my note.txt', '报告@v1,终版(修订).txt']);
  fs.writeFileSync(path.join(cwd, paths[0]), 'quoted content');
  fs.writeFileSync(path.join(cwd, paths[1]), 'punctuation content');
  const text = '查看 @"my note.txt"，然后 @报告@v1,终版(修订).txt请检查。';

  const expanded = await expandFileMentionsForUserText(text, cwd, {autoCompressImages: true, paths});

  assert.ok(expanded.text.startsWith(`${text}\n\n<selected_files>\n`));
  assert.ok(expanded.text.includes(`--- selected_file: ${paths[0]}\n`));
  assert.ok(expanded.text.includes(`--- selected_file: ${paths[1]}\n`));
  assert.match(expanded.text, /1 │ quoted content/);
  assert.match(expanded.text, /1 │ punctuation content/);
  assert.equal(expanded.errors, undefined);
});

test('expandFileMentionsForUserText expands only the selected paths for the same input text', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-selected-path-context-'));
  t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'only alpha');
  fs.writeFileSync(path.join(cwd, 'b.txt'), 'only beta');
  const text = '比较 @a.txt @b.txt @a.txt @missing.txt';
  const stat = t.mock.method(fs, 'statSync', fs.statSync);
  const stream = t.mock.method(fs, 'createReadStream', fs.createReadStream);

  const alpha = await expandFileMentionsForUserText(text, cwd, {autoCompressImages: true, paths: ['a.txt', 'a.txt']});
  const beta = await expandFileMentionsForUserText(text, cwd, {autoCompressImages: true, paths: ['b.txt']});

  assert.deepEqual(stat.mock.calls.map((call) => call.arguments[0]), [path.join(cwd, 'a.txt'), path.join(cwd, 'b.txt')]);
  assert.deepEqual(stream.mock.calls.map((call) => call.arguments[0]), [path.join(cwd, 'a.txt'), path.join(cwd, 'b.txt')]);
  assert.equal(alpha.text.split('--- selected_file: a.txt\n').length - 1, 1);
  assert.match(alpha.text, /only alpha/);
  assert.doesNotMatch(alpha.text, /only beta|--- selected_file: b\.txt|unavailable/);
  assert.match(beta.text, /--- selected_file: b\.txt\n/);
  assert.match(beta.text, /only beta/);
  assert.doesNotMatch(beta.text, /only alpha|--- selected_file: a\.txt|unavailable/);
  assert.equal(alpha.errors, undefined);
  assert.equal(beta.errors, undefined);
  assert.ok(alpha.text.startsWith(`${text}\n`));
  assert.ok(beta.text.startsWith(`${text}\n`));
});

test('expandFileMentionsForUserText reports missing and unsupported explicit paths without requiring at text', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-path-error-context-'));
  t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
  fs.writeFileSync(path.join(cwd, 'removed.txt'), 'selected before deletion');
  fs.unlinkSync(path.join(cwd, 'removed.txt'));
  fs.writeFileSync(path.join(cwd, 'clip.mp4'), Buffer.from([0, 1, 2, 3]));

  const expanded = await expandFileMentionsForUserText('检查已确认的素材', cwd, {
    autoCompressImages: true,
    paths: ['removed.txt', 'clip.mp4']
  });

  assert.match(expanded.text, /--- selected_file: removed\.txt\n\[unavailable: .*ENOENT/);
  assert.match(expanded.text, /--- selected_file: clip\.mp4\n\[unavailable: unsupported media type\]/);
  assert.equal(expanded.errors.length, 2);
  assert.match(expanded.errors[0], /^removed\.txt: .*ENOENT/);
  assert.equal(expanded.errors[1], 'clip.mp4: unsupported media type');
  assert.equal(expanded.attachments, undefined);
});

test('expandFileMentionsForUserText extracts an explicitly selected PDF as text', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-pdf-context-'));
  t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
  const content = 'BT /F1 12 Tf 72 720 Td (Confirmed PDF content) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  fs.writeFileSync(path.join(cwd, 'note.pdf'), pdf);

  const expanded = await expandFileMentionsForUserText('总结 @note.pdf', cwd, {autoCompressImages: true, paths: ['note.pdf']});

  assert.match(expanded.text, /--- selected_file: note\.pdf\n/);
  assert.match(expanded.text, /Confirmed PDF content/);
  assert.doesNotMatch(expanded.text, /pages:|pages_with_text:|%PDF-/);
  assert.equal(expanded.attachments, undefined);
  assert.equal(expanded.errors, undefined);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const {readImageFile} = require('../../src/tools/read-files/image-reader');

function createOptions(overrides = {}) {
  return {
    autoCompressImages: true,
    maxImageBytes: 5_000,
    maxInputPixels: 1_000_000,
    maxSourceImageBytes: 1_000_000,
    ...overrides
  };
}

function createNoise(width, height) {
  const data = Buffer.alloc(width * height * 3);
  let value = 0x12345678;

  for (let index = 0; index < data.length; index += 1) {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    data[index] = value & 0xff;
  }

  return {data, raw: {width, height, channels: 3}};
}

function createAnimatedGifWithComment() {
  const gif = Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
    0x00, 0x00, 0x00, 0xff, 0xff, 0xff,
    0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, 0x00, 0x00, 0x00,
    0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00,
    0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x4c, 0x01, 0x00,
    0x3b
  ]);
  const comment = Buffer.concat([
    Buffer.from([0x21, 0xfe]),
    ...Array.from({length: 4}, () => Buffer.concat([Buffer.from([0xff]), Buffer.alloc(0xff, 0x61)])),
    Buffer.from([0x00])
  ]);
  return Buffer.concat([gif.subarray(0, -1), comment, gif.subarray(-1)]);
}

test('readImageFile keeps an image below the final limit byte-for-byte', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-image-reader-pass-'));
  const filePath = path.join(cwd, 'image.png');
  const source = Buffer.from('not-decoded-below-limit');
  fs.writeFileSync(filePath, source);

  const result = await readImageFile('image.png', filePath, 'image/png', source.length, createOptions({maxImageBytes: source.length}));

  assert.equal(result.ok, true);
  assert.equal(result.compressed, false);
  assert.equal(result.attachment.sizeBytes, source.length);
  assert.deepEqual(Buffer.from(result.attachment.dataBase64, 'base64'), source);
});

test('readImageFile rejects oversized images when compression is disabled or source safety limit is exceeded', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-image-reader-limit-'));
  const filePath = path.join(cwd, 'image.png');
  fs.writeFileSync(filePath, Buffer.alloc(100, 1));

  const disabled = await readImageFile('image.png', filePath, 'image/png', 100, createOptions({autoCompressImages: false, maxImageBytes: 50}));
  const sourceLimited = await readImageFile('image.png', filePath, 'image/png', 100, createOptions({maxSourceImageBytes: 99}));

  assert.equal(disabled.ok, false);
  assert.match(disabled.reason, /exceeds max size/);
  assert.equal(sourceLimited.ok, false);
  assert.match(sourceLimited.reason, /exceeds max source size/);
});

test('readImageFile compresses oversized PNG, JPEG, and WebP images in their original formats', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-image-reader-static-'));
  const formats = [
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp']
  ];

  for (const [format, mediaType] of formats) {
    const input = createNoise(256, 256);
    const source = await sharp(input.data, {raw: input.raw})[format]().toBuffer();
    const maxImageBytes = Math.max(1_500, Math.floor(source.length / 3));
    const filePath = path.join(cwd, `image.${format === 'jpeg' ? 'jpg' : format}`);
    fs.writeFileSync(filePath, source);

    const result = await readImageFile(path.basename(filePath), filePath, mediaType, source.length, createOptions({maxImageBytes}));

    assert.equal(result.ok, true, `${format}: ${result.reason || ''}`);
    assert.equal(result.compressed, true);
    assert.ok(result.attachment.sizeBytes <= maxImageBytes);
    assert.equal((await sharp(Buffer.from(result.attachment.dataBase64, 'base64')).metadata()).format, format);
  }
});

test('readImageFile preserves animated GIF frames while compressing oversized input', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-image-reader-gif-'));
  const filePath = path.join(cwd, 'animated.gif');
  const source = createAnimatedGifWithComment();
  fs.writeFileSync(filePath, source);

  const result = await readImageFile('animated.gif', filePath, 'image/gif', source.length, createOptions({maxImageBytes: 100}));

  assert.equal(result.ok, true, result.reason || '');
  assert.equal(result.compressed, true);
  const metadata = await sharp(Buffer.from(result.attachment.dataBase64, 'base64'), {animated: true}).metadata();
  assert.equal(metadata.pages, 2);
  assert.ok(result.attachment.sizeBytes <= 100);
});

test('readImageFile reports decoded pixel and convergence failures without attachments', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-image-reader-failure-'));
  const input = createNoise(64, 64);
  const source = await sharp(input.data, {raw: input.raw}).png().toBuffer();
  const filePath = path.join(cwd, 'image.png');
  fs.writeFileSync(filePath, source);

  const pixelLimited = await readImageFile('image.png', filePath, 'image/png', source.length, createOptions({maxImageBytes: 100, maxInputPixels: 100}));
  const tinyGif = createAnimatedGifWithComment();
  const gifPath = path.join(cwd, 'tiny.gif');
  fs.writeFileSync(gifPath, tinyGif);
  const cannotConverge = await readImageFile('tiny.gif', gifPath, 'image/gif', tinyGif.length, createOptions({maxImageBytes: 10}));

  assert.equal(pixelLimited.ok, false);
  assert.match(pixelLimited.reason, /pixel limit|max decoded pixels/i);
  assert.equal('attachment' in pixelLimited, false);
  assert.equal(cannotConverge.ok, false);
  assert.match(cannotConverge.reason, /could not reduce/);
  assert.equal('attachment' in cannotConverge, false);
});

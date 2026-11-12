const test = require('node:test');
const assert = require('node:assert/strict');

const composerOps = require('../../src/input/composer');
const { formatFileMention } = require('../../src/input/file-mentions');

function confirmed(paths = ['one', 'two', 'three']) {
  const composer = composerOps.createComposer('@query');
  composerOps.replaceWithFileMentions(composer, 0, composer.chars.length, paths);
  return composer;
}

function displayedMentions(composer) {
  return composer.fileMentions.map(({start, end}) => composer.chars.slice(start, end).join(''));
}

function assertGraphemes(composer) {
  const expected = Array.from(new Intl.Segmenter(undefined, {granularity: 'grapheme'})
    .segment(composerOps.getText(composer)), ({segment}) => segment);
  assert.deepEqual(composer.chars, expected);
  assert.ok(composer.cursor >= 0 && composer.cursor <= expected.length);
}

test('plain initial, typed and pasted-looking text never creates confirmed references', () => {
  const composer = composerOps.createComposer('@one');
  composerOps.insertText(composer, ' @two @"three four" user@example.com');
  assert.deepEqual(composer.fileMentions, []);
});

test('confirmation atomically replaces the query with independent ordered ranges', () => {
  const composer = composerOps.createComposer('看 @query 后文');
  const paths = ['a', 'two words', '目录/@file".md'];
  composerOps.replaceWithFileMentions(composer, 2, 8, paths);

  assert.deepEqual(composerOps.captureSnapshot(composer), {
    text: '看 @a @"two words" @目录/@file".md  后文',
    cursor: 32,
    fileMentions: [
      {start: 2, end: 4, path: 'a'},
      {start: 5, end: 17, path: 'two words'},
      {start: 18, end: 31, path: '目录/@file".md'}
    ]
  });
  assert.deepEqual(displayedMentions(composer), paths.map(formatFileMention));
  for (const {end} of composer.fileMentions) {
    assert.equal(composer.chars[end], ' ');
  }
});

test('confirmed paths are retained independently of quotes, filename @ and display normalization', () => {
  const paths = ['docs/a "note"@work.md', 'src\\app.ts', 'a@b@c', '目录/'];
  const composer = confirmed(paths);
  assert.deepEqual(displayedMentions(composer), paths.map(formatFileMention));
  assert.deepEqual(composer.fileMentions.map(({path}) => path), paths);
  paths[0] = 'changed';
  assert.equal(composer.fileMentions[0].path, 'docs/a "note"@work.md');
});

test('confirmation preserves unrelated references, shifts later ones and invalidates replaced ones', () => {
  const composer = confirmed();
  composerOps.replaceWithFileMentions(composer, 5, 9, ['x', 'y']);
  assert.equal(composerOps.getText(composer), '@one @x @y  @three ');
  assert.deepEqual(composer.fileMentions, [
    {start: 0, end: 4, path: 'one'},
    {start: 5, end: 7, path: 'x'},
    {start: 8, end: 10, path: 'y'},
    {start: 12, end: 18, path: 'three'}
  ]);
});

test('confirmation and replacement retain normalized range and cursor semantics', () => {
  const composer = composerOps.createComposer('abc');
  composerOps.replaceWithFileMentions(composer, -5, 99, ['x']);
  assert.deepEqual(composerOps.captureSnapshot(composer), {
    text: '@x ', cursor: 3, fileMentions: [{start: 0, end: 2, path: 'x'}]
  });
  composerOps.replaceRange(composer, 99, -1, '!');
  assert.equal(composerOps.getText(composer), '@x !');
  assert.equal(composer.cursor, 4);
});

test('insertion at the start shifts the reference, insertion at its end does not expand it', () => {
  const composer = confirmed(['one']);
  composer.cursor = 0;
  composerOps.insertText(composer, '👨‍👩‍👧‍👦看');
  assert.deepEqual(composer.fileMentions, [{start: 2, end: 6, path: 'one'}]);
  composer.cursor = 6;
  composerOps.insertText(composer, '请检查，@这里');
  assert.deepEqual(composer.fileMentions, [{start: 2, end: 6, path: 'one'}]);
  assert.deepEqual(displayedMentions(composer), ['@one']);
});

test('deleting only the trailing space retains the reference next to later Chinese and punctuation', () => {
  const composer = confirmed(['one']);
  composerOps.backspace(composer);
  assert.deepEqual(composer.fileMentions, [{start: 0, end: 4, path: 'one'}]);
  composerOps.insertText(composer, '请检查，尤其这里@');
  assert.deepEqual(displayedMentions(composer), ['@one']);
  assert.equal(composerOps.getText(composer), '@one请检查，尤其这里@');
});

test('internal insertion invalidates only that reference and restoring text does not reconfirm it', () => {
  const composer = confirmed();
  composer.cursor = 7;
  composerOps.insertText(composer, 'X');
  assert.deepEqual(composer.fileMentions, [
    {start: 0, end: 4, path: 'one'},
    {start: 11, end: 17, path: 'three'}
  ]);
  composerOps.backspace(composer);
  assert.equal(composerOps.getText(composer), '@one @two @three ');
  assert.deepEqual(composer.fileMentions, [
    {start: 0, end: 4, path: 'one'},
    {start: 10, end: 16, path: 'three'}
  ]);
});

test('nonempty replacements invalidate every intersecting reference even for identical text', () => {
  const composer = confirmed();
  composerOps.replaceRange(composer, 3, 6, 'e @');
  assert.equal(composerOps.getText(composer), '@one @two @three ');
  assert.deepEqual(composer.fileMentions, [{start: 10, end: 16, path: 'three'}]);
});

test('cross-reference deletion invalidates intersecting references and shifts surviving ones', () => {
  const composer = confirmed();
  composerOps.replaceRange(composer, 3, 6, '');
  assert.equal(composerOps.getText(composer), '@ontwo @three ');
  assert.deepEqual(composer.fileMentions, [{start: 7, end: 13, path: 'three'}]);
});

test('outside replacements shift only later references and deleting a separator affects neither side', () => {
  const composer = composerOps.createComposer('ab @query');
  composerOps.replaceWithFileMentions(composer, 3, composer.chars.length, ['one', 'two']);
  composerOps.replaceRange(composer, 0, 2, '👨‍👩‍👧‍👦');
  assert.deepEqual(composer.fileMentions, [
    {start: 2, end: 6, path: 'one'}, {start: 7, end: 11, path: 'two'}
  ]);
  composerOps.replaceRange(composer, 6, 7, '');
  assert.deepEqual(composer.fileMentions, [
    {start: 2, end: 6, path: 'one'}, {start: 6, end: 10, path: 'two'}
  ]);
  composerOps.insertText(composer, '，');
  assert.deepEqual(composer.fileMentions, [
    {start: 2, end: 6, path: 'one'}, {start: 7, end: 11, path: 'two'}
  ]);
  assert.deepEqual(displayedMentions(composer), ['@one', '@two']);
});

for (const operation of ['backspace', 'deleteForward', 'deletePreviousWord', 'deleteNextWord', 'deleteToLineStart', 'deleteToLineEnd']) {
  test(`${operation} invalidates intersected references and keeps remaining text editable`, () => {
    const composer = confirmed(['one']);
    composer.cursor = 2;
    composerOps[operation](composer);
    assert.deepEqual(composer.fileMentions, []);
    assertGraphemes(composer);
    composerOps.insertText(composer, 'x');
    assert.deepEqual(composer.fileMentions, []);
  });
}

test('word and line deletions can invalidate multiple references without affecting another line', () => {
  const composer = confirmed(['one', 'two']);
  composerOps.insertNewline(composer);
  composerOps.replaceWithFileMentions(composer, composer.cursor, composer.cursor, ['three']);
  composer.cursor = 3;
  composerOps.deleteToLineEnd(composer);
  assert.deepEqual(composer.fileMentions, [{start: 4, end: 10, path: 'three'}]);
  assert.equal(composerOps.getText(composer), '@on\n@three ');
  composer.cursor = 11;
  composerOps.deletePreviousWord(composer);
  assert.deepEqual(composer.fileMentions, []);
  assert.equal(composerOps.getText(composer), '@on\n');
});

for (const operation of ['backspace', 'deleteForward', 'deletePreviousWord', 'deleteToLineStart', 'deleteToLineEnd']) {
  test(`${operation} preserves references when deleting only preceding ordinary text`, () => {
    const composer = composerOps.createComposer('ab\n@query');
    composerOps.replaceWithFileMentions(composer, 3, composer.chars.length, ['one']);
    composer.cursor = operation === 'deleteForward' || operation === 'deleteToLineEnd' ? 0 : 2;
    composerOps[operation](composer);
    const start = operation === 'deleteForward' || operation === 'backspace' ? 2 : 1;
    assert.deepEqual(composer.fileMentions, [{start, end: start + 4, path: 'one'}]);
    assert.deepEqual(displayedMentions(composer), ['@one']);
  });
}

test('deleteNextWord keeps a following reference intact when only leading text is removed', () => {
  const composer = composerOps.createComposer('ab\n@query');
  composerOps.replaceWithFileMentions(composer, 3, composer.chars.length, ['one']);
  composer.cursor = 0;
  composerOps.deleteNextWord(composer);
  assert.equal(composerOps.getText(composer), '\n@one ');
  assert.deepEqual(composer.fileMentions, [{start: 1, end: 5, path: 'one'}]);
  assert.deepEqual(displayedMentions(composer), ['@one']);
});

test('deleteNextWord invalidates a reference it consumes and shifts the rest', () => {
  const composer = confirmed(['one', 'two']);
  composer.cursor = 0;
  composerOps.deleteNextWord(composer);
  assert.equal(composerOps.getText(composer), ' @two ');
  assert.deepEqual(composer.fileMentions, [{start: 1, end: 5, path: 'two'}]);
  assert.deepEqual(displayedMentions(composer), ['@two']);
  assertGraphemes(composer);
});

test('newlines shift outside references but invalidate an internally edited reference', () => {
  const composer = confirmed(['one', 'two']);
  composer.cursor = 0;
  composerOps.insertNewline(composer);
  assert.deepEqual(composer.fileMentions, [
    {start: 1, end: 5, path: 'one'}, {start: 6, end: 10, path: 'two'}
  ]);
  composer.cursor = 3;
  composerOps.insertNewline(composer);
  assert.deepEqual(composer.fileMentions, [{start: 7, end: 11, path: 'two'}]);
});

test('empty edits, no-op deletions and cursor movement do not revoke references', () => {
  const composer = confirmed(['one']);
  const references = structuredClone(composer.fileMentions);
  composerOps.deleteForward(composer);
  composerOps.deleteToLineEnd(composer);
  composer.cursor = 0;
  composerOps.backspace(composer);
  composerOps.deleteToLineStart(composer);
  composerOps.deletePreviousWord(composer);
  composer.cursor = 2;
  composerOps.insertText(composer, '');
  composerOps.replaceRange(composer, 2, 2, '');
  assert.equal(composer.cursor, 2);
  for (const operation of ['moveLeft', 'moveRight', 'movePreviousWord', 'moveNextWord', 'moveHome', 'moveEnd', 'moveUp', 'moveDown']) {
    composerOps[operation](composer);
  }
  assert.deepEqual(composer.fileMentions, references);
});

test('Unicode paths and prefixes use grapheme ranges instead of UTF-16 offsets', () => {
  const composer = composerOps.createComposer('👨‍👩‍👧‍👦e\u0301 @query');
  const paths = ['👍🏽/e\u0301@中.md', 'a 👨‍👩‍👧‍👦.md'];
  composerOps.replaceWithFileMentions(composer, 3, composer.chars.length, paths);
  assert.equal(composer.fileMentions[0].start, 3);
  assert.equal(composer.fileMentions[0].end, 12);
  assert.deepEqual(displayedMentions(composer), paths.map(formatFileMention));
  assert.equal(composer.cursor, composer.chars.length);
  assertGraphemes(composer);
  composerOps.replaceRange(composer, 0, 2, '🇨🇳');
  assert.equal(composer.fileMentions[0].start, 2);
  assert.deepEqual(displayedMentions(composer), paths.map(formatFileMention));
  assertGraphemes(composer);
});

test('combining input across an edit boundary shifts references by actual resegmented length', () => {
  const composer = composerOps.createComposer('e @');
  composerOps.replaceWithFileMentions(composer, 2, 3, ['one']);
  composer.cursor = 1;
  composerOps.insertText(composer, '\u0301');
  assert.equal(composerOps.getText(composer), 'e\u0301 @one ');
  assert.equal(composer.cursor, 1);
  assert.deepEqual(composer.fileMentions, [{start: 2, end: 6, path: 'one'}]);
  assertGraphemes(composer);
  composerOps.replaceRange(composer, 0, 1, '👨‍👩‍👧‍👦');
  assert.deepEqual(composer.fileMentions, [{start: 2, end: 6, path: 'one'}]);
  assertGraphemes(composer);
});

test('deletion can join graphemes across its boundary without drifting later references', () => {
  const composer = composerOps.createComposer('e\n\u0301 @');
  composerOps.replaceWithFileMentions(composer, 4, 5, ['one']);
  composer.cursor = 1;
  composerOps.deleteForward(composer);
  assert.equal(composerOps.getText(composer), 'e\u0301 @one ');
  assert.equal(composer.cursor, 1);
  assert.deepEqual(composer.fileMentions, [{start: 2, end: 6, path: 'one'}]);
  assertGraphemes(composer);
});

test('combining input at a reference end keeps its path and maps the cursor to a real boundary', () => {
  const composer = confirmed(['cafe']);
  composer.cursor = 5;
  composerOps.insertText(composer, '\u0301');
  assert.equal(composerOps.getText(composer), '@cafe\u0301 ');
  assert.equal(composer.cursor, 5);
  assert.deepEqual(composer.fileMentions, [{start: 0, end: 5, path: 'cafe'}]);
  assertGraphemes(composer);
});

test('emoji and regional indicator edits resegment both sides and retain later references', () => {
  const composer = composerOps.createComposer('👩👧 🇨🇳🇺 @');
  composerOps.replaceWithFileMentions(composer, 6, 7, ['one']);
  composer.cursor = 1;
  composerOps.insertText(composer, '\u200d');
  assert.equal(composer.cursor, 1);
  assert.deepEqual(composer.fileMentions, [{start: 5, end: 9, path: 'one'}]);
  assertGraphemes(composer);
  composer.cursor = 2;
  composerOps.insertText(composer, '🇯');
  assert.deepEqual(composer.fileMentions, [{start: 5, end: 9, path: 'one'}]);
  assert.deepEqual(displayedMentions(composer), ['@one']);
  assertGraphemes(composer);
});

test('captureSnapshot deeply isolates references and preserves a nonterminal cursor', () => {
  const composer = confirmed(['one', 'two']);
  composer.cursor = 3;
  const snapshot = composerOps.captureSnapshot(composer);
  assert.deepEqual(snapshot, {
    text: '@one @two ', cursor: 3,
    fileMentions: [{start: 0, end: 4, path: 'one'}, {start: 5, end: 9, path: 'two'}]
  });
  assert.notStrictEqual(snapshot.fileMentions, composer.fileMentions);
  assert.notStrictEqual(snapshot.fileMentions[0], composer.fileMentions[0]);
  composer.fileMentions[0].path = 'changed';
  composerOps.reset(composer);
  assert.equal(snapshot.fileMentions[0].path, 'one');
  assert.equal(snapshot.text, '@one @two ');
});

test('restoreSnapshot restores text, cursor and independent editable references', () => {
  const snapshot = composerOps.captureSnapshot(confirmed(['one', 'two']));
  snapshot.cursor = 3;
  const composer = composerOps.createComposer('other draft');
  composerOps.restoreSnapshot(composer, snapshot);
  assert.deepEqual(composerOps.captureSnapshot(composer), snapshot);
  assert.notStrictEqual(composer.fileMentions, snapshot.fileMentions);
  assert.notStrictEqual(composer.fileMentions[0], snapshot.fileMentions[0]);
  snapshot.fileMentions[0].path = 'changed externally';
  assert.equal(composer.fileMentions[0].path, 'one');
  composerOps.insertText(composer, 'x');
  assert.deepEqual(composer.fileMentions, [{start: 6, end: 10, path: 'two'}]);
  assert.deepEqual(snapshot.fileMentions[1], {start: 5, end: 9, path: 'two'});
});

test('setText and reset clear confirmation even for unchanged text without mutating saved snapshots', () => {
  const composer = confirmed(['one']);
  const snapshot = composerOps.captureSnapshot(composer);
  composerOps.setText(composer, snapshot.text);
  assert.deepEqual(composer.fileMentions, []);
  assert.equal(composer.cursor, composer.chars.length);
  composerOps.restoreSnapshot(composer, snapshot);
  composerOps.reset(composer);
  assert.deepEqual(composerOps.captureSnapshot(composer), {text: '', cursor: 0, fileMentions: []});
  assert.deepEqual(snapshot.fileMentions, [{start: 0, end: 4, path: 'one'}]);
});

test('plain-text suffix resegmentation agrees with whole-text Unicode boundaries and cursor positions', () => {
  const segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
  const segment = (text) => Array.from(segmenter.segment(text), ({segment}) => segment);
  const samples = [
    '', 'abc', '中文\n后文', 'e\u0301', '\r\n', '\u0600a',
    '👩‍💻👨‍👩‍👧‍👦', '👍🏽', '🇨🇳🇯🇵🇺', '1\ufe0f\u20e3',
    '\u1100\u1161\u11a8', 'क्‍ष', '\u0301\u200d', '\ud83d', '\udc69'
  ];
  let seed = 12345;
  const choose = (limit) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % limit;
  };

  for (let index = 0; index < 400; index += 1) {
    const original = samples[choose(samples.length)] + samples[choose(samples.length)] + samples[choose(samples.length)];
    const composer = composerOps.createComposer(original);
    const start = choose(composer.chars.length + 1);
    const end = start + choose(composer.chars.length - start + 1);
    const incoming = samples[choose(samples.length)];
    const before = composer.chars.slice(0, start).join('');
    const nextText = before + incoming + composer.chars.slice(end).join('');
    const expectedChars = segment(nextText);
    const cursorOffset = before.length + incoming.length;
    let offset = 0;
    let expectedCursor = 0;
    while (offset < cursorOffset) offset += expectedChars[expectedCursor++].length;

    composerOps.replaceRange(composer, start, end, incoming);
    assert.deepEqual(composer.chars, expectedChars, JSON.stringify({original, start, end, incoming}));
    assert.equal(composer.cursor, expectedCursor);
    assert.deepEqual(composer.fileMentions, []);
  }
});

test('plain-text append handles large paste and a combining tail while retaining earlier text', () => {
  const composer = composerOps.createComposer('x'.repeat(100_000) + 'e');
  composerOps.insertText(composer, '\u0301');
  assert.equal(composer.chars.at(-1), 'e\u0301');
  assert.equal(composer.cursor, 100_001);
  composerOps.insertText(composer, 'y'.repeat(200_000));
  assert.equal(composer.cursor, 300_001);
  assert.equal(composerOps.getText(composer), 'x'.repeat(100_000) + 'e\u0301' + 'y'.repeat(200_000));
});

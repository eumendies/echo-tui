const test = require('node:test');
const assert = require('node:assert/strict');

const composerOps = require('../../src/input/composer');
const { formatFileMention, parseFileMentions } = require('../../src/input/file-mentions');

function snapshot(composer) {
  return {
    text: composerOps.getText(composer),
    cursor: composer.cursor
  };
}

test('createComposer seeds text and cursor from the initial value', () => {
  const composer = composerOps.createComposer('你好ab');

  assert.deepEqual(snapshot(composer), {
    text: '你好ab',
    cursor: 4
  });
});

test('insertText, backspace, and deleteForward mutate around the cursor', () => {
  const composer = composerOps.createComposer('ac');

  composerOps.moveLeft(composer);
  composerOps.insertText(composer, 'b');
  assert.deepEqual(snapshot(composer), { text: 'abc', cursor: 2 });

  composerOps.backspace(composer);
  assert.deepEqual(snapshot(composer), { text: 'ac', cursor: 1 });

  composerOps.deleteForward(composer);
  assert.deepEqual(snapshot(composer), { text: 'a', cursor: 1 });
});

test('replaceRange replaces character ranges and moves cursor after replacement', () => {
  const composer = composerOps.createComposer('看 @read 文件');

  composerOps.replaceRange(composer, 2, 7, '@src/readers.ts');

  assert.deepEqual(snapshot(composer), {
    text: '看 @src/readers.ts 文件',
    cursor: 17
  });
});

test('file mentions parse plain and quoted paths', () => {
  assert.deepEqual(parseFileMentions('看 @src/app.ts 和 @"docs/my note.md"'), [
    {start: 2, end: 13, path: 'src/app.ts', quoted: false},
    {start: 16, end: 34, path: 'docs/my note.md', quoted: true}
  ]);
  assert.equal(formatFileMention('src/app.ts'), '@src/app.ts');
  assert.equal(formatFileMention('docs/my note.md'), '@"docs/my note.md"');
});

test('moveHome and moveEnd stay within the current logical line', () => {
  const composer = composerOps.createComposer('ab\ncd\nef');

  composer.cursor = 4;
  composerOps.moveHome(composer);
  assert.equal(composer.cursor, 3);

  composerOps.moveEnd(composer);
  assert.equal(composer.cursor, 5);
});

test('moveUp and moveDown keep the logical column when possible', () => {
  const composer = composerOps.createComposer('abcd\nef\nghij');

  composer.cursor = 7;
  composerOps.moveUp(composer);
  assert.equal(composer.cursor, 2);

  composerOps.moveDown(composer);
  assert.equal(composer.cursor, 7);

  composerOps.moveDown(composer);
  assert.equal(composer.cursor, 10);
});

test('deleteToLineStart, deleteToLineEnd, and deletePreviousWord remove expected ranges', () => {
  const composer = composerOps.createComposer('hello brave\nnew world');

  composer.cursor = 11;
  composerOps.deleteToLineStart(composer);
  assert.deepEqual(snapshot(composer), { text: '\nnew world', cursor: 0 });

  composerOps.setText(composer, 'hello brave\nnew world');
  composer.cursor = 14;
  composerOps.deleteToLineEnd(composer);
  assert.deepEqual(snapshot(composer), { text: 'hello brave\nne', cursor: 14 });

  composerOps.setText(composer, 'alpha   beta gamma');
  composerOps.deletePreviousWord(composer);
  assert.deepEqual(snapshot(composer), { text: 'alpha   beta ', cursor: 13 });
});

test('insertNewline and reset update the composer shape', () => {
  const composer = composerOps.createComposer('hi');

  composerOps.insertNewline(composer);
  composerOps.insertText(composer, 'there');
  assert.deepEqual(snapshot(composer), {
    text: 'hi\nthere',
    cursor: 8
  });

  composerOps.reset(composer);
  assert.deepEqual(snapshot(composer), {
    text: '',
    cursor: 0
  });
});

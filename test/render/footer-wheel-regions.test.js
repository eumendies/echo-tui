const assert = require('node:assert/strict');
const test = require('node:test');

const {renderComposerSurface} = require('../../src/render/footer/composer-surface');
const {renderCommandSurface} = require('../../src/render/footer/command-surfaces');
const {renderChoiceSurface} = require('../../src/render/footer/choice-surface');
const {renderCopySurface} = require('../../src/render/footer/copy-surface');
const {renderDiffSurface} = require('../../src/render/footer/diff-surface');
const {renderFilePickerSurface} = require('../../src/render/footer/file-picker-surface');
const {renderResumeSurface} = require('../../src/render/footer/resume-surface');
const {constrainLayoutTail} = require('../../src/render/footer/window');
const {createComposer} = require('../../src/input/composer');
const {displayWidth, safeRenderWidth, stripAnsi} = require('../../src/render/layout');

function assertPreviewRegion(layout, owner) {
  assert.equal(layout.wheelRegions.length, 1);
  const [region] = layout.wheelRegions;
  assert.equal(region.owner, owner);
  assert.equal(region.pane, 'secondary');
  assert.ok(region.rowStart < region.rowEnd && region.rowEnd < layout.lines.length - 2);
  assert.ok(region.columnEnd < displayWidth(layout.lines[region.rowStart]));
  for (let row = region.rowStart; row <= region.rowEnd; row += 1) {
    const line = stripAnsi(layout.lines[row]);
    assert.notEqual(line[region.columnStart - 1], '│');
    assert.notEqual(line[region.columnEnd - 1], '│');
  }
  assert.ok(layout.hitRegions.every((hit) => hit.columnEnd < region.columnStart || hit.rowEnd < region.rowStart || hit.rowStart > region.rowEnd));
}

test('slash, choice and select options retain click targets but never expose wheel regions', () => {
  const slash = renderComposerSurface(createComposer('/'), undefined, 60, {
    selectedIndex: 8, options: Array.from({length: 14}, (_, index) => ({label: `/command-${index}`}))
  }, 9);
  assert.equal(slash.wheelRegions, undefined);
  assert.ok(slash.hitRegions.length > 0);

  const choiceSurface = {
    kind: 'choice', title: '选择', optionsTitle: '答案', dismissHint: 'Esc', focusedIndex: 1,
    options: [{label: 'A', description: 'detail'}, {label: 'Other', inlineInput: {text: '', cursor: 0, placeholder: '输入'}}, {label: 'C'}]
  };
  for (const maxLines of [100, 8]) {
    const layout = renderChoiceSurface(choiceSurface, 70, maxLines);
    assert.equal(layout.wheelRegions, undefined);
    assert.ok(layout.hitRegions.some((hit) => hit.target.inlineInput));
  }

  const select = {kind: 'select', title: '/model', selectedIndex: 8, dismissHint: 'Esc', options: Array.from({length: 15}, (_, index) => ({label: `model-${index}`}))};
  for (const title of ['/model', '/mode']) {
    const layout = renderCommandSurface({...select, title}, 60, {maxLines: 7});
    assert.equal(layout.wheelRegions, undefined);
    assert.ok(layout.hitRegions.length > 0);
    assert.match(stripAnsi(layout.lines[1]), /更多/);
  }
  const effort = renderCommandSurface({kind: 'scale', title: '/effort', options: [], selectedIndex: 0, dismissHint: 'Esc'}, 80, {maxLines: 10});
  assert.equal(effort.wheelRegions, undefined);
  assert.equal(effort.hitRegions, undefined);
});

test('four two-column surfaces project only the right preview body regardless of focus or click regions', () => {
  const resumeSurface = {kind: 'resume', title: '/resume', focus: 'preview', sessions: [], selectedIndex: 0, previewScroll: 0, previewStatus: 'ready', previewRecords: [], emptyPreviewHint: '空', dismissHint: 'Esc'};
  const copySurface = {kind: 'copy', title: '/copy', focus: 'preview', selectedIndex: 0, messages: [], selectedIds: [], dismissHint: 'Esc'};
  const pickerSurface = {kind: 'file_picker', title: 'Paths', currentDir: '/tmp', selectedIndex: 0, entries: [], selectedPaths: [], previewScroll: 0, previewLines: [], previewMode: 'text', focus: 'preview', query: '', dismissHint: 'Esc'};
  const diffSurface = {kind: 'diff', title: '/diff', source: {kind: 'git', label: 'Git'}, focus: 'detail', files: [], selectedIndex: 0, detailScroll: 0, notices: []};
  for (const [layout, owner] of [
    [renderResumeSurface(resumeSurface, 80, 11), 'resume'],
    [renderCopySurface(copySurface, 80, 11), 'copy'],
    [renderFilePickerSurface(pickerSurface, 80, 11), 'file_picker']
  ]) {
    assert.deepEqual(layout.hitRegions, []);
    assertPreviewRegion(layout, owner);
  }
  const diff = renderDiffSurface({...diffSurface, files: [{path: 'x', kind: 'modified', added: 1, removed: 0, hunks: []}]}, 80, 11);
  assertPreviewRegion(diff, 'diff');
  const narrow = renderDiffSurface(diffSurface, 32, 9);
  assertPreviewRegion(narrow, 'diff');
  assert.equal(narrow.wheelRegions[0].columnStart, 3);
  for (const width of [3, 5, 8]) {
    for (const layout of [
      renderResumeSurface(resumeSurface, width, 9),
      renderCopySurface(copySurface, width, 9),
      renderFilePickerSurface(pickerSurface, width, 9),
      renderDiffSurface(diffSurface, width, 9)
    ]) {
      assert.ok((layout.wheelRegions || []).every((region) => region.columnStart > 0 && region.columnEnd <= safeRenderWidth(width)));
    }
  }
});

test('resume keeps left session hit regions after the preview takes focus', () => {
  const layout = renderResumeSurface({
    kind: 'resume', title: '/resume', focus: 'preview', selectedIndex: 0, previewScroll: 2,
    sessions: [{label: 'first'}, {label: 'second'}], previewStatus: 'ready', previewRecords: [], emptyPreviewHint: '空',
    dismissHint: 'Esc'
  }, 80, 11);
  assert.deepEqual(layout.hitRegions.map((region) => region.target), [
    {kind: 'command_resume_session', index: 0},
    {kind: 'command_resume_session', index: 1}
  ]);
  assertPreviewRegion(layout, 'resume');
  assert.ok(layout.hitRegions.every((region) => region.columnEnd < layout.wheelRegions[0].columnStart));
});

test('query, notice and loading rows shift only the visible right preview body', () => {
  const picker = renderFilePickerSurface({
    kind: 'file_picker', title: 'Paths', currentDir: '/tmp', selectedIndex: 0,
    entries: [], selectedPaths: [], previewScroll: 0, previewLines: [], previewMode: 'text', focus: 'list',
    query: 'filtered', notice: '无匹配', dismissHint: 'Esc'
  }, 80, 10);
  assert.deepEqual(picker.wheelRegions.map(({rowStart, rowEnd}) => [rowStart, rowEnd]), [[4, 6]]);
  assert.ok(picker.wheelRegions[0].rowEnd < picker.lines.length - 3);

  const resume = renderResumeSurface({
    kind: 'resume', title: '/resume', focus: 'preview', sessions: [], selectedIndex: 0,
    previewScroll: 0, previewStatus: 'loading', previewRecords: [], notice: '读取中', dismissHint: 'Esc'
  }, 80, 10);
  assert.deepEqual(resume.hitRegions, []);
  assert.deepEqual(resume.wheelRegions.map(({rowStart, rowEnd}) => [rowStart, rowEnd]), [[4, 6]]);
  assert.ok(resume.wheelRegions[0].rowEnd < resume.lines.length - 3);
});

test('tail clipping intersects right preview wheel regions without expanding click hit regions', () => {
  const layout = constrainLayoutTail({
    lines: Array.from({length: 9}, (_, index) => `line ${index}`), cursorRow: 8, cursorColumn: 0, showCursor: false,
    wheelRegions: [{owner: 'resume', pane: 'secondary', rowStart: 1, rowEnd: 6, columnStart: 16, columnEnd: 30}],
    hitRegions: [{owner: 'resume', target: {kind: 'command_resume_session', index: 1}, rowStart: 1, rowEnd: 6, columnStart: 3, columnEnd: 12}]
  }, 5);
  assert.deepEqual(layout.wheelRegions.map(({rowStart, rowEnd}) => [rowStart, rowEnd]), [[0, 2]]);
  assert.deepEqual(layout.hitRegions, []);
});

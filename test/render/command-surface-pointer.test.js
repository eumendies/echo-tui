const assert = require('node:assert/strict');
const test = require('node:test');

const {renderCommandSurface} = require('../../src/render/footer/command-surfaces');
const {renderCopySurface} = require('../../src/render/footer/copy-surface');
const {renderDiffSurface} = require('../../src/render/footer/diff-surface');
const {renderResumeSurface} = require('../../src/render/footer/resume-surface');
const {displayWidth, stripAnsi} = require('../../src/render/layout');

function createSessions(count) {
  return Array.from({length: count}, (_value, index) => ({label: `session ${index}`}));
}

function createFiles(count) {
  return Array.from({length: count}, (_value, index) => ({
    path: `file-${index}.ts`,
    kind: 'modified',
    added: index + 1,
    removed: index,
    hunks: []
  }));
}

function assertHitRegionsFollowRenderedList(layout, labelForIndex) {
  for (const region of layout.hitRegions || []) {
    const line = stripAnsi(layout.lines[region.rowStart]);
    const firstBar = line.indexOf('│');
    const middleBar = line.indexOf('│', firstBar + 1);
    assert.equal(region.rowEnd, region.rowStart);
    assert.equal(region.columnStart, displayWidth(line.slice(0, firstBar)) + displayWidth('│ ') + 1);
    assert.equal(region.columnEnd, displayWidth(line.slice(0, middleBar)) - 1);
    assert.match(line.slice(firstBar, middleBar), labelForIndex(region.target.index));
    assert.doesNotMatch(line.slice(firstBar, middleBar), /更多/);
  }
}

test('command select hit regions retain absolute option indexes and omit more rows', () => {
  const layout = renderCommandSurface({
    kind: 'select',
    title: '/model',
    options: Array.from({length: 8}, (_value, index) => ({label: `model-${index}`})),
    selectedIndex: 5,
    dismissHint: 'Esc 关闭'
  }, 60, {maxLines: 5});

  assert.equal(layout.hitRegions.length, 1);
  assert.deepEqual(layout.hitRegions.map((region) => region.target), [
    {kind: 'command_select_option', index: 5}
  ]);
  assert.equal(layout.hitRegions.every((region) => region.owner === 'command_select' && region.rowStart === region.rowEnd), true);
});

test('scale surfaces remain keyboard-only without hit regions', () => {
  const layout = renderCommandSurface({
    kind: 'scale',
    title: '/effort',
    leftLabel: 'low',
    rightLabel: 'high',
    options: [{label: 'low'}, {label: 'high'}],
    selectedIndex: 0,
    dismissHint: 'Enter 选择 · Esc 取消'
  }, 80, {maxLines: 9});

  assert.deepEqual(layout.hitRegions || [], []);
});

test('resume hit regions cover only visible list rows while list focus is active', () => {
  const surface = {
    kind: 'resume',
    focus: 'list',
    title: '/resume',
    sessions: createSessions(12),
    selectedIndex: 8,
    previewScroll: 0,
    previewStatus: 'ready',
    previewRecords: [],
    emptyPreviewHint: 'empty',
    dismissHint: 'Esc 关闭'
  };
  const layout = renderResumeSurface(surface, 80, 12);

  assert.equal(layout.hitRegions.length > 0, true);
  assert.equal(layout.hitRegions.every((region) => region.owner === 'resume' && region.target.kind === 'command_resume_session'), true);
  assert.equal(layout.hitRegions.every((region) => region.columnEnd < 40), true);
  assert.equal(layout.hitRegions.some((region) => region.target.index === 8), true);

  const previewLayout = renderResumeSurface({...surface, focus: 'preview'}, 80, 12);
  assert.deepEqual(previewLayout.hitRegions, []);
});

test('copy and diff hit regions stay in the visible left list column', () => {
  const copyLayout = renderCopySurface({
    kind: 'copy',
    title: '/copy',
    focus: 'preview',
    previewScroll: 0,
    selectedIndex: 7,
    selectedIds: [],
    messages: Array.from({length: 12}, (_value, index) => ({id: `message-${index}`, role: 'assistant', text: `message ${index}`, selected: false})),
    dismissHint: 'Esc 关闭'
  }, 80, 10);
  const diffLayout = renderDiffSurface({
    kind: 'diff',
    title: '/diff',
    source: {kind: 'history', label: 'history'},
    notices: [],
    focus: 'detail',
    selectedIndex: 7,
    detailScroll: 3,
    files: createFiles(12)
  }, 80, 10);

  assert.equal(copyLayout.hitRegions.length > 0, true);
  assert.equal(copyLayout.hitRegions.every((region) => region.owner === 'copy' && region.target.kind === 'command_copy_message' && region.columnEnd < 40), true);
  assert.equal(copyLayout.hitRegions.some((region) => region.target.index === 7), true);
  assert.equal(diffLayout.hitRegions.length > 0, true);
  assert.equal(diffLayout.hitRegions.every((region) => region.owner === 'diff' && region.target.kind === 'command_diff_file' && region.columnEnd < 40), true);
  assert.equal(diffLayout.hitRegions.some((region) => region.target.index === 7), true);
});

test('two-column hit regions follow the drawn list rows across width, height and notices', () => {
  for (const width of [48, 80]) {
    for (const height of [8, 12]) {
      const resume = renderResumeSurface({
        kind: 'resume', focus: 'list', title: '/resume', sessions: createSessions(15),
        selectedIndex: 8, previewStatus: 'ready', previewRecords: [], previewScroll: 0,
        emptyPreviewHint: 'empty', dismissHint: 'Esc', notice: 'notice'
      }, width, height);
      const copy = renderCopySurface({
        kind: 'copy', title: '/copy', focus: 'preview', selectedIndex: 8, selectedIds: [],
        previewScroll: 0,
        messages: Array.from({length: 15}, (_value, index) => ({id: `message-${index}`, role: 'user', text: `message-${index}`, selected: false})),
        dismissHint: 'Esc'
      }, width, height);
      const diff = renderDiffSurface({
        kind: 'diff', title: '/diff', source: {kind: 'history', label: 'history'},
        notices: ['notice'], focus: 'detail', selectedIndex: 8, detailScroll: 0,
        files: createFiles(15)
      }, width, height);

      assertHitRegionsFollowRenderedList(resume, (index) => new RegExp(`session ${index}(?!\\d)`));
      assertHitRegionsFollowRenderedList(copy, () => /User/);
      assertHitRegionsFollowRenderedList(diff, (index) => new RegExp(`\\+${index + 1} -${index}(?!\\d)`));
      assert.equal(resume.hitRegions.some((region) => region.target.index === 8), true);
      assert.equal(copy.hitRegions.some((region) => region.target.index === 8), true);
      assert.equal(diff.hitRegions.some((region) => region.target.index === 8), true);
      for (const layout of [resume, copy, diff]) {
        assert.equal(layout.hitRegions.every((region) => region.rowStart < layout.lines.length), true);
        assert.equal(layout.hitRegions.every((region) => !stripAnsi(layout.lines[region.rowStart]).includes('↓') && !stripAnsi(layout.lines[region.rowStart]).includes('↑')), true);
      }
    }
  }
});

test('two-column empty and narrow detail-only panels have no executable list regions', () => {
  const resume = renderResumeSurface({
    kind: 'resume', focus: 'list', title: '/resume', sessions: [], selectedIndex: 0,
    previewStatus: 'ready', previewRecords: [], emptyPreviewHint: 'empty', dismissHint: 'Esc'
  }, 48, 8);
  const copy = renderCopySurface({kind: 'copy', title: '/copy', messages: [], selectedIndex: 0, selectedIds: [], dismissHint: 'Esc'}, 48, 8);
  const diff = renderDiffSurface({kind: 'diff', title: '/diff', source: {kind: 'history', label: 'history'}, notices: [], files: createFiles(3), selectedIndex: 0}, 32, 8);

  assert.deepEqual(resume.hitRegions, []);
  assert.deepEqual(copy.hitRegions, []);
  assert.deepEqual(diff.hitRegions, []);
});

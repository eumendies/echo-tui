const test = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function runScenario(scenario) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-history-budget-'));
  try {
    return JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'fixtures/main-history-render-budget-scenario.js'), scenario], {
      cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8', env: {...process.env, HOME: home}, timeout: 20_000
    }));
  } finally {
    fs.rmSync(home, {recursive: true, force: true});
  }
}

function assertMainSnapshot(frame, {budget, compactionHints = 0, budgetHints = 1}) {
  assert.equal(frame.owner, 'main');
  assert.equal(frame.main, true);
  assert.equal(frame.budget, budget);
  assert.equal(frame.latestActive, true);
  assert.equal(frame.completeBlocks, true);
  assert.equal(frame.budgetHints, budgetHints);
  assert.equal(frame.compactionHints, compactionHints);
  assert.equal(frame.clears, 1);
  assert.equal(frame.alternateScreen, false);
}

test('saved and external history budgets redraw main once, retaining the real config surface and normalized snapshot', () => {
  const result = runScenario('settings');
  assertMainSnapshot(result.initial, {budget: 1000});
  assert.equal(result.draftOnly, true);
  assert.deepEqual(result.save, {
    recoveries: 1, focus: result.save.expectedFocus, expectedFocus: result.save.expectedFocus,
    destructiveSurface: 'config', destructiveFocus: result.save.expectedFocus,
    kind: 'config', tab: 'general', feedback: '✓ 常规设置已保存', dirty: null, persisted: 500
  });
  assertMainSnapshot(result.saved, {budget: 500});
  assert.ok(result.saved.activeBlocks.length < result.initial.activeBlocks.length);
  assert.equal(result.duplicateFrames, 0);
  assert.equal(result.unrelatedFrames, 0);
  assert.equal(result.externalRecoveries, 1);
  assertMainSnapshot(result.external, {budget: 0, budgetHints: 0});
  assert.equal(result.external.archived, true);
  assert.equal(result.external.oldActive, true);
  assert.equal(result.surfacePreserved, true);
  assertMainSnapshot(result.combined, {budget: 500});
  assert.equal(result.combined.reasoning, false);
  assert.equal(result.combinedRecoveries, 1);
  assert.equal(result.combinedDuplicateFrames, 0);
  assertMainSnapshot(result.normalized, {budget: 1000});
  assert.equal(result.invalidSameFrames, 0);
  assert.equal(result.hotPathConfigReads, 0);
  assert.equal(result.hotPathHistoryReads, 0);
  assert.equal(result.journalUnchanged, true);
});

test('budget-only changes preserve BTW and subagent owners, whose complete projections remain unlimited', () => {
  const result = runScenario('owners');
  assert.equal(result.btwBudgetFrames, 0);
  for (const frame of [result.btw, result.btwCombined]) {
    assert.equal(frame.owner, 'btw');
    assert.equal(frame.main, false);
    assert.equal(frame.btwFirst, true);
    assert.equal(frame.btwLast, true);
    assert.equal(frame.latestActive, false);
    assert.equal(frame.budgetHints, 0);
  }
  assert.equal(result.combinedRecoveries, 1);
  assertMainSnapshot(result.returnedBtw, {budget: 2000});
  assert.equal(result.returnedBtw.btwFirst, false);
  assert.equal(result.viewBudgetFrames, 0);
  for (const frame of [result.view, result.viewRecovery]) {
    assert.equal(frame.owner, 'view');
    assert.equal(frame.main, false);
    assert.equal(frame.viewFirst, true);
    assert.equal(frame.viewLast, true);
    assert.equal(frame.latestActive, false);
    assert.equal(frame.budgetHints, 0);
  }
  assertMainSnapshot(result.returnedView, {budget: 0, budgetHints: 0});
  assert.equal(result.returnedView.archived, true);
  assert.equal(result.journalUnchanged, true);
});

for (const compacted of [false, true]) {
  test(`resume, resize, theme and Undo share the budget without changing ${compacted ? 'compacted' : 'uncompacted'} session facts`, () => {
    const result = runScenario(compacted ? 'compacted' : 'recovery');
    const compactionHints = compacted ? 1 : 0;
    for (const frame of [result.resumed, result.resized, result.themed]) {
      assertMainSnapshot(frame, {budget: 1000, compactionHints});
      assert.equal(frame.base, compacted ? 2 : 0);
      assert.equal(frame.count, result.expectedResidentCount);
      assert.equal(frame.oldActive, false);
    }
    assert.ok(result.resized.activeBlocks.length < result.resumed.activeBlocks.length);
    assert.equal(result.composerPreserved, true);
    assert.equal(result.themeRecoveries, 1);
    assert.equal(result.themeSurfacePreserved, true);
    assertMainSnapshot(result.unlimited, {budget: 0, compactionHints, budgetHints: 0});
    assert.equal(result.unlimited.archived, !compacted);
    assert.equal(result.unlimited.oldActive, true);
    assert.equal(result.displayHistoryReads, 0);
    assert.equal(result.displayJournalUnchanged, true);
    assert.equal(result.undoConfirm, 'confirm');
    assertMainSnapshot(result.undone, {budget: 500, compactionHints});
    assert.equal(result.undone.undo, false);
    assert.equal(result.persistedCountAfterUndo, result.expectedCountAfterUndo);
    assert.equal(result.undoPreservedPrefix, true);
    assert.equal(result.undoCompaction?.activeStartIndex ?? 0, compacted ? 2 : 0);
    assert.equal(result.forkComplete, true);
    assert.equal(result.forkTodo, 'retained task');
    assert.equal(result.providerComplete, true);
    assert.equal(result.providerBase, compacted ? 2 : 0);
    assert.equal(result.providerContainsOmitted, true);
    assert.equal(result.providerContainsBudgetHint, false);
    assert.equal(result.providerCompaction?.activeStartIndex ?? 0, compacted ? 2 : 0);
    assert.ok(result.previewCount > 0);
    assert.equal(result.previewPreserved, true);
    assert.equal(result.sourceJournalUnchangedByFork, true);
  });
}

const test = require('node:test');
const assert = require('node:assert/strict');
const {createRenderCoordinator} = require('../../src/app/render-coordinator');

function createHarness() {
  const frames = [];
  const pointerFrames = [];
  const observedBatches = [];
  const recoveredSizes = [];
  const recoveredCounts = [];
  const syncedMain = [];
  const viewBatches = [];
  const size = {columns: 80, rows: 24};
  let stopped = false;
  let btwActive = false;
  let viewActive = false;
  let modalActive = false;
  const appContext = {
    isMouseInteractionEnabled: () => true,
    createRenderState: (options) => options,
    renderContext: {
      previousColumns: 0,
      previousRows: 0,
      createBannerContext: () => ({variant: 'main'})
    },
    transcriptContext: {
      records: [{role: 'user', text: 'main'}], baseRecordIndex: 0, compaction: null,
      getResidentRecords() { return this.records; },
      getRecordCount() { return this.baseRecordIndex + this.records.length; }
    },
    turnContext: {hasTimedActivity: () => true},
    subagentRunContext: {hasTimedActivity: () => false}
  };
  const renderer = {
    syncMainTranscript(snapshot, pending) { syncedMain.push({snapshot, pending}); },
    renderInitial(options) { frames.push({kind: 'initial', options}); return {version: frames.length}; },
    render(options, finalized) { frames.push({kind: 'footer', options, finalized}); return {version: frames.length}; },
    renderRecords(options) { frames.push({kind: 'records', options}); return {version: frames.length}; },
    renderDestructive(options) { frames.push({kind: 'destructive', options}); return {version: frames.length}; }
  };
  const coordinator = createRenderCoordinator({
    appContext,
    btwConversation: {
      isActive: () => btwActive,
      createRenderState: (state) => state,
      getRecords: () => [{role: 'user', text: 'btw'}],
      getParentActivity: () => 'MAIN working',
      hasTimedActivity: () => false
    },
    getActiveInputResolver: () => ({
      getSurface: (owner) => ({kind: 'info', title: owner}),
      getPointerConsumer: () => ({id: 'pointer'}),
      getActiveModalSurface: () => modalActive ? {kind: 'info'} : null
    }),
    getFooterPointer: () => ({update: (snapshot) => pointerFrames.push(snapshot)}),
    isStopped: () => stopped,
    observation: {
      transcriptBatchRendered: ({records}) => observedBatches.push(records),
      resizeRecovered: ({terminalSize, recordCount}) => { recoveredSizes.push(terminalSize); recoveredCounts.push(recordCount); }
    },
    renderer,
    subagentView: {
      isActive: () => viewActive,
      createRenderState: (state) => state,
      getViewRecords: () => [{role: 'subagent', runId: 'run-1'}],
      appendRecords: (records) => {
        viewBatches.push(records);
        return records.some((record) => record.runId === 'run-1');
      },
      hasTimedActivity: () => false
    },
    terminal: {getSize: () => ({...size})},
    toolApproval: {}
  });

  return {
    appContext, coordinator, frames, pointerFrames, observedBatches, recoveredSizes, recoveredCounts, syncedMain, viewBatches, size,
    setBtwActive: (value) => { btwActive = value; },
    setViewActive: (value) => { viewActive = value; },
    setModalActive: (value) => { modalActive = value; },
    stop: () => { stopped = true; }
  };
}

test('render coordinator routes owner records and finalizes only the visible stream', () => {
  const harness = createHarness();
  const {coordinator, frames, observedBatches} = harness;
  coordinator.renderInitial();
  assert.equal(frames[0].options.commandSurface.title, 'main');
  assert.equal(frames[0].options.footerInteractionId, 'pointer');

  harness.setBtwActive(true);
  const finalized = {role: 'assistant', text: 'main response'};
  coordinator.render(finalized, 'main');
  assert.equal(frames.at(-1).finalized, undefined);
  coordinator.renderRecords([{role: 'user', text: 'main question'}], 'main');
  assert.equal(frames.at(-1).kind, 'footer');
  assert.equal(observedBatches.length, 1);
  coordinator.renderRecords([{role: 'user', text: 'side question'}], 'btw');
  assert.equal(frames.at(-1).kind, 'records');
  assert.equal(frames.at(-1).options.streamingOwner, 'btw');

  harness.setViewActive(true);
  coordinator.renderRecords([{role: 'subagent', runId: 'run-1'}], 'main');
  assert.equal(frames.at(-1).kind, 'destructive');
  assert.equal(frames.at(-1).options.streamingOwner, 'view');
  assert.equal(frames.at(-1).options.skipParallelSubagentFilter, true);
  const otherRun = [{role: 'subagent', runId: 'run-2'}];
  coordinator.renderRecords(otherRun, 'main');
  assert.equal(frames.at(-1).kind, 'footer');
  assert.strictEqual(harness.viewBatches.at(-1), otherRun);
  const beforeSide = harness.viewBatches.length;
  coordinator.renderRecords([{role: 'subagent', runId: 'run-1'}], 'btw');
  assert.equal(frames.at(-1).kind, 'footer');
  assert.equal(harness.viewBatches.length, beforeSide);
});

test('render coordinator passes resident main snapshot without leaking it into BTW or subagent projections', () => {
  const harness = createHarness();
  const {appContext, coordinator, frames, syncedMain} = harness;
  const transcript = appContext.transcriptContext;
  transcript.baseRecordIndex = 800;
  transcript.compaction = {activeStartIndex: 800, summaryText: 'summary', createdAt: 'now'};
  coordinator.render();
  assert.equal(frames.at(-1).kind, 'footer');
  assert.equal(syncedMain.length, 1);
  assert.deepEqual(frames.at(-1).options.mainTranscript, {
    baseRecordIndex: 800, compaction: transcript.compaction
  });
  assert.strictEqual(syncedMain.at(-1).snapshot.records, transcript.records);
  coordinator.renderResizeRecovery();
  assert.equal(syncedMain.length, 2);
  assert.equal(frames.at(-1).options.records, transcript.records);
  assert.equal(harness.recoveredCounts.at(-1), 801);

  harness.setBtwActive(true);
  transcript.baseRecordIndex = 900;
  coordinator.renderResizeRecovery();
  assert.equal(frames.at(-1).options.mainTranscript, undefined);
  assert.equal(frames.at(-1).options.records[0].text, 'btw');
  assert.equal(syncedMain.at(-1).snapshot.baseRecordIndex, 900);

  harness.setViewActive(true);
  coordinator.renderResizeRecovery();
  assert.equal(frames.at(-1).options.mainTranscript, undefined);
  assert.equal(frames.at(-1).options.records[0].runId, 'run-1');
  harness.setViewActive(false);
  harness.setBtwActive(false);
  coordinator.renderResizeRecovery();
  assert.equal(frames.at(-1).options.mainTranscript.baseRecordIndex, 900);
  assert.equal(frames.at(-1).options.records, transcript.records);
});

test('render coordinator updates size and pointer only for active frames, recovering resized layouts', () => {
  const harness = createHarness();
  const {appContext, coordinator, frames, pointerFrames, recoveredSizes, size} = harness;
  coordinator.renderInitial();
  assert.equal(appContext.renderContext.previousRows, 24);
  coordinator.renderTimedActivity();
  assert.equal(frames.at(-1).kind, 'footer');
  harness.setModalActive(true);
  const beforeModalTick = frames.length;
  coordinator.renderTimedActivity();
  assert.equal(frames.length, beforeModalTick);

  size.rows = 20;
  coordinator.handleResize();
  assert.equal(frames.at(-1).kind, 'destructive');
  assert.equal(appContext.renderContext.previousRows, 20);
  assert.deepEqual(recoveredSizes, [{columns: 80, rows: 20}]);
  assert.equal(pointerFrames.length, frames.length);

  harness.stop();
  coordinator.render();
  coordinator.renderInitial();
  coordinator.renderResizeRecovery();
  coordinator.handleResize();
  coordinator.renderTimedActivity();
  assert.equal(pointerFrames.length, frames.length);
});

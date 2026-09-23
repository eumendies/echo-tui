const test = require('node:test');
const assert = require('node:assert/strict');
const {createRenderCoordinator} = require('../../src/app/render-coordinator');

function createHarness() {
  const frames = [];
  const pointerFrames = [];
  const observedBatches = [];
  const recoveredSizes = [];
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
    transcriptContext: {records: [{role: 'user', text: 'main'}]},
    turnContext: {hasTimedActivity: () => true},
    subagentRunContext: {hasTimedActivity: () => false}
  };
  const renderer = {
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
      resizeRecovered: ({terminalSize}) => recoveredSizes.push(terminalSize)
    },
    renderer,
    subagentView: {
      isActive: () => viewActive,
      createRenderState: (state) => state,
      getViewRecords: () => [{role: 'subagent', runId: 'run-1'}],
      containsRunRecords: (records) => records.some((record) => record.runId === 'run-1'),
      hasTimedActivity: () => false
    },
    terminal: {getSize: () => ({...size})},
    toolApproval: {}
  });

  return {
    appContext, coordinator, frames, pointerFrames, observedBatches, recoveredSizes, size,
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

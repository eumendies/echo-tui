const assert = require('node:assert/strict');
const {test} = require('node:test');

const {UserQuestionContext} = require('../../src/app/state/user-question-context');

function createCall(callId) {
  return {callId, toolName: 'ask_user_questions', argumentsText: '{}'};
}

function createRequest(question = 'Choose?') {
  return {questions: [{options: [{label: 'A'}, {label: 'B'}], question}]};
}

function createContext() {
  let updates = 0;
  const context = new UserQuestionContext(() => {
    updates += 1;
  });
  return {context, getUpdates: () => updates};
}

test('user questions queue in arrival order instead of replacing the active request', {timeout: 10000}, async () => {
  const {context} = createContext();
  const first = context.request(createCall('call-a'), createRequest('Worker A question'), {agentName: 'worker'});
  const second = context.request(createCall('call-b'), createRequest('Worker B question'), {agentName: 'worker'});

  // A 的 surface 与草稿保持不变，B 排队等待。
  const surface = context.getSurface();
  assert.equal(surface.message, 'Worker A question');
  assert.match(surface.title, /WORKER/u);

  // 提交 A 后自动展示 B，且两个结果各自返回自己的调用。
  context.handleEvent({type: 'submit'});
  const firstResult = await first;
  assert.equal(context.getSurface().message, 'Worker B question');
  assert.equal(firstResult.callId, 'call-a');
  assert.equal(firstResult.ok, true);
  assert.match(firstResult.text, /"selected":"A"/u);

  context.handleEvent({type: 'submit'});
  const secondResult = await second;
  assert.equal(context.getSurface(), null);
  assert.equal(secondResult.callId, 'call-b');
  assert.equal(secondResult.ok, true);
});

test('Esc cancels only the active request and activates the next one', {timeout: 10000}, async () => {
  const {context} = createContext();
  const first = context.request(createCall('call-a'), createRequest('First'), {agentName: 'worker'});
  const second = context.request(createCall('call-b'), createRequest('Second'), {agentName: 'worker'});
  const third = context.request(createCall('call-c'), createRequest('Third'), {agentName: 'worker'});

  context.handleEvent({type: 'escape'});
  const firstResult = await first;
  assert.equal(firstResult.ok, false);
  assert.match(firstResult.text, /cancelled/u);
  // 只取消当前项：后续请求仍按顺序展示。
  assert.equal(context.getSurface().message, 'Second');

  context.handleEvent({type: 'submit'});
  assert.equal((await second).ok, true);
  assert.equal(context.getSurface().message, 'Third');

  context.handleEvent({type: 'submit'});
  assert.equal((await third).ok, true);
});

test('cancelling the parent turn settles every active and queued request', {timeout: 10000}, async () => {
  const {context} = createContext();
  const first = context.request(createCall('call-a'), createRequest('First'), {agentName: 'worker'});
  const second = context.request(createCall('call-b'), createRequest('Second'), {agentName: 'worker'});

  context.cancelAllRequests('Parent turn ended.');
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.ok, false);
  assert.equal(secondResult.ok, false);
  assert.equal(firstResult.callId, 'call-a');
  assert.equal(secondResult.callId, 'call-b');
  assert.match(secondResult.text, /Parent turn ended/u);
  // surface 与队列都已清空，过期来源不会在后续 turn 重新打开。
  assert.equal(context.getSurface(), null);
  assert.equal(context.hasActiveRequest(), false);
});

test('each request keeps its own drafts and multi-question answers', {timeout: 10000}, async () => {
  const {context} = createContext();
  const multi = context.request(createCall('call-multi'), {
    questions: [
      {options: [{label: 'A1'}, {label: 'B1'}], question: 'First question'},
      {options: [{label: 'A2'}, {label: 'B2'}], question: 'Second question'}
    ]
  });
  const single = context.request(createCall('call-single'), createRequest('Queued question'));

  // 当前请求占住 surface，排队请求不会共享草稿。
  assert.equal(context.getSurface().message, 'First question');
  context.handleEvent({type: 'submit'});
  context.handleEvent({type: 'submit'});
  // 多题模式先逐题确认，最后在提交 tab 上再确认一次才产出结果。
  context.handleEvent({type: 'submit'});
  const multiResult = await multi;
  assert.equal(multiResult.ok, true);
  assert.match(multiResult.text, /A1/u);
  assert.match(multiResult.text, /A2/u);

  assert.equal(context.getSurface().message, 'Queued question');
  context.handleEvent({type: 'submit'});
  assert.equal((await single).ok, true);
});

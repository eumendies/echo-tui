const test = require('node:test');
const assert = require('node:assert/strict');

const {INPUT_EVENTS} = require('../../src/input/event-types');
const {
  MAX_MCP_PROMPT_MESSAGE_BYTES,
  McpPromptCommandHandler,
  TRUNCATION_MARKER,
  formatPromptMessages,
  parsePromptArguments,
  tokenizeArguments
} = require('../../src/commands/mcp-prompt-command-handler');

function createPrompt(overrides = {}) {
  return {
    serverName: 'docs',
    promptName: 'code_review',
    commandName: 'docs:code_review',
    description: 'Review code',
    arguments: [{name: 'code', required: true}, {name: 'lang', description: 'Language', required: false}],
    ...overrides
  };
}

function createHost(options = {}) {
  const prompts = options.prompts || [createPrompt()];
  const state = {active: null, submitted: [], getPromptCalls: []};
  const host = {
    session: {
      open(entry) {
        state.active = entry;
      },
      update(patch) {
        state.active = {...state.active, ...patch};
      },
      close() {
        state.active = null;
      },
      getActive() {
        return state.active;
      }
    },
    mcp: {
      listPrompts: () => prompts,
      async getPromptMessages(serverName, promptName, args) {
        state.getPromptCalls.push({serverName, promptName, args});
        return options.getPromptMessages
          ? options.getPromptMessages(serverName, promptName, args)
          : {ok: true, messages: [{role: 'user', content: {kind: 'text', text: 'prompt body'}}]};
      }
    },
    assistant: {
      async submitUserMessage(input) {
        state.submitted.push(input);
        return true;
      }
    }
  };

  return {host, state, prompts};
}

function createHandler(prompts) {
  return new McpPromptCommandHandler(() => prompts);
}

test('prompt command handler matches only registered <server>:<prompt> commands', () => {
  const handler = createHandler([createPrompt()]);

  assert.equal(handler.match('/docs:code_review'), true);
  assert.equal(handler.match('/docs:code_review code=1'), true);
  assert.equal(handler.match('/docs:missing'), false);
  assert.equal(handler.match('/mcp'), false);
  assert.equal(handler.match('/code_review'), false);
});

test('prompt command submits one user message with role labels, metadata and display text', async () => {
  const {host, state} = createHost({
    getPromptMessages: async () => ({
      ok: true,
      messages: [
        {role: 'user', content: {kind: 'text', text: 'Please review:'}},
        {role: 'assistant', content: {kind: 'text', text: 'I will focus on concurrency.'}}
      ]
    })
  });
  const handler = createHandler([createPrompt()]);

  assert.deepEqual(handler.start('/docs:code_review code=1', host), {kind: 'handled'});
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(state.getPromptCalls, [{serverName: 'docs', promptName: 'code_review', args: {code: '1'}}]);
  assert.equal(state.active, null);
  assert.equal(state.submitted.length, 1);
  assert.equal(state.submitted[0].displayText, '/docs:code_review code=1');
  assert.deepEqual(state.submitted[0].metadata, {mcpPrompt: {server: 'docs', name: 'code_review', argumentsText: 'code=1'}});
  assert.match(state.submitted[0].text, /^\[MCP prompt: docs:code_review\]/u);
  assert.match(state.submitted[0].text, /\[user\]\nPlease review:/u);
  assert.match(state.submitted[0].text, /\[assistant\]\nI will focus on concurrency\./u);
});

test('prompt command collects missing required arguments before submitting', async () => {
  const {host, state} = createHost({
    getPromptMessages: async (_server, _prompt, args) => ({ok: true, messages: [{role: 'user', content: {kind: 'text', text: `code:${args.code}`}}]})
  });
  const handler = createHandler([createPrompt()]);

  assert.deepEqual(handler.start('/docs:code_review', host), {kind: 'handled'});
  const session = state.active;

  assert.equal(session.surface.kind, 'choice');
  assert.equal(session.surface.messageTitle, '参数 code（必填）');

  // 空提交不推进收集；输入与退格都作用在当前参数草稿上。
  await handler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, host);
  assert.equal(state.active, session);
  await handler.handleEvent(session, {type: INPUT_EVENTS.TEXT, value: 'abc'}, host);
  await handler.handleEvent(session, {type: INPUT_EVENTS.BACKSPACE}, host);
  assert.equal(state.active.data.pending[0].input, 'ab');

  await handler.handleEvent(state.active, {type: INPUT_EVENTS.SUBMIT}, host);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(state.getPromptCalls[0].args.code, 'ab');
  assert.equal(state.submitted.length, 1);
  assert.match(state.submitted[0].text, /code:ab/u);
  assert.equal(state.submitted[0].metadata.mcpPrompt.argumentsText, undefined);
});

test('prompt command cancels collection without submitting', async () => {
  const {host, state} = createHost();
  const handler = createHandler([createPrompt()]);

  handler.start('/docs:code_review', host);
  await handler.handleEvent(state.active, {type: INPUT_EVENTS.ESCAPE}, host);

  assert.equal(state.active, null);
  assert.deepEqual(state.submitted, []);
  assert.deepEqual(state.getPromptCalls, []);
});

test('prompt command rejects unknown arguments and extra positional values with usage', () => {
  const handler = createHandler([createPrompt()]);
  const {host, state} = createHost();

  handler.start('/docs:code_review nope=1', host);
  assert.equal(state.active.surface.kind, 'info');
  assert.match(state.active.surface.lines[0], /未知参数：nope/u);
  assert.match(state.active.surface.lines[2], /用法：\/docs:code_review <code> \[lang\]/u);

  const extra = createHost();
  handler.start('/docs:code_review a b c', extra.host);
  assert.equal(extra.state.active.surface.kind, 'info');
  assert.match(extra.state.active.surface.lines[0], /参数过多：c/u);
});

test('prompt command reports unknown prompts and failed fetches', async () => {
  const handler = createHandler([createPrompt()]);
  const unknown = createHost();

  handler.start('/docs:missing', unknown.host);
  assert.equal(unknown.state.active.surface.kind, 'info');
  assert.match(unknown.state.active.surface.lines[0], /没有这个 MCP prompt/u);
  assert.match(unknown.state.active.surface.lines.join('\n'), /- \/docs:code_review/u);

  const failing = createHost({
    getPromptMessages: async () => ({ok: false, reason: 'failed', message: 'MCP error -32000: boom'})
  });
  handler.start('/docs:code_review code=1', failing.host);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(failing.state.submitted.length, 0);
  assert.match(failing.state.active.surface.lines[0], /boom/u);
});

test('prompt command ignores late fetch results after the session was replaced', async () => {
  let resolveFetch;
  const {host, state} = createHost({
    getPromptMessages: () => new Promise((resolve) => {
      resolveFetch = resolve;
    })
  });
  const handler = createHandler([createPrompt()]);

  handler.start('/docs:code_review code=1', host);
  host.session.close();
  resolveFetch({ok: true, messages: [{role: 'user', content: {kind: 'text', text: 'late'}}]});
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(state.submitted, []);
});

test('prompt command keeps another session of the same handler safe from late results', async () => {
  const pending = [];
  const {host, state} = createHost({
    getPromptMessages: () => new Promise((resolve) => {
      pending.push(resolve);
    })
  });
  const handler = createHandler([createPrompt(), createPrompt({promptName: 'other', commandName: 'docs:other'})]);

  // A 取回在飞 → Esc 取消 → 启动 B；handler 是同一个实例，早先的实现会让 A 顶替 B。
  handler.start('/docs:code_review code=1', host);
  await handler.handleEvent(state.active, {type: INPUT_EVENTS.ESCAPE}, host);
  handler.start('/docs:other code=2', host);
  const sessionB = state.active;

  pending[0]({ok: true, messages: [{role: 'user', content: {kind: 'text', text: 'A result'}}]});
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(state.active, sessionB);
  assert.deepEqual(state.submitted, []);

  // B 自己的结果仍然正常提交。
  pending[1]({ok: true, messages: [{role: 'user', content: {kind: 'text', text: 'B result'}}]});
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(state.active, null);
  assert.equal(state.submitted.length, 1);
  assert.equal(state.submitted[0].displayText, '/docs:other code=2');
  assert.match(state.submitted[0].text, /B result/u);
});

test('prompt command does not surface a late failure from a previous session', async () => {
  const pending = [];
  const {host, state} = createHost({
    getPromptMessages: () => new Promise((resolve) => {
      pending.push(resolve);
    })
  });
  const handler = createHandler([createPrompt(), createPrompt({promptName: 'other', commandName: 'docs:other'})]);

  handler.start('/docs:code_review code=1', host);
  await handler.handleEvent(state.active, {type: INPUT_EVENTS.ESCAPE}, host);
  handler.start('/docs:other code=2', host);
  const sessionB = state.active;

  pending[0]({ok: false, reason: 'failed', message: 'A failed'});
  await new Promise((resolve) => setImmediate(resolve));

  // B 的取回面板不被 A 的错误信息替换。
  assert.equal(state.active, sessionB);
  assert.equal(state.active.surface.kind, 'info');
  assert.deepEqual(state.active.surface.lines, ['正在取回 MCP prompt…']);
  assert.deepEqual(state.submitted, []);
});

test('prompt messages render placeholders for non-text content and stay bounded', () => {
  const prompt = createPrompt();
  const rendered = formatPromptMessages(prompt, [
    {role: 'user', content: {kind: 'text', text: 'hello'}},
    {role: 'user', content: {kind: 'image', mimeType: 'image/png', sizeBytes: 55}},
    {role: 'user', content: {kind: 'resource', uri: 'demo://doc/1', mimeType: 'text/markdown'}},
    {role: 'user', content: {kind: 'resource_link', uri: 'demo://doc/2', name: 'doc-2'}}
  ]);

  assert.match(rendered, /\[image: image\/png, 55 bytes\]/u);
  assert.match(rendered, /\[embedded resource: demo:\/\/doc\/1 \(text\/markdown\)\]/u);
  assert.match(rendered, /read_mcp_resource \(server: docs, uri: demo:\/\/doc\/1\)/u);
  assert.match(rendered, /\[resource_link: demo:\/\/doc\/2 \(doc-2\)\]/u);

  const oversized = formatPromptMessages(prompt, [
    {role: 'user', content: {kind: 'text', text: 'x'.repeat(MAX_MCP_PROMPT_MESSAGE_BYTES + 500)}}
  ]);

  assert.match(oversized, new RegExp(`${TRUNCATION_MARKER.replace(/[[\]]/gu, '\\$&')}$`, 'u'));
  assert.ok(Buffer.byteLength(oversized, 'utf8') <= MAX_MCP_PROMPT_MESSAGE_BYTES);
});

test('prompt arguments parse positional, key=value and quoted tokens', () => {
  const prompt = createPrompt();

  assert.deepEqual(parsePromptArguments(prompt, 'a b'), {ok: true, values: {code: 'a', lang: 'b'}});
  assert.deepEqual(parsePromptArguments(prompt, 'lang=ts'), {ok: true, values: {lang: 'ts'}});
  assert.deepEqual(parsePromptArguments(prompt, 'a lang=ts'), {ok: true, values: {code: 'a', lang: 'ts'}});
  assert.deepEqual(parsePromptArguments(prompt, undefined), {ok: true, values: {}});
  assert.deepEqual(parsePromptArguments(prompt, 'nope=1'), {ok: false, message: '未知参数：nope'});
  assert.deepEqual(parsePromptArguments(prompt, 'a b c'), {ok: false, message: '参数过多：c'});
  assert.deepEqual(tokenizeArguments('"a b" c'), ['a b', 'c']);
});

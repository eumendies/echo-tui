const test = require('node:test');
const assert = require('node:assert/strict');

const { renderShellBlock } = require('../../src/render/blocks/message-renderer');
const { createShellLiveOutputState, getShellCommittedOutputText, renderShellCompletionContent, renderShellEchoContent, scanShellLiveOutput, takeShellStableContent, takeShellStableOutput } = require('../../src/render/live/shell-renderer');
const { sanitizeTerminalText } = require('../../src/terminal/control-chars');

test('scanShellLiveOutput normalizes CRLF across chunks and only commits complete lines', () => {
  const state = createShellLiveOutputState();

  // 驻留的 CR 尚未和下一字符组成 CRLF 时没有任何完整行边界。
  scanShellLiveOutput(state, 'alpha\r');
  assert.equal(takeShellStableOutput(state), null);

  scanShellLiveOutput(state, 'alpha\r\nbeta\r\npartial');
  assert.equal(takeShellStableOutput(state), 'alpha\nbeta\n');
  assert.equal(getShellCommittedOutputText(state), 'alpha\nbeta\n');
  assert.equal(state.committedRawLength, 'alpha\r\nbeta\r\n'.length);
  assert.equal(takeShellStableOutput(state), null);

  // 控制字符按 sanitizeTerminalText 同口径删除，已扫描前缀只增量推进。
  scanShellLiveOutput(state, 'alpha\r\nbeta\r\npartial\u0007tail\n');
  assert.equal(takeShellStableOutput(state), 'partialtail\n');
});

test('takeShellStableOutput defers whitespace-only output until meaningful content arrives', () => {
  const state = createShellLiveOutputState();

  scanShellLiveOutput(state, '  \n');
  assert.equal(takeShellStableOutput(state), null);

  scanShellLiveOutput(state, '  \nvalue\n');
  assert.equal(takeShellStableOutput(state), '  \nvalue\n');
});

test('shell incremental projection concatenates to the one-shot record block', () => {
  const width = 60;
  const fixtures = [
    {chunks: ['alpha\n', 'beta\n'], echoText: '$ mark', recordText: '$ mark\n\nalpha\nbeta'},
    {chunks: ['alpha\n'], echoText: '$ mark', recordText: '$ mark\n\nalpha\nbeta'},
    {chunks: [], echoText: '$ mark [local]', recordText: '$ mark [local]\n\n[exit 0]'},
    // Esc 中断：error 与 exit 尾注只由 completion 补写。
    {chunks: ['alpha\n'], echoText: '$ mark', recordText: '$ mark\n\nalpha\n\nCommand interrupted\n\n[exit null]'},
    // 输出尾部的 CR 与 record 拼接换行组成 CRLF：净化后尾注只隔一个换行。
    {chunks: ['50%\rbeta\r\n'], echoText: '$ mark', recordText: '$ mark\n\n50%\rbeta\r\n[exit 1]'}
  ];

  for (const fixture of fixtures) {
    const state = createShellLiveOutputState();
    const pieces = [renderShellEchoContent(fixture.echoText, width)];
    let raw = '';

    for (const chunk of fixture.chunks) {
      raw += chunk;
      scanShellLiveOutput(state, raw);
      const stableContent = takeShellStableContent(state, width);
      if (stableContent !== null) pieces.push(stableContent);
    }

    pieces.push(renderShellCompletionContent(fixture.recordText, fixture.echoText, getShellCommittedOutputText(state), width));

    assert.equal(pieces.join(''), renderShellBlock(sanitizeTerminalText(fixture.recordText), width));
  }
});

test('renderShellCompletionContent keeps the committed head when the final record diverges', () => {
  const state = createShellLiveOutputState();
  scanShellLiveOutput(state, 'alpha\n');
  assert.equal(takeShellStableOutput(state), 'alpha\n');

  const content = renderShellCompletionContent(
    '$ mark\n\n[tool result truncated: /tmp/full.txt]\n\nmark_tail',
    '$ mark',
    getShellCommittedOutputText(state),
    80
  );

  assert.ok(content.includes('[tool result truncated: /tmp/full.txt]'));
  assert.ok(content.includes('mark_tail'));
  assert.equal(content.includes('alpha'), false);
  assert.equal(content.includes('$ mark'), false);
});

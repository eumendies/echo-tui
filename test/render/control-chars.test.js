const test = require('node:test');
const assert = require('node:assert/strict');

const {sanitizeTerminalText} = require('../../src/terminal/control-chars');
const appRenderer = require('../../src/render/app-renderer');
const {renderChoiceSurface} = require('../../src/render/footer/choice-surface');
const {createComposer} = require('../../src/input/composer');
const {createTuiTheme} = require('../../src/config/theme-config');

function createFakeOutput() {
  const chunks = [];
  return {
    chunks,
    write(chunk) {
      chunks.push(chunk);
    }
  };
}

test('sanitizeTerminalText normalizes CR and strips control characters', () => {
  assert.equal(
    sanitizeTerminalText('你用的是哪个终端\r?(用于确认\r Ambiguous\r 字符渲染行为\r)'),
    '你用的是哪个终端?(用于确认 Ambiguous 字符渲染行为)'
  );
  assert.equal(sanitizeTerminalText('a\r\nb\rc'), 'a\nbc');
  assert.equal(sanitizeTerminalText('x\u001b[31mred\u0000y\u007fz'), 'x[31mredyz');
  assert.equal(sanitizeTerminalText('保留\n换行\t制表'), '保留\n换行\t制表');
});

test('transcript projection strips control characters from record text fields', () => {
  const lines = appRenderer.renderTranscriptLines([
    {role: 'user', text: '正文\r覆盖', displayText: '显式\r文本'},
    {role: 'tool_call', text: '', toolCallId: 'call-cr-1', toolName: 'ask_user_questions', argumentsText: '{"question":"问题\r?(带回车\r)"}'},
    {role: 'assistant', text: '回复\r\n第二行'}
  ], 80, createTuiTheme(), undefined, false);

  const rendered = lines.join('\n');
  assert.equal(rendered.includes('\r'), false);
  assert.match(rendered, /显式文本/u);
  assert.match(rendered, /问题\?\(带回车\)/u);
  assert.match(rendered, /第二行/u);
});

test('pending drafts are sanitized before footer projection', () => {
  const pending = appRenderer.sanitizePendingDisplayText({kind: 'streaming', text: '草稿\r覆盖\r\n下一行', reasoningText: '推理\r草稿', historyText: '历史\r部分'});
  assert.equal(pending.text, '草稿覆盖\n下一行');
  assert.equal(pending.reasoningText, '推理草稿');
  assert.equal(pending.historyText, '历史部分');

  const toolCallPending = appRenderer.sanitizePendingDisplayText({kind: 'tool_call', toolName: 'ask_user_questions', argumentsText: '{"q":"带\r回车"}'});
  assert.equal(toolCallPending.argumentsText, '{"q":"带回车"}');

  // shell 输出的 CR 具有进度条语义,必须保持原样。
  const shellPending = appRenderer.sanitizePendingDisplayText({kind: 'shell_output', command: 'watch\r进度', output: '50%'});
  assert.equal(shellPending.command, 'watch\r进度');
});

test('renderer writes footer without control characters for control-laden pending drafts', () => {
  const output = createFakeOutput();
  const renderer = appRenderer.createAppRenderer(output);
  renderer.renderRecords({
    records: [],
    composer: createComposer(''),
    width: 80,
    theme: createTuiTheme(),
    streamingOwner: 'main',
    pending: {kind: 'streaming', text: '草稿\r覆盖\r\n下一行'}
  });

  const written = output.chunks.join('');
  // footer 的光标定位本身合法使用 CR;这里断言草稿内容被净化:原始 '草稿\r' 序列不再出现。
  assert.equal(written.includes('草稿\r'), false);
  assert.match(written, /草稿覆盖/u);
});

test('choice card renders control-character-laden surface text cleanly', () => {
  const layout = renderChoiceSurface({
    kind: 'choice',
    title: 'Ask user questions · 1 question',
    message: '问题\r?(带回车\r)',
    messageTitle: 'question',
    optionsTitle: '答案(单选)',
    options: [
      {label: '方案\r A\r(推荐\r)', description: '说明\r,带控制符'},
      {label: 'Other', inlineInput: {placeholder: 'Type your answer...', text: '', cursor: 0}}
    ],
    focusedIndex: 0,
    dismissHint: 'Enter 确认 · Esc 取消'
  }, 100);

  for (const line of layout.lines) {
    assert.equal(line.includes('\r'), false);
  }

  const rendered = layout.lines.join('\n');
  assert.match(rendered, /方案 A\(推荐\)/u);
  assert.match(rendered, /问题\?\(带回车\)/u);
  assert.match(rendered, /说明,带控制符/u);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_CONVERSATION_IMAGE_BYTES,
  boundConversationImages,
  estimateRecordImageTokens,
  getConversationImageBytes
} = require('../../src/agent/context/conversation-image-budget');
const {convertTranscriptToOpenAiInput} = require('../../src/agent/openai-responses/transcript-converter');
const {convertTranscriptToOpenAiChatMessages} = require('../../src/agent/openai-chat/transcript-converter');
const {convertTranscriptToAnthropicMessages} = require('../../src/agent/anthropic/transcript-converter');
const {createCodexRequest} = require('../../src/agent/codex/agent');

function image(path, bytes, sizeBytes = bytes.length) {
  return {kind: 'image', mediaType: 'image/png', path, sizeBytes, dataBase64: Buffer.from(bytes).toString('base64')};
}

test('image budget accounts for actual bytes rather than missing or incorrect metadata', () => {
  const oldImage = image('old.png', '123456', 1);
  const newImage = image('new.png', '12345', undefined);
  delete newImage.sizeBytes;
  const records = [
    {role: 'user', text: 'old', attachments: [oldImage]},
    {role: 'user', text: 'new', attachments: [newImage]}
  ];

  assert.equal(DEFAULT_CONVERSATION_IMAGE_BYTES, 10_000_000);
  assert.equal(getConversationImageBytes(records), 11);
  assert.equal(estimateRecordImageTokens(records[0]), 2048);
  const bounded = boundConversationImages(records, 8);
  assert.equal(bounded.omittedImages, 1);
  assert.deepEqual(bounded.records[0].attachments, []);
  assert.deepEqual(bounded.records[1].attachments, [newImage]);
  assert.equal(getConversationImageBytes(bounded.records), 5);
  assert.deepEqual(records[0].attachments, [oldImage]);
  assert.equal(records[0].text, 'old');
  assert.doesNotMatch(bounded.records[0].text, /read_files/);
  assert.match(bounded.records[0].text, /pixels are not visible/);
});

test('unchanged requests preserve identical prefix and reference; mixed sources keep tool pairs', () => {
  const first = image('first.png', '12345');
  const second = image('second.png', '67890');
  const third = image('third.png', 'abcde');
  const records = [
    {role: 'system', text: 'system'},
    {role: 'user', text: 'uploaded', attachments: [first]},
    {role: 'tool_call', text: '', toolCallId: 'call-1', toolName: 'read_files', argumentsText: '{}'},
    {role: 'tool_result', text: '--- image: second.png\nimage_attached: true', toolCallId: 'call-1', toolName: 'read_files', ok: true, attachments: [second]},
    {role: 'extension', text: '', extension: {kind: 'openai_reasoning', item: {type: 'reasoning', encrypted_content: 'secret'}}},
    {role: 'tool_call', text: '', toolCallId: 'call-2', toolName: 'read_files', argumentsText: '{}'},
    {role: 'tool_result', text: '--- image: third.png\nimage_attached: true', toolCallId: 'call-2', toolName: 'read_files', ok: true, attachments: [third]}
  ];

  assert.equal(boundConversationImages(records, 15).records, records);
  const {records: bounded, omittedImages} = boundConversationImages(records, 10);
  assert.equal(omittedImages, 1);
  assert.equal(bounded[0], records[0]);
  assert.equal(bounded[2], records[2]);
  assert.equal(bounded[4], records[4]);
  assert.equal(bounded[6], records[6]);
  assert.match(bounded[1].text, /omitted from this request/);
  assert.equal(bounded[3].toolCallId, records[3].toolCallId);
  assert.equal(bounded[3].text, records[3].text);

  const small = boundConversationImages(records, 5).records;
  assert.equal(small[3].toolCallId, 'call-1');
  assert.match(small[3].text, /image_attached: true/);
  assert.match(small[3].text, /second\.png.*use read_files/);
  assert.deepEqual(small[3].attachments, []);
  assert.deepEqual(small[6].attachments, [third]);
  assert.equal(records[3].text.includes('omitted'), false);
});

test('oversized image is omitted atomically; smaller older image can still fit', () => {
  const records = [{role: 'user', text: 'earlier', attachments: [image('small.png', '123')]}, {role: 'user', text: 'latest', attachments: [image('big.png', '123456789')]}];
  const bounded = boundConversationImages(records, 4);
  assert.equal(bounded.omittedImages, 1);
  assert.equal(getConversationImageBytes(bounded.records), 3);
  assert.deepEqual(bounded.records[0].attachments, records[0].attachments);
  assert.deepEqual(bounded.records[1].attachments, []);
});

test('all provider converters and Codex request respect the same bounded native tool history', () => {
  const records = [
    {role: 'system', text: 'system'},
    {role: 'tool_call', text: '', toolCallId: 'call-1', toolName: 'read_files', argumentsText: '{}'},
    {role: 'tool_result', text: 'old result', toolCallId: 'call-1', toolName: 'read_files', ok: true, attachments: [image('old.png', '12345')]},
    {role: 'tool_call', text: '', toolCallId: 'call-2', toolName: 'read_files', argumentsText: '{}'},
    {role: 'tool_result', text: 'new result', toolCallId: 'call-2', toolName: 'read_files', ok: true, attachments: [image('new.png', '12345')]}
  ];
  const bounded = boundConversationImages(records, 5).records;
  const responses = convertTranscriptToOpenAiInput(bounded);
  const chat = convertTranscriptToOpenAiChatMessages(bounded);
  const anthropic = convertTranscriptToAnthropicMessages(bounded).messages;
  const codex = createCodexRequest(bounded, {model: 'codex-test'}, undefined, {sessionId: 'stable'});

  assert.equal(JSON.stringify(responses).match(/input_image/g)?.length, 1);
  assert.equal(JSON.stringify(chat).match(/image_url/g)?.length, 2); // block 与内部字段各出现一次
  assert.equal(JSON.stringify(anthropic).match(/"type":"image"/g)?.length, 1);
  assert.equal(JSON.stringify(codex.input).match(/input_image/g)?.length, 1);
  assert.ok(responses.some((item) => item.call_id === 'call-1' && item.output?.includes('old.png')));
  assert.ok(chat.some((item) => item.role === 'tool' && item.tool_call_id === 'call-1'));
  assert.ok(anthropic.some((message) => message.content.some((item) => item.type === 'tool_result' && item.tool_use_id === 'call-1')));
  assert.equal(codex.prompt_cache_key, 'echo-tui-stable');
});

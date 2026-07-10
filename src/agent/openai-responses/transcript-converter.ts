import {formatImageDataUrl, formatShellRecordForProvider, formatToolResultImageIntro, getValidImageAttachments, hasToolCallId, hasToolCallMetadata} from '../transcript-converter-common';
import {OPENAI_REASONING_TRANSCRIPT_ROLE} from '../../types/transcript';

import type {TranscriptRecord} from '../../types/transcript';

export type OpenAiInputMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string | OpenAiInputContentBlock[];
};

export type OpenAiInputTextBlock = {
  type: 'input_text';
  text: string;
};

export type OpenAiInputImageBlock = {
  type: 'input_image';
  image_url: string;
};

export type OpenAiInputContentBlock = OpenAiInputTextBlock | OpenAiInputImageBlock;

export type OpenAiFunctionCallInputItem = {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
};

export type OpenAiFunctionCallOutputInputItem = {
  type: 'function_call_output';
  call_id: string;
  output: string;
};

export type OpenAiReasoningInputItem = {
  type: 'reasoning';
  [key: string]: unknown;
};

export type OpenAiInputItem = OpenAiInputMessage | OpenAiFunctionCallInputItem | OpenAiFunctionCallOutputInputItem | OpenAiReasoningInputItem;

type OpenAiInputRole = OpenAiInputMessage['role'];

const OPENAI_REASONING_RECORD_ROLE = OPENAI_REASONING_TRANSCRIPT_ROLE;

/**
 * 把本地 transcript 投影为 OpenAI Responses API 可接收的 input。
 */
function convertTranscriptToOpenAiInput(records: TranscriptRecord[]): OpenAiInputItem[] {
  const messages: OpenAiInputItem[] = [];

  for (const record of records) {
    if (isOpenAiInputRole(record.role)) {
      messages.push({
        role: record.role,
        content: record.role === 'user' ? createUserContent(record) : record.text
      });

      continue;
    }

    if (record.role === 'tool_call') {
      const item = convertToolCallRecord(record);

      if (item) {
        messages.push(item);
      }

      continue;
    }

    if (record.role === 'tool_result') {
      const item = convertToolResultRecord(record);

      if (item) {
        messages.push(item);
      }

      const imageMessage = createToolResultImageMessage(record);

      if (imageMessage) {
        messages.push(imageMessage);
      }

      continue;
    }

    if (record.role === 'shell') {
      if (record.includeInContext !== false) {
        messages.push({
          role: 'user',
          content: formatShellRecordForProvider(record)
        });
      }

      continue;
    }

    if (record.role === OPENAI_REASONING_RECORD_ROLE) {
      const item = convertOpenAiReasoningRecord(record);

      if (item) {
        messages.push(item);
      }

      continue;
    }

    // error/local_notice 等本地反馈，以及未知 role，都不透传到 provider 请求。
  }

  return messages;
}

function createUserContent(record: TranscriptRecord): string | OpenAiInputContentBlock[] {
  const attachments = getValidImageAttachments(record);

  if (attachments.length === 0) {
    return record.text;
  }

  return [
    {type: 'input_text', text: record.text},
    ...attachments.map((attachment): OpenAiInputImageBlock => ({
      type: 'input_image',
      image_url: formatImageDataUrl(attachment)
    }))
  ];
}

function convertToolCallRecord(record: TranscriptRecord): OpenAiFunctionCallInputItem | null {
  if (!hasToolCallMetadata(record)) {
    // 兼容旧 session：缺少 metadata 的历史 tool_call 文本不能安全回注给 OpenAI。
    return null;
  }

  return {
    type: 'function_call',
    call_id: record.toolCallId,
    name: record.toolName,
    arguments: record.argumentsText
  };
}

/**
 * 把本地 tool_result 回注为 OpenAI function_call_output。
 */
function convertToolResultRecord(record: TranscriptRecord): OpenAiFunctionCallOutputInputItem | null {
  if (!hasToolCallId(record)) {
    // 没有 call_id 就无法和前序 function_call 配对，必须跳过。
    return null;
  }

  return {
    type: 'function_call_output',
    call_id: record.toolCallId,
    output: record.text
  };
}

function createToolResultImageMessage(record: TranscriptRecord): OpenAiInputMessage | null {
  if (!hasToolCallId(record)) {
    return null;
  }

  const attachments = getValidImageAttachments(record);

  if (attachments.length === 0) {
    return null;
  }

  return {
    role: 'user',
    content: [
      {
        type: 'input_text',
        text: formatToolResultImageIntro(record)
      },
      ...attachments.map((attachment): OpenAiInputImageBlock => ({
        type: 'input_image',
        image_url: formatImageDataUrl(attachment)
      }))
    ]
  };
}

function isOpenAiInputRole(role: TranscriptRecord['role']): role is OpenAiInputRole {
  return role === 'user' || role === 'assistant' || role === 'system';
}

function createOpenAiReasoningRecord(item: OpenAiReasoningInputItem): TranscriptRecord {
  return {
    role: OPENAI_REASONING_RECORD_ROLE,
    text: '',
    item,
    provider: 'openai'
  };
}

function convertOpenAiReasoningRecord(record: TranscriptRecord): OpenAiReasoningInputItem | null {
  const item = record.item;

  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }

  const candidate = item as {encrypted_content?: unknown; type?: unknown};

  if (candidate.type !== 'reasoning' || typeof candidate.encrypted_content !== 'string' || candidate.encrypted_content.trim() === '') {
    return null;
  }

  return item as OpenAiReasoningInputItem;
}

export {
  OPENAI_REASONING_RECORD_ROLE,
  createOpenAiReasoningRecord,
  convertTranscriptToOpenAiInput
};

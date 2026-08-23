import {formatImageDataUrl, formatShellRecordForProvider, formatToolResultImageIntro, getValidImageAttachments} from '../transcript-converter-common';
import {OPENAI_REASONING_EXTENSION_KIND} from '../../types/transcript';
import {shouldIncludeRecordInProviderContext} from '../transcript-converter-common';

import type {ToolCallTranscriptRecord, ToolResultTranscriptRecord, TranscriptExtensionRecord, TranscriptRecord, UserTranscriptRecord} from '../../types/transcript';

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
  encrypted_content: string;
  [key: string]: unknown;
};

export type OpenAiInputItem = OpenAiInputMessage | OpenAiFunctionCallInputItem | OpenAiFunctionCallOutputInputItem | OpenAiReasoningInputItem;

type OpenAiInputRole = OpenAiInputMessage['role'];

const OPENAI_REASONING_RECORD_KIND = OPENAI_REASONING_EXTENSION_KIND;

/**
 * 把本地 transcript 投影为 OpenAI Responses API 可接收的 input。
 */
function convertTranscriptToOpenAiInput(records: TranscriptRecord[]): OpenAiInputItem[] {
  const messages: OpenAiInputItem[] = [];

  for (const record of records) {
    if (!shouldIncludeRecordInProviderContext(record)) {
      continue;
    }

    if (isOpenAiInputRole(record.role)) {
      messages.push({
        role: record.role,
        content: record.role === 'user' ? createUserContent(record) : record.text
      });

      continue;
    }

    if (record.role === 'tool_call') {
      messages.push(convertToolCallRecord(record));

      continue;
    }

    if (record.role === 'tool_result') {
      messages.push(convertToolResultRecord(record));

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

    if (record.role === 'extension' && record.extension.kind === OPENAI_REASONING_RECORD_KIND) {
      const item = convertOpenAiReasoningRecord(record);
      messages.push(item);

      continue;
    }

    // error/local_notice 等本地反馈，以及未知 role，都不透传到 provider 请求。
  }

  return messages;
}

function createUserContent(record: UserTranscriptRecord): string | OpenAiInputContentBlock[] {
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

function convertToolCallRecord(record: ToolCallTranscriptRecord): OpenAiFunctionCallInputItem {
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
function convertToolResultRecord(record: ToolResultTranscriptRecord): OpenAiFunctionCallOutputInputItem {
  return {
    type: 'function_call_output',
    call_id: record.toolCallId,
    output: record.text
  };
}

function createToolResultImageMessage(record: ToolResultTranscriptRecord): OpenAiInputMessage | null {
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

function createOpenAiReasoningRecord(item: OpenAiReasoningInputItem): TranscriptExtensionRecord {
  return {
    role: 'extension',
    text: '',
    extension: {
      kind: OPENAI_REASONING_RECORD_KIND,
      item
    }
  };
}

function convertOpenAiReasoningRecord(record: TranscriptExtensionRecord): OpenAiReasoningInputItem {
  const extension = record.extension;

  if (extension.kind !== OPENAI_REASONING_RECORD_KIND) {
    throw new Error('OpenAI reasoning record kind mismatch');
  }

  return extension.item;
}

export {
  OPENAI_REASONING_RECORD_KIND,
  createOpenAiReasoningRecord,
  convertTranscriptToOpenAiInput
};

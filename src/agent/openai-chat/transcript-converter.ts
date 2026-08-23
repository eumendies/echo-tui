import {
  consumeInvalidToolResultFeedback,
  formatImageDataUrl,
  formatInvalidToolCallFeedback,
  formatShellRecordForProvider,
  formatToolResultImageIntro,
  getValidImageAttachments,
  hasKnownToolCallId,
  parseJsonObjectText
} from '../transcript-converter-common';
import {shouldIncludeRecordInProviderContext} from '../transcript-converter-common';
import {OPENAI_CHAT_REASONING_EXTENSION_KIND} from '../../types/transcript';

import type {ToolCallTranscriptRecord, ToolResultTranscriptRecord, TranscriptExtensionRecord, TranscriptRecord, UserTranscriptRecord} from '../../types/transcript';

export type OpenAiChatMessage =
  | OpenAiChatTextMessage
  | OpenAiChatAssistantMessage
  | OpenAiChatToolMessage;

export type OpenAiChatTextMessage = {
  role: 'system' | 'user';
  content: string | OpenAiChatContentBlock[];
};

export type OpenAiChatTextContentBlock = {
  type: 'text';
  text: string;
};

export type OpenAiChatImageContentBlock = {
  type: 'image_url';
  image_url: {
    url: string;
  };
};

export type OpenAiChatContentBlock = OpenAiChatTextContentBlock | OpenAiChatImageContentBlock;

export type OpenAiChatAssistantMessage = {
  role: 'assistant';
  content: string;
  reasoning_content?: string;
  tool_calls?: OpenAiChatToolCall[];
};

export type OpenAiChatToolMessage = {
  role: 'tool';
  tool_call_id: string;
  content: string;
};

export type OpenAiChatToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

type ToolCallProjection =
  | {kind: 'valid'; toolCall: OpenAiChatToolCall}
  | {kind: 'invalid'; feedback: string; id: string};

const FILTERED_ROLES = new Set(['error', 'compaction_notice', 'local_notice', 'reasoning_summary']);

/**
 * 把本地 transcript 投影为 Chat Completions messages，并把平铺工具记录重组成 Chat 工具历史。
 */
function convertTranscriptToOpenAiChatMessages(records: TranscriptRecord[]): OpenAiChatMessage[] {
  const messages: OpenAiChatMessage[] = [];
  const knownToolCallIds = new Set<string>();
  const invalidToolCallFeedback = new Map<string, string>();
  const pendingImageMessages: OpenAiChatTextMessage[] = [];
  let currentToolAssistant: OpenAiChatAssistantMessage | null = null;
  let pendingReasoningContent: string | null = null;

  for (const record of records) {
    if (!shouldIncludeRecordInProviderContext(record)) {
      continue;
    }

    if (record.role !== 'tool_result') {
      flushPendingImageMessages(messages, pendingImageMessages);
    }

    if (record.role === 'system') {
      messages.push({role: 'system', content: record.text});
      currentToolAssistant = null;
      pendingReasoningContent = null;
      continue;
    }

    if (record.role === 'user') {
      messages.push({role: 'user', content: createUserContent(record)});
      currentToolAssistant = null;
      pendingReasoningContent = null;
      continue;
    }

    if (record.role === 'assistant') {
      currentToolAssistant = createAssistantMessage(record.text, pendingReasoningContent);
      messages.push(currentToolAssistant);
      pendingReasoningContent = null;
      continue;
    }

    if (record.role === 'shell') {
      if (record.includeInContext !== false) {
        messages.push({role: 'user', content: formatShellRecordForProvider(record)});
      }
      currentToolAssistant = null;
      pendingReasoningContent = null;
      continue;
    }

    if (record.role === 'extension' && record.extension.kind === OPENAI_CHAT_REASONING_EXTENSION_KIND) {
      pendingReasoningContent = readChatReasoningContent(record);
      continue;
    }

    if (record.role === 'extension') {
      continue;
    }

    if (record.role === 'tool_call') {
      const projection = convertToolCallRecord(record);

      if (!projection) {
        continue;
      }

      if (projection.kind === 'invalid') {
        invalidToolCallFeedback.set(projection.id, projection.feedback);
        currentToolAssistant = null;
        pendingReasoningContent = null;
        continue;
      }

      const assistant: OpenAiChatAssistantMessage = currentToolAssistant || createToolAssistantMessage(messages, pendingReasoningContent);
      assistant.tool_calls = [...(assistant.tool_calls || []), projection.toolCall];
      currentToolAssistant = assistant;
      pendingReasoningContent = null;
      knownToolCallIds.add(projection.toolCall.id);
      continue;
    }

    if (record.role === 'tool_result') {
      const feedbackMessage = convertInvalidToolResultRecord(record, invalidToolCallFeedback);

      if (feedbackMessage) {
        flushPendingImageMessages(messages, pendingImageMessages);
        messages.push(feedbackMessage);
        currentToolAssistant = null;
        pendingReasoningContent = null;
        continue;
      }

      const toolMessage = convertToolResultRecord(record, knownToolCallIds);

      if (toolMessage) {
        messages.push(toolMessage);

        const imageMessage = createToolResultImageMessage(record);

        if (imageMessage) {
          pendingImageMessages.push(imageMessage);
        }
      }

      continue;
    }

    if (FILTERED_ROLES.has(String(record.role))) {
      continue;
    }

    currentToolAssistant = null;
    pendingReasoningContent = null;
  }

  flushPendingImageMessages(messages, pendingImageMessages);

  return messages;
}

function createUserContent(record: UserTranscriptRecord): string | OpenAiChatContentBlock[] {
  const attachments = getValidImageAttachments(record);

  if (attachments.length === 0) {
    return record.text;
  }

  return [
    {type: 'text', text: record.text},
    ...attachments.map((attachment): OpenAiChatImageContentBlock => ({
      type: 'image_url',
      image_url: {
        url: formatImageDataUrl(attachment)
      }
    }))
  ];
}

function createAssistantMessage(content: string, reasoningContent: string | null): OpenAiChatAssistantMessage {
  return {
    role: 'assistant',
    content,
    ...(reasoningContent ? {reasoning_content: reasoningContent} : {})
  };
}

function flushPendingImageMessages(messages: OpenAiChatMessage[], pendingImageMessages: OpenAiChatTextMessage[]): void {
  if (pendingImageMessages.length === 0) {
    return;
  }

  messages.push(...pendingImageMessages);
  pendingImageMessages.length = 0;
}

function createToolAssistantMessage(messages: OpenAiChatMessage[], reasoningContent: string | null): OpenAiChatAssistantMessage {
  const assistant = createAssistantMessage('', reasoningContent);
  messages.push(assistant);
  return assistant;
}

function readChatReasoningContent(record: TranscriptExtensionRecord): string {
  const extension = record.extension;

  if (extension.kind !== OPENAI_CHAT_REASONING_EXTENSION_KIND) {
    throw new Error('OpenAI Chat reasoning record kind mismatch');
  }

  return extension.reasoningContent;
}

function createOpenAiChatReasoningRecord(reasoningContent: string): TranscriptExtensionRecord {
  return {
    role: 'extension',
    text: '',
    extension: {
      kind: OPENAI_CHAT_REASONING_EXTENSION_KIND,
      reasoningContent
    }
  };
}

function convertToolCallRecord(record: ToolCallTranscriptRecord): ToolCallProjection {
  if (!parseJsonObjectText(record.argumentsText)) {
    return {
      kind: 'invalid',
      id: record.toolCallId,
      feedback: formatInvalidToolCallFeedback(record)
    };
  }

  return {
    kind: 'valid',
    toolCall: {
      id: record.toolCallId,
      type: 'function',
      function: {
        name: record.toolName,
        arguments: record.argumentsText
      }
    }
  };
}

function convertToolResultRecord(record: ToolResultTranscriptRecord, knownToolCallIds: Set<string>): OpenAiChatToolMessage | null {
  if (!hasKnownToolCallId(record, knownToolCallIds)) {
    return null;
  }

  return {
    role: 'tool',
    tool_call_id: record.toolCallId,
    content: record.text
  };
}

function createToolResultImageMessage(record: ToolResultTranscriptRecord): OpenAiChatTextMessage | null {
  const attachments = getValidImageAttachments(record);

  if (attachments.length === 0) {
    return null;
  }

  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text: formatToolResultImageIntro(record)
      },
      ...attachments.map((attachment): OpenAiChatImageContentBlock => ({
        type: 'image_url',
        image_url: {
          url: formatImageDataUrl(attachment)
        }
      }))
    ]
  };
}

function convertInvalidToolResultRecord(record: ToolResultTranscriptRecord, invalidToolCallFeedback: Map<string, string>): OpenAiChatTextMessage | null {
  const feedback = consumeInvalidToolResultFeedback(record, invalidToolCallFeedback);

  if (!feedback) {
    return null;
  }

  return {
    role: 'user',
    content: feedback
  };
}

export {createOpenAiChatReasoningRecord, convertTranscriptToOpenAiChatMessages};

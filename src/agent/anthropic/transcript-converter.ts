import {
  consumeInvalidToolResultFeedback,
  formatInvalidToolCallFeedback,
  formatShellRecordForProvider,
  getValidImageAttachments,
  hasKnownToolCallId,
  parseJsonObjectText
} from '../transcript-converter-common';
import {shouldIncludeRecordInProviderContext} from '../transcript-converter-common';
import {ANTHROPIC_THINKING_EXTENSION_KIND} from '../../types/transcript';

import type {ToolCallTranscriptRecord, ToolResultTranscriptRecord, TranscriptExtensionRecord, TranscriptRecord, UserTranscriptRecord} from '../../types/transcript';

export type AnthropicTextBlock = {
  type: 'text';
  text: string;
};

export type AnthropicToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type AnthropicToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string | AnthropicToolResultContentBlock[];
  is_error?: boolean;
};

export type AnthropicThinkingBlock = {
  type: 'thinking';
  thinking: string;
  signature: string;
};

export type AnthropicRedactedThinkingBlock = {
  type: 'redacted_thinking';
  data: string;
};

export type AnthropicImageBlock = {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
};

export type AnthropicToolResultContentBlock = AnthropicTextBlock | AnthropicImageBlock;

export type AnthropicProviderThinkingBlock = AnthropicThinkingBlock | AnthropicRedactedThinkingBlock;

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock | AnthropicToolUseBlock | AnthropicToolResultBlock | AnthropicProviderThinkingBlock;

export type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
};

export type AnthropicTranscriptProjection = {
  messages: AnthropicMessage[];
  system?: string;
};

type ToolCallProjection =
  | {kind: 'valid'; toolUse: AnthropicToolUseBlock}
  | {kind: 'invalid'; feedback: string; id: string};

const FILTERED_ROLES = new Set(['error', 'compaction_notice', 'local_notice', 'reasoning_summary']);

/**
 * 把本地 transcript 投影为 Anthropic Messages API 请求上下文，并重组工具历史 content blocks。
 */
function convertTranscriptToAnthropicMessages(records: TranscriptRecord[]): AnthropicTranscriptProjection {
  const messages: AnthropicMessage[] = [];
  const systemParts: string[] = [];
  const knownToolCallIds = new Set<string>();
  const invalidToolCallFeedback = new Map<string, string>();
  let currentToolAssistant: AnthropicMessage | null = null;

  for (const record of records) {
    if (!shouldIncludeRecordInProviderContext(record)) {
      continue;
    }

    if (record.role === 'system') {
      if (record.text.trim() !== '') {
        systemParts.push(record.text);
      }
      currentToolAssistant = null;
      continue;
    }

    if (record.role === 'user') {
      messages.push({role: 'user', content: createUserContent(record)});
      currentToolAssistant = null;
      continue;
    }

    if (record.role === 'assistant') {
      currentToolAssistant = {role: 'assistant', content: record.text === '' ? [] : [{type: 'text', text: record.text}]};
      messages.push(currentToolAssistant);
      continue;
    }

    if (record.role === 'shell') {
      if (record.includeInContext !== false) {
        messages.push({role: 'user', content: [{type: 'text', text: formatShellRecordForProvider(record)}]});
      }
      currentToolAssistant = null;
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
        continue;
      }

      const assistant: AnthropicMessage = currentToolAssistant || createToolAssistantMessage(messages);
      assistant.content.push(projection.toolUse);
      currentToolAssistant = assistant;
      knownToolCallIds.add(projection.toolUse.id);
      continue;
    }

    if (record.role === 'extension' && record.extension.kind === ANTHROPIC_THINKING_EXTENSION_KIND) {
      const block = convertAnthropicThinkingRecord(record);
      const assistant: AnthropicMessage = currentToolAssistant || createToolAssistantMessage(messages);
      assistant.content.push(block);
      currentToolAssistant = assistant;

      continue;
    }

    if (record.role === 'extension') {
      continue;
    }

    if (record.role === 'tool_result') {
      const feedbackMessage = convertInvalidToolResultRecord(record, invalidToolCallFeedback);

      if (feedbackMessage) {
        messages.push(feedbackMessage);
        currentToolAssistant = null;
        continue;
      }

      const toolMessage = convertToolResultRecord(record, knownToolCallIds);

      if (toolMessage) {
        messages.push(toolMessage);
      }

      currentToolAssistant = null;
      continue;
    }

    if (FILTERED_ROLES.has(String(record.role))) {
      continue;
    }

    currentToolAssistant = null;
  }

  return {
    messages,
    ...(systemParts.length > 0 ? {system: systemParts.join('\n\n')} : {})
  };
}

function createUserContent(record: UserTranscriptRecord): Array<AnthropicTextBlock | AnthropicImageBlock> {
  const attachments = getValidImageAttachments(record);

  if (attachments.length === 0) {
    return [{type: 'text', text: record.text}];
  }

  return [
    {type: 'text', text: record.text},
    ...attachments.map((attachment): AnthropicImageBlock => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: attachment.mediaType,
        data: attachment.dataBase64
      }
    }))
  ];
}

function createToolAssistantMessage(messages: AnthropicMessage[]): AnthropicMessage {
  const assistant: AnthropicMessage = {role: 'assistant', content: []};
  messages.push(assistant);
  return assistant;
}

function convertToolCallRecord(record: ToolCallTranscriptRecord): ToolCallProjection {
  const input = parseJsonObjectText(record.argumentsText);

  if (!input) {
    return {
      kind: 'invalid',
      id: record.toolCallId,
      feedback: formatInvalidToolCallFeedback(record)
    };
  }

  return {
    kind: 'valid',
    toolUse: {
      type: 'tool_use',
      id: record.toolCallId,
      name: record.toolName,
      input
    }
  };
}

function createAnthropicThinkingRecord(block: AnthropicProviderThinkingBlock): TranscriptExtensionRecord {
  return {
    role: 'extension',
    text: '',
    extension: {
      kind: ANTHROPIC_THINKING_EXTENSION_KIND,
      block
    }
  };
}

function convertAnthropicThinkingRecord(record: TranscriptExtensionRecord): AnthropicProviderThinkingBlock {
  const extension = record.extension;

  if (extension.kind !== ANTHROPIC_THINKING_EXTENSION_KIND) {
    throw new Error('Anthropic thinking record kind mismatch');
  }

  return extension.block;
}

function convertToolResultRecord(record: ToolResultTranscriptRecord, knownToolCallIds: Set<string>): AnthropicMessage | null {
  if (!hasKnownToolCallId(record, knownToolCallIds)) {
    return null;
  }

  const imageBlocks = getValidImageAttachments(record).map((attachment): AnthropicImageBlock => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: attachment.mediaType,
      data: attachment.dataBase64
    }
  }));

  return {
    role: 'user',
    content: [{
      type: 'tool_result',
      tool_use_id: record.toolCallId,
      content: imageBlocks.length > 0 ? [{type: 'text', text: record.text}, ...imageBlocks] : record.text,
      ...(record.ok === false ? {is_error: true} : {})
    }]
  };
}

function convertInvalidToolResultRecord(record: ToolResultTranscriptRecord, invalidToolCallFeedback: Map<string, string>): AnthropicMessage | null {
  const feedback = consumeInvalidToolResultFeedback(record, invalidToolCallFeedback);

  if (!feedback) {
    return null;
  }

  return {
    role: 'user',
    content: [{type: 'text', text: feedback}]
  };
}

export {convertTranscriptToAnthropicMessages, createAnthropicThinkingRecord};

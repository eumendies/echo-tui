import {
  consumeInvalidToolResultFeedback,
  formatInvalidToolCallFeedback,
  formatShellRecordForProvider,
  getValidImageAttachments,
  hasKnownToolCallId,
  hasToolCallMetadata,
  parseJsonObjectText
} from '../transcript-converter-common';
import {ANTHROPIC_THINKING_TRANSCRIPT_ROLE, OPENAI_CHAT_REASONING_TRANSCRIPT_ROLE, OPENAI_REASONING_TRANSCRIPT_ROLE} from '../../types/transcript';

import type {TranscriptRecord} from '../../types/transcript';

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

const FILTERED_ROLES = new Set(['error', 'local_notice', 'reasoning_summary', OPENAI_REASONING_TRANSCRIPT_ROLE, OPENAI_CHAT_REASONING_TRANSCRIPT_ROLE]);

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

      const assistant = currentToolAssistant || createToolAssistantMessage(messages);
      assistant.content.push(projection.toolUse);
      currentToolAssistant = assistant;
      knownToolCallIds.add(projection.toolUse.id);
      continue;
    }

    if (record.role === ANTHROPIC_THINKING_TRANSCRIPT_ROLE) {
      const block = convertAnthropicThinkingRecord(record);

      if (block) {
        const assistant = currentToolAssistant || createToolAssistantMessage(messages);
        assistant.content.push(block);
        currentToolAssistant = assistant;
      }

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

function createUserContent(record: TranscriptRecord): Array<AnthropicTextBlock | AnthropicImageBlock> {
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

function convertToolCallRecord(record: TranscriptRecord): ToolCallProjection | null {
  if (!hasToolCallMetadata(record)) {
    return null;
  }

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

function createAnthropicThinkingRecord(block: AnthropicProviderThinkingBlock): TranscriptRecord {
  return {
    role: ANTHROPIC_THINKING_TRANSCRIPT_ROLE,
    text: '',
    block,
    provider: 'anthropic'
  };
}

function convertAnthropicThinkingRecord(record: TranscriptRecord): AnthropicProviderThinkingBlock | null {
  const block = record.block;

  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    return null;
  }

  const candidate = block as Record<string, unknown>;

  if (candidate.type === 'thinking' && typeof candidate.thinking === 'string' && typeof candidate.signature === 'string') {
    return {
      type: 'thinking',
      thinking: candidate.thinking,
      signature: candidate.signature
    };
  }

  if (candidate.type === 'redacted_thinking' && typeof candidate.data === 'string') {
    return {
      type: 'redacted_thinking',
      data: candidate.data
    };
  }

  return null;
}

function convertToolResultRecord(record: TranscriptRecord, knownToolCallIds: Set<string>): AnthropicMessage | null {
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

function convertInvalidToolResultRecord(record: TranscriptRecord, invalidToolCallFeedback: Map<string, string>): AnthropicMessage | null {
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

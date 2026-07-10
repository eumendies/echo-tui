import {OPENAI_CHAT_REASONING_TRANSCRIPT_ROLE, OPENAI_REASONING_TRANSCRIPT_ROLE, type ToolCallTranscriptRecord, type TranscriptRecord} from '../types/transcript';
import {isSupportedToolResultImageMediaType} from '../types/tool';
import type {SupportedToolResultImageMediaType, ToolResultImageAttachment} from '../types/tool';

type ToolResultWithCallId = TranscriptRecord & {toolCallId: string};
type SendableImageAttachment = Pick<ToolResultImageAttachment, 'dataBase64' | 'mediaType'>;

// 这些 role 只描述本地 UI / 内部状态，不应进入 provider 请求或压缩摘要。
const NON_PROVIDER_ROLES = new Set(['error', 'compaction_notice', 'local_notice', 'reasoning_summary', OPENAI_REASONING_TRANSCRIPT_ROLE, OPENAI_CHAT_REASONING_TRANSCRIPT_ROLE]);

function shouldIncludeRecordInProviderContext(record: TranscriptRecord): boolean {
  if (NON_PROVIDER_ROLES.has(String(record.role))) {
    return false;
  }

  if (record.role === 'shell' && record.includeInContext === false) {
    return false;
  }

  return true;
}

function formatShellRecordForProvider(record: TranscriptRecord): string {
  const command = typeof record.command === 'string' && record.command.trim() !== '' ? record.command : '(unknown)';
  const output = typeof record.output === 'string' ? record.output : record.text;
  const lines = [
    'The user ran a local bash command.',
    `command: ${command}`,
    `exit_code: ${formatOptionalValue(record.exitCode)}`
  ];

  if (record.timedOut === true) {
    lines.push('timed_out: true');
  }

  if (record.truncated === true) {
    lines.push('truncated: true');
  }

  lines.push('', 'terminal_output:', output.trim() === '' ? '(empty)' : output);

  return lines.join('\n');
}

function formatOptionalValue(value: unknown): string {
  return value === undefined ? 'unknown' : String(value);
}

function hasToolCallMetadata(record: TranscriptRecord): record is ToolCallTranscriptRecord {
  return typeof record.toolCallId === 'string' && typeof record.toolName === 'string' && typeof record.argumentsText === 'string';
}

function hasToolCallId(record: TranscriptRecord): record is ToolResultWithCallId {
  return typeof record.toolCallId === 'string';
}

function hasKnownToolCallId(record: TranscriptRecord, knownToolCallIds: Set<string>): record is ToolResultWithCallId {
  return hasToolCallId(record) && knownToolCallIds.has(record.toolCallId);
}

function parseJsonObjectText(text: string): Record<string, unknown> | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
}

function formatInvalidToolCallFeedback(record: ToolCallTranscriptRecord): string {
  const detail = `The tool arguments were not a valid JSON object, so the tool was not executed. Raw arguments: ${formatToolArgumentsForFeedback(record.argumentsText)}`;

  return `On the last attempt the model called the tool ${record.toolName}, but the call arguments were invalid. ${detail}`;
}

function formatToolArgumentsForFeedback(argumentsText: string): string {
  const normalized = argumentsText.replace(/\s+/g, ' ').trim();
  const capped = normalized.length > 500 ? `${normalized.slice(0, 500)}...` : normalized;

  return capped === '' ? '<empty>' : capped;
}

function consumeInvalidToolResultFeedback(record: TranscriptRecord, invalidToolCallFeedback: Map<string, string>): string | null {
  if (!hasToolCallId(record)) {
    return null;
  }

  const feedback = invalidToolCallFeedback.get(record.toolCallId);

  if (!feedback) {
    return null;
  }

  invalidToolCallFeedback.delete(record.toolCallId);

  const resultText = record.text.trim();
  const resultLine = resultText !== '' && !feedback.includes(resultText)
    ? `\n\nError returned by the tool: ${resultText}`
    : '';

  return `${feedback}${resultLine}\nFix the arguments and call the tool again.`;
}

function getValidImageAttachments(record: TranscriptRecord): SendableImageAttachment[] {
  if (!Array.isArray(record.attachments)) {
    return [];
  }

  return record.attachments.filter((attachment): attachment is ToolResultImageAttachment => {
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
      return false;
    }

    const candidate = attachment as Partial<ToolResultImageAttachment>;

    return candidate.kind === 'image' &&
      typeof candidate.mediaType === 'string' &&
      isSupportedToolResultImageMediaType(candidate.mediaType) &&
      typeof candidate.dataBase64 === 'string' &&
      candidate.dataBase64.length > 0;
  });
}

function formatImageDataUrl(attachment: SendableImageAttachment): string {
  return `data:${attachment.mediaType};base64,${attachment.dataBase64}`;
}

function formatToolResultImageIntro(record: TranscriptRecord & {toolCallId: string}): string {
  const toolName = typeof record.toolName === 'string' && record.toolName !== '' ? record.toolName : 'tool';

  return `Images attached from tool result ${toolName} (${record.toolCallId}).`;
}

export {
  consumeInvalidToolResultFeedback,
  formatImageDataUrl,
  formatInvalidToolCallFeedback,
  formatShellRecordForProvider,
  formatToolResultImageIntro,
  getValidImageAttachments,
  hasKnownToolCallId,
  hasToolCallId,
  hasToolCallMetadata,
  NON_PROVIDER_ROLES,
  parseJsonObjectText,
  shouldIncludeRecordInProviderContext
};

import {isSupportedToolResultImageMediaType} from '../types/tool';
import type {ToolResultImageAttachment} from '../types/tool';
import type {ShellTranscriptRecord, ToolCallTranscriptRecord, ToolResultTranscriptRecord, TranscriptRecord, UserTranscriptRecord} from '../types/transcript';

type SendableImageAttachment = Pick<ToolResultImageAttachment, 'dataBase64' | 'mediaType'>;
type TranscriptRecordWithAttachments = UserTranscriptRecord | ToolResultTranscriptRecord;

// 这些 role 只描述本地 UI / 内部状态，不应进入 provider 请求或压缩摘要。
const NON_PROVIDER_ROLES = new Set<TranscriptRecord['role']>(['error', 'compaction_notice', 'local_notice', 'reasoning_summary', 'subagent']);

function shouldIncludeRecordInProviderContext(record: TranscriptRecord): boolean {
  if (NON_PROVIDER_ROLES.has(record.role)) {
    return false;
  }

  if (record.role === 'shell' && record.includeInContext === false) {
    return false;
  }

  if (record.role === 'extension' && record.extension.kind === 'unknown') {
    return false;
  }

  return true;
}

function formatShellRecordForProvider(record: ShellTranscriptRecord): string {
  const command = record.command.trim() !== '' ? record.command : '(unknown)';
  const output = record.output;
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

function hasKnownToolCallId(record: ToolResultTranscriptRecord, knownToolCallIds: Set<string>): boolean {
  return knownToolCallIds.has(record.toolCallId);
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

function consumeInvalidToolResultFeedback(record: ToolResultTranscriptRecord, invalidToolCallFeedback: Map<string, string>): string | null {
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

function getValidImageAttachments(record: TranscriptRecordWithAttachments): SendableImageAttachment[] {
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

function formatToolResultImageIntro(record: ToolResultTranscriptRecord): string {
  const toolName = record.toolName !== '' ? record.toolName : 'tool';

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
  NON_PROVIDER_ROLES,
  parseJsonObjectText,
  shouldIncludeRecordInProviderContext
};

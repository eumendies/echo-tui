import type {SubagentTranscriptEvent, SubagentTranscriptRecord, ToolResultTranscriptDetails} from '../../types/transcript';

const SUBAGENT_FAILURE_HANDOFF_MAX_CHARS = 12000;
const HANDOFF_HEADER_MAX_CHARS = 800;
const HANDOFF_UNCERTAIN_TOOLS_MAX_CHARS = 2000;
const HANDOFF_COMPLETED_TOOLS_MAX_CHARS = 3400;
const HANDOFF_STABLE_ASSISTANT_MAX_CHARS = 2400;
const HANDOFF_INCOMPLETE_DRAFT_MAX_CHARS = 2200;
const HANDOFF_REASONING_MAX_CHARS = 900;
const HANDOFF_FINAL_NOTE_MAX_CHARS = 200;

type SubagentFailureHandoffSnapshot = {
  records: SubagentTranscriptRecord[]; // 当前 run 已发布到父 runtime 的有序稳定过程副本。
  incompleteAssistantDraft?: string; // 当前 provider segment 尚未稳定提交的最新 assistant 草稿。
};

type SubagentFailureHandoffInput = {
  errorText: string; // 已经过敏感信息清理的简洁失败诊断。
  snapshot: SubagentFailureHandoffSnapshot; // accumulator 在失败边界冻结的过程快照。
};

type SubagentToolCallEvent = Extract<SubagentTranscriptEvent, {kind: 'tool_call'}>;
type SubagentToolResultEvent = Extract<SubagentTranscriptEvent, {kind: 'tool_result'}>;

type SubagentToolCallRecord = Omit<SubagentTranscriptRecord, 'event'> & {
  event: SubagentToolCallEvent; // 当前稳定过程中的内部工具调用事实。
};

type SubagentToolResultRecord = Omit<SubagentTranscriptRecord, 'event'> & {
  event: SubagentToolResultEvent; // 与内部调用匹配的稳定执行结果事实。
};

type SubagentToolProgress = {
  call: SubagentToolCallRecord; // 按物理发生顺序保存的内部调用。
  result?: SubagentToolResultRecord; // 缺省表示执行结果状态不明，而不是已知失败。
};

type TruncatedText = {
  text: string; // 满足给定字符上限的确定性头尾投影。
  truncated: boolean; // 是否省略了原始文本的中间内容。
};

const MAX_COMPLETED_TOOL_ENTRIES = 6;
const MAX_UNCERTAIN_TOOL_ENTRIES = 8;
const MAX_STABLE_ASSISTANT_SEGMENTS = 3;
const MAX_REASONING_SUMMARIES = 2;
const SIDE_EFFECT_TOOL_NAMES = new Set(['apply_patch', 'edit_file', 'run_bash_command']);

/** 收集一次子运行可交接的稳定事实和当前未完成正文，不持有 App 或持久化对象。 */
class SubagentFailureHandoffAccumulator {
  private readonly records: SubagentTranscriptRecord[] = [];
  private incompleteAssistantDraft = '';

  /** 在同一入口记录即将发布的稳定过程，保证交接顺序与父 runtime 一致。 */
  record(records: SubagentTranscriptRecord[]): void {
    this.records.push(...records);
  }

  /** 进入新的 provider segment 时清除旧 segment 的瞬时草稿。 */
  beginAssistantSegment(): void {
    this.incompleteAssistantDraft = '';
  }

  /** 只保留当前 segment 最新完整 assistant draft；空白草稿等价于没有进展。 */
  updateAssistantDraft(draft: string): void {
    this.incompleteAssistantDraft = draft.trim() === '' ? '' : draft;
  }

  /** assistant segment 已稳定提交或正常完成后，不再把它重复标为 incomplete。 */
  completeAssistantSegment(): void {
    this.incompleteAssistantDraft = '';
  }

  /** 冻结可供纯 builder 消费的浅拷贝，避免后续 callback 改变既有交接输入。 */
  snapshot(): SubagentFailureHandoffSnapshot {
    return {
      records: [...this.records],
      ...(this.incompleteAssistantDraft.trim() === '' ? {} : {incompleteAssistantDraft: this.incompleteAssistantDraft})
    };
  }
}

/** 按 call id 将内部调用与结果配对；没有结果的调用保留为 uncertain。 */
function collectSubagentToolProgress(records: readonly SubagentTranscriptRecord[]): SubagentToolProgress[] {
  const results = new Map<string, SubagentToolResultRecord>();

  for (const record of records) {
    if (record.event.kind === 'tool_result' && !results.has(record.event.toolCallId)) {
      results.set(record.event.toolCallId, record as SubagentToolResultRecord);
    }
  }

  return records
    .filter((record): record is SubagentToolCallRecord => record.event.kind === 'tool_call')
    .map((call) => ({call, ...(results.get(call.event.toolCallId) ? {result: results.get(call.event.toolCallId)} : {})}));
}

/** 从稳定过程和未完成 assistant 草稿构造唯一 provider-facing 失败交接。 */
function buildSubagentFailureHandoff(input: SubagentFailureHandoffInput): string {
  const progress = collectSubagentToolProgress(input.snapshot.records);
  const completed = progress.filter((entry): entry is SubagentToolProgress & {result: SubagentToolResultRecord} => entry.result !== undefined);
  const uncertain = progress.filter((entry) => entry.result === undefined);
  const assistantSegments = input.snapshot.records.filter((record) => record.event.kind === 'assistant' && record.text.trim() !== '').map((record) => record.text);
  const reasoningSummaries = input.snapshot.records.filter((record) => record.event.kind === 'reasoning_summary' && record.text.trim() !== '').map((record) => record.text);
  const incompleteDraft = input.snapshot.incompleteAssistantDraft?.trim() ? input.snapshot.incompleteAssistantDraft : undefined;
  const sections: string[] = [createHeader(input.errorText, HANDOFF_HEADER_MAX_CHARS)];

  if (assistantSegments.length > 0) {
    sections.push(createTextRecordsBlock('Stable output', assistantSegments, MAX_STABLE_ASSISTANT_SEGMENTS, HANDOFF_STABLE_ASSISTANT_MAX_CHARS));
  }
  if (completed.length > 0) {
    sections.push(createCompletedToolsBlock(completed, HANDOFF_COMPLETED_TOOLS_MAX_CHARS));
  }
  if (uncertain.length > 0) {
    sections.push(createUncertainToolsBlock(uncertain, HANDOFF_UNCERTAIN_TOOLS_MAX_CHARS));
  }
  if (incompleteDraft) {
    sections.push(createBoundedBlock('Incomplete draft (unverified)', formatObservation(incompleteDraft), HANDOFF_INCOMPLETE_DRAFT_MAX_CHARS));
  }
  if (assistantSegments.length === 0 && !incompleteDraft && reasoningSummaries.length > 0) {
    sections.push(createTextRecordsBlock('Last stable note', reasoningSummaries, MAX_REASONING_SUMMARIES, HANDOFF_REASONING_MAX_CHARS));
  }

  const hasRecoverableProgress = completed.length > 0 || uncertain.length > 0 || assistantSegments.length > 0 || reasoningSummaries.length > 0 || Boolean(incompleteDraft);
  if (!hasRecoverableProgress) {
    sections.push('No recoverable progress was recorded before the failure.');
  } else {
    sections.push(truncateHeadTail('Use this as partial progress, not as a final answer.', HANDOFF_FINAL_NOTE_MAX_CHARS).text);
  }

  const handoff = sections.filter(Boolean).join('\n\n');
  return truncateHeadTail(handoff, SUBAGENT_FAILURE_HANDOFF_MAX_CHARS).text;
}

function createHeader(errorText: string, maxChars: number): string {
  const error = truncateHeadTail(normalizeInlineText(errorText), Math.max(0, maxChars - 'Subagent failure: '.length));
  return `Subagent failure: ${error.text}${error.truncated ? ' [truncated]' : ''}`.slice(0, maxChars);
}

function createUncertainToolsBlock(entries: SubagentToolProgress[], maxChars: number): string {
  const selected = entries.slice(-MAX_UNCERTAIN_TOOL_ENTRIES);
  const omitted = entries.length - selected.length;
  const lines = selected.map((entry, index) => {
    const call = entry.call.event;
    const sideEffectWarning = isPotentialSideEffectTool(call.toolName)
      ? '\n   Safety: This call may have produced side effects. Verify current state before repeating it.'
      : '';
    return `${index + 1}. \`${escapeInlineCode(call.toolName)}\` — result status unknown\n   Arguments: ${truncateHeadTail(normalizeInlineText(createToolArgumentSummary(call.toolName, call.argumentsText)), 260).text}${sideEffectWarning}`;
  });
  if (omitted > 0) {
    lines.push(`${omitted} additional uncertain tool call(s) omitted by the handoff budget.`);
  }
  return createBoundedBlock('Uncertain tool outcomes', lines.join('\n\n'), maxChars);
}

function createCompletedToolsBlock(
  completed: Array<SubagentToolProgress & {result: SubagentToolResultRecord}>,
  maxChars: number
): string {
  const failedCount = completed.filter((entry) => !entry.result.event.ok).length;
  const succeededCount = completed.length - failedCount;
  const selected = completed.slice(-MAX_COMPLETED_TOOL_ENTRIES);
  const omitted = completed.length - selected.length;
  const lines = selected.map((entry, index) => formatCompletedToolEntry(entry, index + 1));
  if (omitted > 0) {
    lines.unshift(`${omitted} earlier completed tool call(s) omitted; the entries below are the most recent completed calls.`);
  }
  const prefix = `Completed tools: ${succeededCount} succeeded, ${failedCount} failed.`;
  return truncateHeadTail(`${prefix}${lines.length > 0 ? `\n${lines.join('\n\n')}` : ''}`, maxChars).text;
}

function formatCompletedToolEntry(entry: SubagentToolProgress & {result: SubagentToolResultRecord}, index: number): string {
  const call = entry.call.event;
  const result = entry.result;
  const status = result.event.ok ? 'succeeded' : 'failed';
  const details = formatToolResultDetails(result.event.details);
  const files = formatChangedFiles(result.event.details);
  const attachments = formatAttachments(result.event.attachments);
  const includeResultExcerpt = result.event.details.kind !== 'apply_patch' && result.event.details.kind !== 'edit_file' && result.text.trim() !== '';
  const excerpt = includeResultExcerpt ? truncateHeadTail(result.text.trim(), 320) : null;
  const parts = [
    `${index}. \`${escapeInlineCode(call.toolName)}\` — ${status}${details ? `; ${details}` : ''}`,
    `   Arguments: ${truncateHeadTail(normalizeInlineText(createToolArgumentSummary(call.toolName, call.argumentsText)), 260).text}`,
    ...(files.length > 0 ? [`   Files: ${files.join(', ')}`] : []),
    ...(attachments.length > 0 ? [`   Attachments: ${attachments.join(', ')}`] : []),
    ...(excerpt ? [`   Result excerpt${excerpt.truncated ? ' [truncated]' : ''}:\n${formatObservation(excerpt.text, '      ')}`] : [])
  ];
  return truncateHeadTail(parts.join('\n'), 620).text;
}

function createTextRecordsBlock(title: string, values: string[], maxItems: number, maxChars: number): string {
  const selected = values.slice(-maxItems);
  const omitted = values.length - selected.length;
  const parts = selected.map((value) => formatObservation(value));
  if (omitted > 0) {
    parts.unshift(`${omitted} earlier segment(s) omitted by the handoff budget.`);
  }
  return createBoundedBlock(title, parts.join('\n\n'), maxChars);
}

function createBoundedBlock(title: string, body: string, maxChars: number): string {
  const prefix = `${title}:\n`;
  if (prefix.length >= maxChars) {
    return truncateHeadTail(prefix, maxChars).text;
  }
  const bounded = truncateHeadTail(body, maxChars - prefix.length);
  return `${prefix}${bounded.text}`;
}

function createToolArgumentSummary(toolName: string, argumentsText: string): string {
  const parsed = parseArguments(argumentsText);
  if (!parsed) {
    return argumentsText;
  }
  if (toolName === 'apply_patch') {
    return 'patch content omitted; see structured changed-file summary';
  }
  if (toolName === 'edit_file') {
    return typeof parsed.path === 'string'
      ? `path=${parsed.path}; edit content omitted`
      : 'edit content omitted; see structured changed-file summary';
  }
  if (toolName === 'run_bash_command' && typeof parsed.command === 'string') {
    return parsed.command;
  }
  if (toolName === 'read_files' && Array.isArray(parsed.files)) {
    const paths = parsed.files.map((file) => isRecord(file) && typeof file.path === 'string' ? file.path : '').filter(Boolean);
    return paths.length > 0 ? paths.join(', ') : argumentsText;
  }
  if (toolName === 'grep') {
    return joinKnownArguments(parsed, ['pattern', 'glob']);
  }
  if (toolName === 'glob') {
    return joinKnownArguments(parsed, ['pattern']);
  }
  if (toolName === 'web_fetch') {
    return joinKnownArguments(parsed, ['url']);
  }
  if (toolName === 'web_search') {
    return joinKnownArguments(parsed, ['query']);
  }
  return argumentsText;
}

function joinKnownArguments(parsed: Record<string, unknown>, names: string[]): string {
  const parts = names.flatMap((name) => typeof parsed[name] === 'string' ? [`${name}=${parsed[name]}`] : []);
  return parts.length > 0 ? parts.join(', ') : JSON.stringify(parsed);
}

function formatToolResultDetails(details: ToolResultTranscriptDetails): string {
  if (details.kind === 'bash') {
    return [
      ...(details.exitCode === undefined ? [] : [`exit ${String(details.exitCode)}`]),
      ...(details.timedOut ? ['timed out'] : []),
      ...(details.truncated ? ['output truncated'] : [])
    ].join(', ');
  }
  if (details.kind === 'web_fetch' || details.kind === 'web_search') {
    return [...(details.timedOut ? ['timed out'] : []), ...(details.truncated ? ['output truncated'] : [])].join(', ');
  }
  if (details.kind === 'glob' || details.kind === 'grep' || details.kind === 'read_files') {
    return details.truncated ? 'output truncated' : '';
  }
  return '';
}

function formatChangedFiles(details: ToolResultTranscriptDetails): string[] {
  if (details.kind !== 'apply_patch' && details.kind !== 'edit_file') {
    return [];
  }
  const files = details.display?.files || [];
  const projected = files.slice(0, 8).map((file) => `${file.kind} ${normalizeInlineText(file.path)}`);
  if (files.length > projected.length) {
    projected.push(`${files.length - projected.length} more file(s) omitted`);
  }
  return projected;
}

function formatAttachments(attachments: SubagentToolResultEvent['attachments']): string[] {
  const values = attachments || [];
  const projected = values.slice(0, 4).map((attachment) => `${normalizeInlineText(attachment.path)} (${attachment.mediaType}, ${attachment.sizeBytes} bytes)`);
  if (values.length > projected.length) {
    projected.push(`${values.length - projected.length} more attachment(s) omitted`);
  }
  return projected;
}

function isPotentialSideEffectTool(toolName: string): boolean {
  return SIDE_EFFECT_TOOL_NAMES.has(toolName) || toolName.startsWith('mcp__');
}

function parseArguments(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function formatObservation(text: string, prefix = '    '): string {
  return String(text).replace(/\r\n?/g, '\n').split('\n').map((line) => `${prefix}${line}`).join('\n');
}

function normalizeInlineText(text: string): string {
  return String(text).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeInlineCode(text: string): string {
  return normalizeInlineText(text).replace(/`/g, "'");
}

function truncateHeadTail(text: string, maxChars: number): TruncatedText {
  const normalizedMax = Math.max(0, Math.floor(maxChars));
  if (text.length <= normalizedMax) {
    return {text, truncated: false};
  }
  if (normalizedMax === 0) {
    return {text: '', truncated: true};
  }
  const marker = '\n... [content omitted] ...\n';
  if (marker.length >= normalizedMax) {
    return {text: text.slice(0, normalizedMax), truncated: true};
  }
  const available = normalizedMax - marker.length;
  const headLength = Math.ceil(available / 2);
  const tailLength = Math.floor(available / 2);
  return {
    text: `${text.slice(0, headLength)}${marker}${tailLength > 0 ? text.slice(-tailLength) : ''}`,
    truncated: true
  };
}

export {
  SubagentFailureHandoffAccumulator,
  buildSubagentFailureHandoff
};

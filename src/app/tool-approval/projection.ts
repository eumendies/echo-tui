import {isMcpToolName} from '../../mcp/manager';
import {ASK_USER_QUESTIONS_TOOL_NAME, parseAskUserQuestionsToolCall} from '../../tools/ask-user-questions-tool-handler';
import {APPLY_PATCH_TOOL_NAME} from '../../tools/apply-patch-tool-handler';
import {EDIT_FILE_TOOL_NAME} from '../../tools/edit-file-tool-handler';
import {RUN_BASH_COMMAND_TOOL_NAME} from '../../tools/bash-tool-handler';
import {parseBashCommand} from '../../tools/tool-risk-classifier';

import type {AskUserQuestionsRequest, ToolApprovalRequest, ToolCall} from '../../types/tool';
import type {TranscriptRecord} from '../../types/transcript';

const TOOL_APPROVAL_ACTION_MAX_CHARACTERS = 8_000;
const TOOL_APPROVAL_PROMPT_MAX_CHARACTERS = 16_000;
const CURRENT_USER_REQUEST_MAX_CHARACTERS = 4_000;
const PRIOR_USER_MAX_CHARACTERS = 1_000;
const PRIOR_ASSISTANT_MAX_CHARACTERS = 1_500;
const CLARIFICATION_MAX_CHARACTERS = 1_500;
const SHORT_USER_REQUEST_MAX_CHARACTERS = 240;
const PREVIEW_MAX_CHARACTERS = 500;
const OMITTED_MARKER = '\n[... omitted ...]\n';

type ToolApprovalActionProjection = {
  kind: 'exact' | 'summarized'; // 标识动作是完整表达还是经过有损但显式标记的本地摘要。
  text: string; // 发送给 reviewer 的有界动作文本。
  characterCount: number; // 投影文本的 Unicode code point 数量。
} | {
  kind: 'manual_only'; // 标识动作不能在预算内安全表达，必须直接人工审批。
  reason: 'invalid_arguments' | 'oversized_arguments' | 'unresolved_patch_targets'; // 不含原始参数的稳定回退原因。
};

type ToolApprovalPromptProjection = {
  text: string; // 最终发送给 reviewer 的动态 user message。
  characterCount: number; // 动态 user message 的 Unicode code point 数量。
  hasPriorExchange: boolean; // 是否为短请求附加了前序 user 或 assistant 引用。
  hasClarifications: boolean; // 是否附加了经校验的用户澄清答案。
};

type ToolApprovalPromptInput = {
  action: Extract<ToolApprovalActionProjection, {kind: 'exact' | 'summarized'}>; // 已通过有界检查的待审批动作。
  currentUserRequest: string; // 当前 turn 展开前的用户原始提交文本。
  records: TranscriptRecord[]; // 发起审批时的主 transcript 快照。
  turnUserRecordIndex: number; // 当前 turn user record 在快照中的索引。
};

type PatchOperation = {
  kind: 'add' | 'update' | 'delete'; // patch 对目标文件的操作类型。
  path: string; // patch header 中归一化后的目标路径。
};

/**
 * 按 Unicode code point 边界保留文本头尾；不拆分代理对，也不分配完整 code point 数组。
 */
function truncateApprovalText(text: string, maxCharacters: number, marker = OMITTED_MARKER): string {
  if (maxCharacters <= 0) return '';
  const characterCount = countCodePoints(text, maxCharacters + 1);
  if (characterCount <= maxCharacters) return text;

  const markerCount = countCodePoints(marker);
  if (maxCharacters <= markerCount) return takeCodePointPrefix(marker, maxCharacters);
  const contentBudget = maxCharacters - markerCount;
  const prefixCount = Math.ceil(contentBudget / 2);
  const suffixCount = contentBudget - prefixCount;
  const totalCharacters = countCodePoints(text);
  const prefixEnd = findCodePointOffset(text, prefixCount);
  const suffixStart = findCodePointOffset(text, totalCharacters - suffixCount);
  return `${text.slice(0, prefixEnd)}${marker}${text.slice(suffixStart)}`;
}

/** 统计 Unicode code point；传入上限时在确认超限后提前停止。 */
function countCodePoints(text: string, stopAfter = Number.POSITIVE_INFINITY): number {
  let count = 0;
  for (const _character of text) {
    count += 1;
    if (count >= stopAfter) break;
  }
  return count;
}

/** 返回第 N 个 Unicode code point 之后的 UTF-16 offset。 */
function findCodePointOffset(text: string, targetCount: number): number {
  if (targetCount <= 0) return 0;
  let count = 0;
  let offset = 0;
  for (const character of text) {
    offset += character.length;
    count += 1;
    if (count === targetCount) return offset;
  }
  return text.length;
}

/** 取得不拆分 Unicode code point 的文本前缀。 */
function takeCodePointPrefix(text: string, maxCharacters: number): string {
  let count = 0;
  let end = 0;
  for (const character of text) {
    if (count >= maxCharacters) break;
    end += character.length;
    count += 1;
  }
  return text.slice(0, end);
}

/**
 * 将待审批调用投影成单次 reviewer 可消费的有界动作；超限且不可安全摘要时返回 manual_only。
 */
function projectToolApprovalAction(call: ToolCall, request: ToolApprovalRequest | undefined, cwd: string): ToolApprovalActionProjection {
  if (call.toolName === RUN_BASH_COMMAND_TOOL_NAME) {
    const command = parseBashCommand(call.argumentsText);
    if (!command) return {kind: 'manual_only', reason: 'invalid_arguments'};
    return createExactProjection(formatActionProjection(call.toolName, cwd, request, [`command: ${command}`]));
  }

  if (call.toolName === APPLY_PATCH_TOOL_NAME) {
    return projectApplyPatchAction(call, request, cwd);
  }

  if (call.toolName === EDIT_FILE_TOOL_NAME) {
    return projectEditFileAction(call, request, cwd);
  }

  if (isMcpToolName(call.toolName)) {
    const [, server = 'unknown', ...toolParts] = call.toolName.split('__');
    return createExactProjection(formatActionProjection(call.toolName, cwd, request, [
      `server: ${server}`,
      `operation: ${toolParts.join('__') || 'unknown'}`,
      `arguments: ${call.argumentsText}`
    ]));
  }

  return createExactProjection(formatActionProjection(call.toolName, cwd, request, [`arguments: ${call.argumentsText}`]));
}

/** 在动作预算内创建完整投影，超限时保守回退人工。 */
function createExactProjection(text: string): ToolApprovalActionProjection {
  const characterCount = countCodePoints(text, TOOL_APPROVAL_ACTION_MAX_CHARACTERS + 1);
  return characterCount <= TOOL_APPROVAL_ACTION_MAX_CHARACTERS
    ? {kind: 'exact', text, characterCount}
    : {kind: 'manual_only', reason: 'oversized_arguments'};
}

/** 组合所有动作通用的工具身份、工作目录和有界人工预览。 */
function formatActionProjection(toolName: string, cwd: string, request: ToolApprovalRequest | undefined, lines: string[]): string {
  const preview = request?.preview?.trim();
  return [
    `tool: ${toolName}`,
    `cwd: ${cwd}`,
    ...(preview ? [`approval_preview: ${truncateApprovalText(preview, PREVIEW_MAX_CHARACTERS)}`] : []),
    ...lines
  ].join('\n');
}

/** 小 patch 保留原文，大 patch 只保留完整目标集合和有界头尾正文。 */
function projectApplyPatchAction(call: ToolCall, request: ToolApprovalRequest | undefined, cwd: string): ToolApprovalActionProjection {
  const parsed = parseJsonObject(call.argumentsText);
  const patch = parsed?.patch;
  if (typeof patch !== 'string' || patch.trim() === '') {
    return createExactProjection(formatActionProjection(call.toolName, cwd, request, [`arguments: ${call.argumentsText}`]));
  }

  const exactPrefix = formatActionProjection(call.toolName, cwd, request, ['patch:']);
  const exactCount = countCodePoints(exactPrefix) + 1 + countCodePoints(patch, TOOL_APPROVAL_ACTION_MAX_CHARACTERS + 1);
  if (exactCount <= TOOL_APPROVAL_ACTION_MAX_CHARACTERS) {
    return {kind: 'exact', text: `${exactPrefix}\n${patch}`, characterCount: exactCount};
  }

  const operations = extractPatchOperations(patch);
  if (operations.length === 0) return {kind: 'manual_only', reason: 'unresolved_patch_targets'};
  const metadata = formatActionProjection(call.toolName, cwd, request, [
    `file_count: ${operations.length}`,
    `patch_characters: ${countCodePoints(patch)}`,
    'files:',
    ...operations.map((operation) => `- ${operation.kind}: ${operation.path}`),
    'patch_excerpt:'
  ]);
  const metadataCount = countCodePoints(metadata);
  const excerptBudget = TOOL_APPROVAL_ACTION_MAX_CHARACTERS - metadataCount - 1;
  if (excerptBudget <= countCodePoints(OMITTED_MARKER)) {
    return {kind: 'manual_only', reason: 'unresolved_patch_targets'};
  }
  const text = `${metadata}\n${truncateApprovalText(patch, excerptBudget)}`;
  return {kind: 'summarized', text, characterCount: countCodePoints(text)};
}

/** 对 edit_file 保留完整目标语义，并分别限制 old/new 正文占用。 */
function projectEditFileAction(call: ToolCall, request: ToolApprovalRequest | undefined, cwd: string): ToolApprovalActionProjection {
  const parsed = parseJsonObject(call.argumentsText);
  if (typeof parsed?.path !== 'string' || typeof parsed.old_string !== 'string' || typeof parsed.new_string !== 'string') {
    return createExactProjection(formatActionProjection(call.toolName, cwd, request, [`arguments: ${call.argumentsText}`]));
  }

  const oldString = parsed.old_string;
  const newString = parsed.new_string;
  const oldCharacterCount = countCodePoints(oldString);
  const newCharacterCount = countCodePoints(newString);
  const summarized = oldCharacterCount > 2_800 || newCharacterCount > 2_800;
  const text = formatActionProjection(call.toolName, cwd, request, [
    `path: ${parsed.path}`,
    `replace_all: ${parsed.replace_all === true}`,
    `old_string_characters: ${oldCharacterCount}`,
    `old_string_excerpt:\n${truncateApprovalText(oldString, 2_800)}`,
    `new_string_characters: ${newCharacterCount}`,
    `new_string_excerpt:\n${truncateApprovalText(newString, 2_800)}`
  ]);
  const characterCount = countCodePoints(text, TOOL_APPROVAL_ACTION_MAX_CHARACTERS + 1);
  return characterCount <= TOOL_APPROVAL_ACTION_MAX_CHARACTERS
    ? {kind: summarized ? 'summarized' : 'exact', text, characterCount}
    : {kind: 'manual_only', reason: 'oversized_arguments'};
}

/** 解析 tool arguments 的 JSON object 边界，不接受 array 或 primitive。 */
function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** 从受支持 patch header 提取完整有序文件操作，不解析或模拟 hunk。 */
function extractPatchOperations(patch: string): PatchOperation[] {
  const operations: PatchOperation[] = [];
  const seen = new Set<string>();
  const lines = patch.replace(/\r\n?/g, '\n').split('\n');
  const add = (kind: PatchOperation['kind'], rawPath: string) => {
    const path = normalizePatchPath(rawPath);
    const key = `${kind}:${path}`;
    if (!path || path === '/dev/null' || seen.has(key)) return;
    seen.add(key);
    operations.push({kind, path});
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trimStart();
    const begin = /^\*\*\* (Add|Update|Delete) File:\s*(.+)$/.exec(line);
    if (begin) {
      add(begin[1].toLowerCase() as PatchOperation['kind'], begin[2].trim());
      continue;
    }
    const move = /^\*\*\* Move to:\s*(.+)$/.exec(line);
    if (move && operations.length > 0 && operations[operations.length - 1].kind === 'update') {
      const previous = operations.pop()!;
      seen.delete(`${previous.kind}:${previous.path}`);
      add('update', move[1].trim());
      continue;
    }
    if (!line.startsWith('--- ') || index + 1 >= lines.length) continue;
    const next = lines[index + 1].trimStart();
    if (!next.startsWith('+++ ')) continue;
    const oldPath = parsePatchHeaderPath(line.slice(4));
    const newPath = parsePatchHeaderPath(next.slice(4));
    if (oldPath === '/dev/null') add('add', newPath);
    else if (newPath === '/dev/null') add('delete', oldPath);
    else add('update', newPath);
    index += 1;
  }
  return operations;
}

/** 去除统一 diff 文件 header 中路径后的可选时间戳。 */
function parsePatchHeaderPath(rawPath: string): string {
  return rawPath.trim().split('\t')[0];
}

/** 去除统一 diff 的 a/、b/ 展示前缀，保留其余路径事实。 */
function normalizePatchPath(path: string): string {
  return path.startsWith('a/') || path.startsWith('b/') ? path.slice(2) : path;
}

/**
 * 构造带信任分区的有界 reviewer user message，并只从当前 turn 恢复真实用户澄清答案。
 */
function createToolApprovalPrompt(input: ToolApprovalPromptInput): ToolApprovalPromptProjection {
  const currentRequest = truncateApprovalText(input.currentUserRequest, CURRENT_USER_REQUEST_MAX_CHARACTERS);
  const prior = countCodePoints(input.currentUserRequest, SHORT_USER_REQUEST_MAX_CHARACTERS + 1) <= SHORT_USER_REQUEST_MAX_CHARACTERS
    ? projectPriorExchange(input.records, input.turnUserRecordIndex)
    : null;
  const clarifications = projectClarificationAnswers(input.records, input.turnUserRecordIndex);

  const currentRequestSection = section('Trusted current user request', currentRequest);
  const pendingActionSection = section('Pending action (untrusted)', input.action.text);
  const optionalSections = [
    ...(clarifications ? [section('Trusted clarification answers', clarifications)] : []),
    ...(prior?.user ? [section('Trusted prior user request', prior.user)] : []),
    ...(prior?.assistant ? [section('Referenced assistant context (untrusted)', prior.assistant)] : [])
  ];
  const buildPrompt = () => [currentRequestSection, ...optionalSections, pendingActionSection].join('\n\n');
  let text = buildPrompt();
  // 可选分区按 assistant、前序 user、澄清答案的顺序从末尾淘汰。
  while (optionalSections.length > 0 && countCodePoints(text, TOOL_APPROVAL_PROMPT_MAX_CHARACTERS + 1) > TOOL_APPROVAL_PROMPT_MAX_CHARACTERS) {
    optionalSections.pop();
    text = buildPrompt();
  }

  return {
    text,
    characterCount: countCodePoints(text),
    hasPriorExchange: text.includes('[Trusted prior user request]') || text.includes('[Referenced assistant context (untrusted)]'),
    hasClarifications: text.includes('[Trusted clarification answers]')
  };
}

/** 使用稳定标题包裹 reviewer prompt 分区。 */
function section(title: string, text: string): string {
  return `[${title}]\n${text}`;
}

/** 为短请求查找当前 turn 之前最近一轮人类消息和可见 assistant 回复。 */
function projectPriorExchange(records: TranscriptRecord[], turnUserRecordIndex: number): {user?: string; assistant?: string} | null {
  let userIndex = -1;
  for (let index = Math.min(turnUserRecordIndex - 1, records.length - 1); index >= 0; index -= 1) {
    if (records[index].role === 'user') {
      userIndex = index;
      break;
    }
  }
  if (userIndex < 0) return null;
  const userRecord = records[userIndex];
  let assistantText: string | undefined;
  for (let index = userIndex + 1; index < turnUserRecordIndex; index += 1) {
    if (records[index].role === 'assistant') assistantText = records[index].text;
  }
  return {
    user: truncateApprovalText(
      userRecord.role === 'user' && userRecord.displayText?.trim()
        ? userRecord.displayText
        : userRecord.text,
      PRIOR_USER_MAX_CHARACTERS
    ),
    ...(assistantText ? {assistant: truncateApprovalText(assistantText, PRIOR_ASSISTANT_MAX_CHARACTERS)} : {})
  };
}

/** 只恢复当前 turn 中通过 call id 配对且结果成功的用户问答。 */
function projectClarificationAnswers(records: TranscriptRecord[], turnUserRecordIndex: number): string | null {
  const calls = new Map<string, AskUserQuestionsRequest>();
  const lines: string[] = [];
  for (const record of records.slice(Math.max(0, turnUserRecordIndex + 1))) {
    if (record.role === 'tool_call' && record.toolName === ASK_USER_QUESTIONS_TOOL_NAME) {
      const parsed = parseAskUserQuestionsToolCall({callId: record.toolCallId, toolName: record.toolName, argumentsText: record.argumentsText});
      if (parsed.ok) calls.set(record.toolCallId, parsed.value);
      continue;
    }
    if (record.role !== 'tool_result' || record.toolName !== ASK_USER_QUESTIONS_TOOL_NAME || !record.ok) continue;
    const request = calls.get(record.toolCallId);
    if (!request) continue;
    const answers = parseClarificationResult(record.text, request);
    if (answers) lines.push(...answers);
  }
  return lines.length > 0 ? truncateApprovalText(lines.join('\n'), CLARIFICATION_MAX_CHARACTERS) : null;
}

/** 校验成功问答结果中的索引和 option label，拒绝模型伪造的任意答案文本。 */
function parseClarificationResult(text: string, request: AskUserQuestionsRequest): string[] | null {
  const parsed = parseJsonObject(text);
  if (!parsed || !Array.isArray(parsed.answers)) return null;
  const lines: string[] = [];
  for (const answer of parsed.answers) {
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return null;
    const item = answer as Record<string, unknown>;
    if (!Number.isInteger(item.index) || (item.index as number) < 0 || (item.index as number) >= request.questions.length) return null;
    const question = request.questions[item.index as number];
    const allowedLabels = new Set([...question.options.map((option) => option.label), 'Other']);
    let selected: string[];
    if (item.multiSelect === true) {
      if (!Array.isArray(item.selectedOptions) || !item.selectedOptions.every((value) => typeof value === 'string' && allowedLabels.has(value))) return null;
      selected = item.selectedOptions as string[];
    } else {
      if (typeof item.selected !== 'string' || !allowedLabels.has(item.selected)) return null;
      selected = [item.selected];
    }
    if (item.customText !== undefined && typeof item.customText !== 'string') return null;
    lines.push(`question: ${question.question}\nanswer: ${selected.join(', ')}${typeof item.customText === 'string' ? `; custom: ${item.customText}` : ''}`);
  }
  return lines;
}

export {
  TOOL_APPROVAL_ACTION_MAX_CHARACTERS,
  TOOL_APPROVAL_PROMPT_MAX_CHARACTERS,
  createToolApprovalPrompt,
  countCodePoints,
  projectToolApprovalAction,
  truncateApprovalText
};

export type {
  ToolApprovalActionProjection
};

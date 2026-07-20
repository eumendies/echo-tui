import {type TuiTheme} from '../../config/theme-config';
import {blockText} from '../colors';
import {
  TOOL_RESULT_MAX_DISPLAY_LINES,
  renderPrefixedLines,
  resolveToolCallPrefixStyle,
  truncateDisplayText
} from './shared';

import type {ToolCallTranscriptRecord, ToolResultTranscriptRecord} from '../../types/transcript';

const ASK_USER_QUESTIONS_TOOL_NAME = 'ask_user_questions';
const OTHER_OPTION_LABEL = 'Other';

type AskUserQuestionsOption = {
  label: string;
};

type AskUserQuestion = {
  question: string;
  multiSelect: boolean;
  options: AskUserQuestionsOption[];
};

type AskUserQuestionsPayload = {
  questions: AskUserQuestion[];
};

type AskUserQuestionsSelectedAnswer = {
  index: number;
  labels: string[];
  customText?: string;
};

type AskUserQuestionsResultPayload =
  | {kind: 'success'; answers: AskUserQuestionsSelectedAnswer[]}
  | {kind: 'cancelled'; reason?: string};

/**
 * 渲染 ask_user_questions 相邻 call/result 对；解析失败返回 null，让通用工具消息保留原始事实。
 */
function renderAskUserQuestionsToolPairLines(
  call: ToolCallTranscriptRecord,
  result: ToolResultTranscriptRecord,
  width: number,
  theme: TuiTheme
): string[] | null {
  const payload = parseAskUserQuestionsArguments(call.argumentsText);
  const resultPayload = parseAskUserQuestionsResult(result.text, payload);

  if (!payload || !resultPayload) {
    return null;
  }

  return [
    ...renderAskUserQuestionsCallLines(payload, result.ok, width, theme),
    ...renderAskUserQuestionsResultLines(payload, resultPayload, width, theme)
  ];
}

/**
 * 渲染 ask_user_questions 调用；参数无效时省略数量，错误细节由对应 tool result 表达。
 */
function renderAskUserQuestionsToolCallLines(
  call: ToolCallTranscriptRecord,
  resultStatus: unknown,
  width: number,
  theme: TuiTheme
): string[] {
  const payload = parseAskUserQuestionsArguments(call.argumentsText);
  return renderAskUserQuestionsCallLines(payload, resultStatus, width, theme);
}

function renderAskUserQuestionsCallLines(
  payload: AskUserQuestionsPayload | null,
  resultStatus: unknown,
  width: number,
  theme: TuiTheme
): string[] {
  return renderPrefixedLines({
    text: payload ? `AskUserQuestions(${payload.questions.length})` : 'AskUserQuestions',
    width,
    firstPrefix: '◆ ',
    continuationPrefix: '  ',
    colorizeFirstSymbol: resolveToolCallPrefixStyle(resultStatus, theme)
  });
}

function renderAskUserQuestionsResultLines(
  payload: AskUserQuestionsPayload,
  resultPayload: AskUserQuestionsResultPayload,
  width: number,
  theme: TuiTheme
): string[] {
  const text = resultPayload.kind === 'cancelled'
    ? createCancelledReceiptText(resultPayload)
    : createSuccessReceiptText(payload, resultPayload.answers);

  return renderPrefixedLines({
    text: truncateDisplayText(text, TOOL_RESULT_MAX_DISPLAY_LINES),
    width,
    firstPrefix: '  ⎿ ',
    continuationPrefix: '    ',
    colorizeLine: (line) => blockText(theme, 'toolOutput', line)
  });
}

function createSuccessReceiptText(payload: AskUserQuestionsPayload, answers: AskUserQuestionsSelectedAnswer[]): string {
  const lines: string[] = [];

  for (const answer of answers) {
    const question = payload.questions[answer.index];
    lines.push(`${answer.index + 1}. ${question.question}（${question.multiSelect ? '多选' : '单选'}）`);

    for (const label of answer.labels) {
      lines.push(`   ● ${formatAnswerLabel(label, answer.customText)}`);
    }
  }

  return lines.join('\n');
}

function createCancelledReceiptText(resultPayload: Extract<AskUserQuestionsResultPayload, {kind: 'cancelled'}>): string {
  return resultPayload.reason ? `已取消：${resultPayload.reason}` : '已取消';
}

function formatAnswerLabel(label: string, customText: string | undefined): string {
  if (!customText || label !== OTHER_OPTION_LABEL) {
    return label;
  }

  return `${label}：${customText}`;
}

function parseAskUserQuestionsArguments(argumentsText: unknown): AskUserQuestionsPayload | null {
  if (typeof argumentsText !== 'string') {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const questions = (parsed as {questions?: unknown}).questions;

  if (!Array.isArray(questions) || questions.length === 0) {
    return null;
  }

  const normalizedQuestions: AskUserQuestion[] = [];

  for (const question of questions) {
    const normalizedQuestion = parseAskUserQuestion(question);

    if (!normalizedQuestion) {
      return null;
    }

    normalizedQuestions.push(normalizedQuestion);
  }

  return {questions: normalizedQuestions};
}

function parseAskUserQuestion(value: unknown): AskUserQuestion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const questionRecord = value as {question?: unknown; multiSelect?: unknown; options?: unknown};

  if (typeof questionRecord.question !== 'string' || questionRecord.question.trim() === '') {
    return null;
  }

  if (questionRecord.multiSelect !== undefined && typeof questionRecord.multiSelect !== 'boolean') {
    return null;
  }

  if (!Array.isArray(questionRecord.options) || questionRecord.options.length === 0) {
    return null;
  }

  const options: AskUserQuestionsOption[] = [];

  for (const option of questionRecord.options) {
    const normalizedOption = parseAskUserQuestionsOption(option);

    if (!normalizedOption) {
      return null;
    }

    options.push(normalizedOption);
  }

  return {
    question: questionRecord.question.trim(),
    multiSelect: questionRecord.multiSelect === true,
    options
  };
}

function parseAskUserQuestionsOption(value: unknown): AskUserQuestionsOption | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const label = (value as {label?: unknown}).label;

  if (typeof label !== 'string' || label.trim() === '') {
    return null;
  }

  return {label: label.trim()};
}

function parseAskUserQuestionsResult(text: string, payload: AskUserQuestionsPayload | null): AskUserQuestionsResultPayload | null {
  if (!payload) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const resultRecord = parsed as Record<string, unknown>;

  if (resultRecord.cancelled === true) {
    return parseAskUserQuestionsCancelledResult(resultRecord);
  }

  return parseAskUserQuestionsSuccessResult(resultRecord, payload);
}

function parseAskUserQuestionsCancelledResult(record: Record<string, unknown>): AskUserQuestionsResultPayload | null {
  const reason = record.reason;

  if (reason !== undefined && typeof reason !== 'string') {
    return null;
  }

  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';

  return {
    kind: 'cancelled',
    ...(trimmedReason ? {reason: trimmedReason} : {})
  };
}

function parseAskUserQuestionsSuccessResult(
  record: Record<string, unknown>,
  payload: AskUserQuestionsPayload
): AskUserQuestionsResultPayload | null {
  if (!Array.isArray(record.answers) || record.answers.length !== payload.questions.length) {
    return null;
  }

  const answers: AskUserQuestionsSelectedAnswer[] = [];
  const seenIndexes = new Set<number>();

  for (const answer of record.answers) {
    const normalizedAnswer = parseAskUserQuestionsAnswer(answer, payload);

    if (!normalizedAnswer || seenIndexes.has(normalizedAnswer.index)) {
      return null;
    }

    seenIndexes.add(normalizedAnswer.index);
    answers.push(normalizedAnswer);
  }

  return {kind: 'success', answers};
}

function parseAskUserQuestionsAnswer(value: unknown, payload: AskUserQuestionsPayload): AskUserQuestionsSelectedAnswer | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const answerRecord = value as Record<string, unknown>;
  const index = answerRecord.index;

  if (!Number.isInteger(index) || Number(index) < 0 || Number(index) >= payload.questions.length) {
    return null;
  }

  const question = payload.questions[Number(index)];
  const customText = parseOptionalCustomText(answerRecord.customText);

  if (customText === null) {
    return null;
  }

  if (question.multiSelect) {
    return parseAskUserQuestionsMultiAnswer(Number(index), answerRecord, question, customText);
  }

  return parseAskUserQuestionsSingleAnswer(Number(index), answerRecord, question, customText);
}

function parseAskUserQuestionsSingleAnswer(
  index: number,
  answerRecord: Record<string, unknown>,
  question: AskUserQuestion,
  customText: string | undefined
): AskUserQuestionsSelectedAnswer | null {
  if (answerRecord.multiSelect !== undefined || answerRecord.selectedOptions !== undefined) {
    return null;
  }

  if (typeof answerRecord.selected !== 'string') {
    return null;
  }

  const label = answerRecord.selected.trim();

  if (!isKnownOptionLabel(label, question) || !isConsistentCustomTextUsage([label], question, customText)) {
    return null;
  }

  return {index, labels: [label], ...(customText ? {customText} : {})};
}

function parseAskUserQuestionsMultiAnswer(
  index: number,
  answerRecord: Record<string, unknown>,
  question: AskUserQuestion,
  customText: string | undefined
): AskUserQuestionsSelectedAnswer | null {
  if (answerRecord.multiSelect !== true || answerRecord.selected !== undefined || !Array.isArray(answerRecord.selectedOptions)) {
    return null;
  }

  const labels: string[] = [];

  for (const selectedOption of answerRecord.selectedOptions) {
    if (typeof selectedOption !== 'string') {
      return null;
    }

    const label = selectedOption.trim();

    if (!isKnownOptionLabel(label, question)) {
      return null;
    }

    labels.push(label);
  }

  if (labels.length === 0 || !isConsistentCustomTextUsage(labels, question, customText)) {
    return null;
  }

  return {index, labels, ...(customText ? {customText} : {})};
}

function parseOptionalCustomText(value: unknown): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  return trimmed ? trimmed : undefined;
}

function isKnownOptionLabel(label: string, question: AskUserQuestion): boolean {
  return label !== '' && (label === OTHER_OPTION_LABEL || hasExplicitOptionLabel(label, question));
}

function isConsistentCustomTextUsage(labels: string[], question: AskUserQuestion, customText: string | undefined): boolean {
  const hasOtherLabel = labels.includes(OTHER_OPTION_LABEL);

  if (customText) {
    return hasOtherLabel;
  }

  return !hasOtherLabel || hasExplicitOptionLabel(OTHER_OPTION_LABEL, question);
}

function hasExplicitOptionLabel(label: string, question: AskUserQuestion): boolean {
  return question.options.some((option) => option.label === label);
}

export {
  ASK_USER_QUESTIONS_TOOL_NAME,
  renderAskUserQuestionsToolCallLines,
  renderAskUserQuestionsToolPairLines
};

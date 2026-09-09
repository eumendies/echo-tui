import type {
  AskUserQuestionsAnswer,
  AskUserQuestionsRequest,
  AskUserQuestionsToolExecutionResult,
  ToolCall,
  ToolHandler
} from '../types/tool';

import {sanitizeTerminalText} from '../terminal/control-chars';
import {DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES, capUtf8Text} from './tool-handler-utils';

const ASK_USER_QUESTIONS_TOOL_NAME = 'ask_user_questions';
const MAX_QUESTIONS = 5;
const MAX_OPTIONS_PER_QUESTION = 8;
const MAX_ASK_USER_QUESTION_BYTES = 8_192;
const MAX_ASK_USER_OPTION_LABEL_BYTES = 4_096;
const MAX_ASK_USER_OPTION_DESCRIPTION_BYTES = 8_192;
const MAX_ASK_USER_QUESTION_DEFINITION_BYTES = 32_768;
const MAX_ASK_USER_CUSTOM_ANSWER_BYTES = 4_096;

type ParseAskUserQuestionsResult =
  | {ok: true; value: AskUserQuestionsRequest}
  | {ok: false; message: string};

/**
 * 创建用户澄清问题 function tool 的定义；真实交互由 agent loop 的 interactive callback 处理。
 */
function createAskUserQuestionsToolHandler(): ToolHandler {
  return {
    definition: {
      name: ASK_USER_QUESTIONS_TOOL_NAME,
      description: 'Ask the user one or more necessary single-choice or multi-select clarification questions when the answer cannot be inferred from context. Keep questions, options, descriptions, and custom answers concise; oversized definitions are rejected.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['questions'],
        properties: {
          questions: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_QUESTIONS,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['question', 'options'],
              properties: {
                question: {
                  type: 'string'
                },
                multiSelect: {
                  type: 'boolean',
                  description: 'Defaults to false. Set true when the user may select multiple options.'
                },
                options: {
                  type: 'array',
                  minItems: 1,
                  maxItems: MAX_OPTIONS_PER_QUESTION,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['label'],
                    properties: {
                      label: {
                        type: 'string'
                      },
                      description: {
                        type: 'string'
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    execute(_args: Record<string, unknown>, call: ToolCall): AskUserQuestionsToolExecutionResult {
      return createAskUserQuestionsFailureResult(call, 'ask_user_questions must be handled by the app interactive callback');
    }
  };
}

/**
 * 解析 provider 传入的 function arguments；interactive tool 也需要独立守住 JSON 边界。
 */
function parseAskUserQuestionsToolCall(call: ToolCall): ParseAskUserQuestionsResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(call.argumentsText);
  } catch {
    return {ok: false, message: 'ask_user_questions arguments are not valid JSON'};
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {ok: false, message: 'ask_user_questions arguments must be a JSON object'};
  }

  return parseAskUserQuestionsArgs(parsed as Record<string, unknown>);
}

/**
 * 校验模型请求的问题结构；多选只通过 question 级 boolean 显式开启，默认沿用单选语义。
 */
function parseAskUserQuestionsArgs(args: Record<string, unknown>): ParseAskUserQuestionsResult {
  const rawQuestions = args.questions;

  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return {ok: false, message: 'questions must be a non-empty array'};
  }

  if (rawQuestions.length > MAX_QUESTIONS) {
    return {ok: false, message: `questions must contain at most ${MAX_QUESTIONS} items`};
  }

  const questions = [];
  let definitionBytes = 0;

  for (const [questionIndex, rawQuestion] of rawQuestions.entries()) {
    if (!rawQuestion || typeof rawQuestion !== 'object' || Array.isArray(rawQuestion)) {
      return {ok: false, message: `questions[${questionIndex}] must be an object`};
    }

    const questionRecord = rawQuestion as Record<string, unknown>;
    const question = questionRecord.question;

    if (typeof question !== 'string' || question.trim() === '') {
      return {ok: false, message: `questions[${questionIndex}].question must be a non-empty string`};
    }

    // 模型参数是外部文本,先剥离 CR/ESC 等控制符再入库,避免交互卡片与 tool record 渲染被覆盖破坏。
    const normalizedQuestion = sanitizeTerminalText(question).trim();
    const questionBytes = Buffer.byteLength(normalizedQuestion, 'utf8');
    if (questionBytes > MAX_ASK_USER_QUESTION_BYTES) {
      return {ok: false, message: `questions[${questionIndex}].question must not exceed ${MAX_ASK_USER_QUESTION_BYTES} UTF-8 bytes`};
    }
    definitionBytes += questionBytes;

    const multiSelect = questionRecord.multiSelect;

    if (multiSelect !== undefined && typeof multiSelect !== 'boolean') {
      return {ok: false, message: `questions[${questionIndex}].multiSelect must be a boolean`};
    }

    const rawOptions = questionRecord.options;

    if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
      return {ok: false, message: `questions[${questionIndex}].options must be a non-empty array`};
    }

    if (rawOptions.length > MAX_OPTIONS_PER_QUESTION) {
      return {ok: false, message: `questions[${questionIndex}].options must contain at most ${MAX_OPTIONS_PER_QUESTION} items`};
    }

    const options = [];

    for (const [optionIndex, rawOption] of rawOptions.entries()) {
      if (!rawOption || typeof rawOption !== 'object' || Array.isArray(rawOption)) {
        return {ok: false, message: `questions[${questionIndex}].options[${optionIndex}] must be an object`};
      }

      const optionRecord = rawOption as Record<string, unknown>;
      const label = optionRecord.label;

      if (typeof label !== 'string' || label.trim() === '') {
        return {ok: false, message: `questions[${questionIndex}].options[${optionIndex}].label must be a non-empty string`};
      }

      const normalizedLabel = sanitizeTerminalText(label).trim();
      const labelBytes = Buffer.byteLength(normalizedLabel, 'utf8');
      if (labelBytes > MAX_ASK_USER_OPTION_LABEL_BYTES) {
        return {ok: false, message: `questions[${questionIndex}].options[${optionIndex}].label must not exceed ${MAX_ASK_USER_OPTION_LABEL_BYTES} UTF-8 bytes`};
      }
      definitionBytes += labelBytes;

      const description = optionRecord.description;

      if (description !== undefined && description !== null && typeof description !== 'string') {
        return {ok: false, message: `questions[${questionIndex}].options[${optionIndex}].description must be a string`};
      }

      const normalizedDescription = typeof description === 'string' ? sanitizeTerminalText(description).trim() : '';
      if (Buffer.byteLength(normalizedDescription, 'utf8') > MAX_ASK_USER_OPTION_DESCRIPTION_BYTES) {
        return {ok: false, message: `questions[${questionIndex}].options[${optionIndex}].description must not exceed ${MAX_ASK_USER_OPTION_DESCRIPTION_BYTES} UTF-8 bytes`};
      }
      definitionBytes += Buffer.byteLength(normalizedDescription, 'utf8');

      if (definitionBytes > MAX_ASK_USER_QUESTION_DEFINITION_BYTES) {
        return {ok: false, message: `question definitions must not exceed ${MAX_ASK_USER_QUESTION_DEFINITION_BYTES} UTF-8 bytes in total`};
      }

      options.push({
        label: normalizedLabel,
        ...(normalizedDescription !== '' ? {description: normalizedDescription} : {})
      });
    }

    questions.push({
      question: normalizedQuestion,
      ...(typeof multiSelect === 'boolean' ? {multiSelect} : {}),
      options
    });
  }

  return {ok: true, value: {questions}};
}

/**
 * 构造用户完成选择后的 JSON tool result，保留问题文本和被选 option 信息。
 */
function createAskUserQuestionsSuccessResult(call: ToolCall, answers: AskUserQuestionsAnswer[]): AskUserQuestionsToolExecutionResult {
  const text = JSON.stringify({
    answers: answers.map((answer, index) => {
      if (answer.multiSelect) {
        return {
          index,
          multiSelect: true,
          selectedOptions: answer.selectedOptions.map((option) => option.label),
          ...(answer.customText ? {customText: sanitizeTerminalText(answer.customText)} : {})
        };
      }

      return {
        index,
        selected: answer.selectedOption.label,
        ...(answer.customText ? {customText: sanitizeTerminalText(answer.customText)} : {})
      };
    })
  });

  if (Buffer.byteLength(text, 'utf8') > DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES) {
    return createAskUserQuestionsFailureResult(call, 'ask_user_questions answer exceeds the 65536-byte output limit');
  }

  return {
    callId: call.callId,
    toolName: ASK_USER_QUESTIONS_TOOL_NAME,
    ok: true,
    details: {kind: 'generic'},
    text
  };
}

/**
 * 构造用户取消选择后的 JSON tool result，让模型能继续处理取消语义。
 */
function createAskUserQuestionsCancelledResult(call: ToolCall, reason = 'User cancelled ask_user_questions'): AskUserQuestionsToolExecutionResult {
  return {
    callId: call.callId,
    toolName: ASK_USER_QUESTIONS_TOOL_NAME,
    ok: false,
    details: {kind: 'generic'},
    text: JSON.stringify({cancelled: true, reason})
  };
}

function createAskUserQuestionsFailureResult(call: ToolCall, message: string): AskUserQuestionsToolExecutionResult {
  return {
    callId: call.callId,
    toolName: ASK_USER_QUESTIONS_TOOL_NAME,
    ok: false,
    details: {kind: 'generic'},
    // 校验失败是给模型和终端阅读的纯文本；只有成功/取消结果才返回结构化 JSON。
    text: capUtf8Text(message, DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES).text
  };
}

export {
  ASK_USER_QUESTIONS_TOOL_NAME,
  MAX_ASK_USER_CUSTOM_ANSWER_BYTES,
  MAX_ASK_USER_OPTION_DESCRIPTION_BYTES,
  MAX_ASK_USER_OPTION_LABEL_BYTES,
  MAX_ASK_USER_QUESTION_BYTES,
  MAX_ASK_USER_QUESTION_DEFINITION_BYTES,
  createAskUserQuestionsCancelledResult,
  createAskUserQuestionsFailureResult,
  createAskUserQuestionsSuccessResult,
  createAskUserQuestionsToolHandler,
  parseAskUserQuestionsArgs,
  parseAskUserQuestionsToolCall
};

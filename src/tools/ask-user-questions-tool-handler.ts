import type {
  AskUserQuestionsAnswer,
  AskUserQuestionsRequest,
  AskUserQuestionsToolExecutionResult,
  ToolCall,
  ToolHandler
} from '../types/tool';

const ASK_USER_QUESTIONS_TOOL_NAME = 'ask_user_questions';
const MAX_QUESTIONS = 5;
const MAX_OPTIONS_PER_QUESTION = 8;

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
      description: 'Ask the user one or more necessary single-choice or multi-select clarification questions when the answer cannot be inferred from context.',
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

  for (const [questionIndex, rawQuestion] of rawQuestions.entries()) {
    if (!rawQuestion || typeof rawQuestion !== 'object' || Array.isArray(rawQuestion)) {
      return {ok: false, message: `questions[${questionIndex}] must be an object`};
    }

    const questionRecord = rawQuestion as Record<string, unknown>;
    const question = questionRecord.question;

    if (typeof question !== 'string' || question.trim() === '') {
      return {ok: false, message: `questions[${questionIndex}].question must be a non-empty string`};
    }

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

      const description = optionRecord.description;

      if (description !== undefined && description !== null && typeof description !== 'string') {
        return {ok: false, message: `questions[${questionIndex}].options[${optionIndex}].description must be a string`};
      }

      options.push({
        label: label.trim(),
        ...(typeof description === 'string' && description.trim() !== '' ? {description: description.trim()} : {})
      });
    }

    questions.push({
      question: question.trim(),
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
  return {
    callId: call.callId,
    toolName: ASK_USER_QUESTIONS_TOOL_NAME,
    ok: true,
    details: {kind: 'generic'},
    text: JSON.stringify({
      answers: answers.map((answer, index) => {
        if (answer.multiSelect) {
          return {
            index,
            multiSelect: true,
            selectedOptions: answer.selectedOptions.map((option) => option.label),
            ...(answer.customText ? {customText: answer.customText} : {})
          };
        }

        return {
          index,
          selected: answer.selectedOption.label,
          ...(answer.customText ? {customText: answer.customText} : {})
        };
      })
    })
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
    text: message
  };
}

export {
  ASK_USER_QUESTIONS_TOOL_NAME,
  createAskUserQuestionsCancelledResult,
  createAskUserQuestionsFailureResult,
  createAskUserQuestionsSuccessResult,
  createAskUserQuestionsToolHandler,
  parseAskUserQuestionsArgs,
  parseAskUserQuestionsToolCall
};

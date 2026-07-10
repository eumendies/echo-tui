import {INPUT_EVENTS} from '../../input/event-types';
import {applyComposerEditEvent, createComposer, getText} from '../../input/composer';
import {moveWrappedIndex} from '../utils';
import {
  createAskUserQuestionsCancelledResult,
  createAskUserQuestionsSuccessResult
} from '../../tools/ask-user-questions-tool-handler';

import type {ChoiceCommandSurface} from '../../types/command';
import type {ComposerState} from '../../types/composer';
import type {InputEvent} from '../../types/input';
import type {
  AskUserQuestionsAnswer,
  AskUserQuestionsRequest,
  ToolCall,
  ToolExecutionResult
} from '../../types/tool';

type ActiveUserQuestionRequest = {
  call: ToolCall;
  checkedOptionIndexes: number[];
  focusedOptionIndex: number;
  request: AskUserQuestionsRequest;
  questionIndex: number;
  otherComposer: ComposerState;
  answers: AskUserQuestionsAnswer[];
  resolve: (result: ToolExecutionResult) => void;
};

const OTHER_OPTION_LABEL = 'Other';
const OTHER_OPTION_PLACEHOLDER = 'Type your answer...';

/**
 * 管理 ask_user_questions 的逐题选择状态；只负责 UI 状态和 tool result 构造，不执行 agent continuation。
 */
class UserQuestionContext {
  activeRequest: ActiveUserQuestionRequest | null;
  onUpdate: () => void;

  constructor(onUpdate: () => void) {
    this.activeRequest = null;
    this.onUpdate = onUpdate;
  }

  /**
   * 打开一次用户问题请求，并返回等待用户逐题选择后的 tool result。
   */
  request(call: ToolCall, request: AskUserQuestionsRequest): Promise<ToolExecutionResult> {
    if (this.activeRequest) {
      this.resolveActive(createAskUserQuestionsCancelledResult(
        this.activeRequest.call,
        'ask_user_questions was cancelled because another question request replaced it'
      ));
    }

    return new Promise((resolve) => {
      this.activeRequest = {
        answers: [],
        call,
        checkedOptionIndexes: [],
        focusedOptionIndex: 0,
        otherComposer: createComposer(),
        questionIndex: 0,
        request,
        resolve
      };
      this.onUpdate();
    });
  }

  /**
   * 返回当前是否有阻塞中的用户问题请求。
   */
  hasActiveRequest(): boolean {
    return this.activeRequest !== null;
  }

  /**
   * 将当前题投影为通用 choice surface，渲染层无需知道 ask_user_questions 的内部结构。
   */
  getSurface(): ChoiceCommandSurface | null {
    const request = this.activeRequest;

    if (!request) {
      return null;
    }

    const question = request.request.questions[request.questionIndex];
    const total = request.request.questions.length;
    const multiSelect = question.multiSelect === true;
    const otherText = getText(request.otherComposer);

    return {
      kind: 'choice',
      title: total > 1 ? `Question ${request.questionIndex + 1}/${total}` : 'Question',
      message: question.question,
      messageTitle: 'question',
      optionsTitle: multiSelect ? '答案（多选）' : '答案（单选）',
      options: [
        ...question.options.map((option, index) => ({
          ...option,
          ...(multiSelect ? {checked: request.checkedOptionIndexes.includes(index)} : {})
        })),
        {
          label: OTHER_OPTION_LABEL,
          ...(multiSelect ? {checked: otherText.trim() !== ''} : {}),
          inlineInput: {
            cursor: request.otherComposer.cursor,
            placeholder: OTHER_OPTION_PLACEHOLDER,
            text: otherText
          }
        }
      ],
      focusedIndex: request.focusedOptionIndex,
      ...(multiSelect ? {selectionMode: 'multiple' as const} : {}),
      dismissHint: multiSelect
        ? 'Space 选择/取消 · Enter 确认 · Up/Down 移动 · 输入 Other · Esc 取消'
        : 'Enter 确认 · Up/Down 选择 · 输入 Other · Esc 取消'
    };
  }

  /**
   * 处理用户问题 surface 激活期间的输入；会消费所有事件，避免污染 composer 或 slash command。
   */
  handleEvent(event: InputEvent): boolean {
    if (!this.activeRequest) {
      return false;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP) {
      this.moveFocus(-1);
      return true;
    }

    if (event.type === INPUT_EVENTS.MOVE_DOWN) {
      this.moveFocus(1);
      return true;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      this.confirmSelectedOption();
      return true;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.cancelActiveRequest();
      return true;
    }

    if (this.isCurrentQuestionMultiSelect() && event.type === INPUT_EVENTS.TEXT && event.value === ' ' && !this.isOtherFocused()) {
      this.toggleFocusedOption();
      return true;
    }

    if (this.isOtherFocused()) {
      this.handleOtherEditEvent(event);
      return true;
    }

    return true;
  }

  /**
   * 判断当前键盘焦点是否位于 Other 内联输入项；只有该项接收文本编辑事件。
   */
  private isOtherFocused(): boolean {
    const request = this.activeRequest;

    if (!request) {
      return false;
    }

    return request.focusedOptionIndex === request.request.questions[request.questionIndex].options.length;
  }

  /**
   * 判断当前题是否启用多选；缺省题保持既有单选交互。
   */
  private isCurrentQuestionMultiSelect(): boolean {
    const request = this.activeRequest;

    if (!request) {
      return false;
    }

    return request.request.questions[request.questionIndex].multiSelect === true;
  }

  /**
   * Other 输入项复用主 composer 的编辑操作；上下键仍用于选择预设项或 Other。
   */
  private handleOtherEditEvent(event: InputEvent): void {
    const request = this.activeRequest;

    if (!request) {
      return;
    }

    if (applyComposerEditEvent(request.otherComposer, event)) {
      this.onUpdate();
    }
  }

  /**
   * 移动当前题的键盘焦点；焦点只影响高亮、窗口化和当前 Space/Enter 操作目标。
   */
  private moveFocus(direction: number): void {
    const request = this.activeRequest;

    if (!request) {
      return;
    }

    const optionCount = request.request.questions[request.questionIndex].options.length + 1;
    const focusedOptionIndex = moveWrappedIndex(request.focusedOptionIndex, direction, optionCount);
    this.activeRequest = {...request, focusedOptionIndex};
    this.onUpdate();
  }

  /**
   * 切换多选题中当前普通 option 的 checked 状态；Other 由非空文本自动视为已选。
   */
  private toggleFocusedOption(): void {
    const request = this.activeRequest;

    if (!request) {
      return;
    }

    const optionCount = request.request.questions[request.questionIndex].options.length;

    if (request.focusedOptionIndex >= optionCount) {
      return;
    }

    const checked = request.checkedOptionIndexes.includes(request.focusedOptionIndex);
    const checkedOptionIndexes = checked
      ? request.checkedOptionIndexes.filter((index) => index !== request.focusedOptionIndex)
      : [...request.checkedOptionIndexes, request.focusedOptionIndex].sort((left, right) => left - right);
    this.activeRequest = {...request, checkedOptionIndexes};
    this.onUpdate();
  }

  /**
   * 确认当前题答案；单选提交焦点项，多选提交所有 checked 项与非空 Other 文本。
   */
  private confirmSelectedOption(): void {
    const request = this.activeRequest;

    if (!request) {
      return;
    }

    const question = request.request.questions[request.questionIndex];
    const otherText = getText(request.otherComposer).trim();
    const answer = question.multiSelect === true
      ? this.createMultiSelectAnswer(question, request.checkedOptionIndexes, otherText)
      : this.createSingleSelectAnswer(question, request.focusedOptionIndex, otherText);

    if (!answer) {
      this.onUpdate();
      return;
    }

    const answers = [...request.answers, answer];

    if (request.questionIndex < request.request.questions.length - 1) {
      this.activeRequest = {
        ...request,
        answers,
        checkedOptionIndexes: [],
        focusedOptionIndex: 0,
        otherComposer: createComposer(),
        questionIndex: request.questionIndex + 1
      };
      this.onUpdate();
      return;
    }

    this.resolveActive(createAskUserQuestionsSuccessResult(request.call, answers));
  }

  /**
   * 为单选题创建答案；空 Other 不允许提交，避免返回无内容的自定义答案。
   */
  private createSingleSelectAnswer(question: AskUserQuestionsRequest['questions'][number], focusedOptionIndex: number, otherText: string): AskUserQuestionsAnswer | null {
    const isOther = focusedOptionIndex === question.options.length;

    if (isOther && otherText === '') {
      return null;
    }

    const selectedOption = isOther ? {label: OTHER_OPTION_LABEL} : question.options[focusedOptionIndex];
    return {
      question: question.question,
      selectedOption: {...selectedOption},
      ...(isOther ? {customText: otherText} : {})
    };
  }

  /**
   * 为多选题按原始 option 顺序创建答案；Other 文本非空时追加为最后一个自定义答案。
   */
  private createMultiSelectAnswer(question: AskUserQuestionsRequest['questions'][number], checkedOptionIndexes: number[], otherText: string): AskUserQuestionsAnswer | null {
    const selectedOptions = question.options
      .filter((_option, index) => checkedOptionIndexes.includes(index))
      .map((option) => ({...option}));

    if (otherText !== '') {
      selectedOptions.push({label: OTHER_OPTION_LABEL});
    }

    if (selectedOptions.length === 0) {
      return null;
    }

    return {
      question: question.question,
      multiSelect: true,
      selectedOptions,
      ...(otherText !== '' ? {customText: otherText} : {})
    };
  }

  private cancelActiveRequest(): void {
    const request = this.activeRequest;

    if (!request) {
      return;
    }

    this.resolveActive(createAskUserQuestionsCancelledResult(request.call));
  }

  private resolveActive(result: ToolExecutionResult): void {
    const request = this.activeRequest;

    if (!request) {
      return;
    }

    this.activeRequest = null;
    request.resolve(result);
    this.onUpdate();
  }
}

export {
  UserQuestionContext
};

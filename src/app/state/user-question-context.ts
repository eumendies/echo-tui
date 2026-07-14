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

type QuestionDraft = {
  checkedOptionIndexes: number[];
  focusedOptionIndex: number;
  otherComposer: ComposerState;
  selectedOptionIndex?: number;
};

type ActiveUserQuestionRequest = {
  call: ToolCall;
  currentTabIndex: number;
  drafts: QuestionDraft[];
  request: AskUserQuestionsRequest;
  resolve: (result: ToolExecutionResult) => void;
  validationMessage?: string;
};

const OTHER_OPTION_LABEL = 'Other';
const OTHER_OPTION_PLACEHOLDER = 'Type your answer...';

/**
 * 管理 ask_user_questions 的题目草稿、tab 导航和结果构造；不执行 agent continuation。
 */
class UserQuestionContext {
  activeRequest: ActiveUserQuestionRequest | null;
  onUpdate: () => void;

  constructor(onUpdate: () => void) {
    this.activeRequest = null;
    this.onUpdate = onUpdate;
  }

  /**
   * 打开用户问题请求；多题请求保留每题独立草稿，等待用户在提交 tab 统一确认。
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
        call,
        currentTabIndex: 0,
        drafts: request.questions.map(() => createQuestionDraft()),
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
   * 将当前题或提交摘要投影为通用 choice surface，渲染层不读取用户问题内部状态。
   */
  getSurface(): ChoiceCommandSurface | null {
    const request = this.activeRequest;

    if (!request) {
      return null;
    }

    if (this.isSubmitTab(request)) {
      return this.createSubmitSurface(request);
    }

    const questionIndex = request.currentTabIndex;
    const question = request.request.questions[questionIndex];
    const draft = request.drafts[questionIndex];
    const multiSelect = question.multiSelect === true;
    const otherText = getText(draft.otherComposer);

    return {
      kind: 'choice',
      title: request.request.questions.length > 1 ? `Question ${questionIndex + 1}/${request.request.questions.length}` : 'Question',
      ...(this.createTabs(request) ? {tabs: this.createTabs(request), activeTabIndex: questionIndex} : {}),
      message: question.question,
      messageTitle: 'question',
      optionsTitle: multiSelect ? '答案（多选）' : '答案（单选）',
      options: [
        ...question.options.map((option, index) => ({
          ...option,
          ...(multiSelect
            ? {checked: draft.checkedOptionIndexes.includes(index)}
            : {selected: draft.selectedOptionIndex === index})
        })),
        {
          label: OTHER_OPTION_LABEL,
          ...(multiSelect
            ? {checked: otherText.trim() !== ''}
            : {selected: draft.selectedOptionIndex === question.options.length}),
          inlineInput: {
            cursor: draft.otherComposer.cursor,
            placeholder: OTHER_OPTION_PLACEHOLDER,
            text: otherText
          }
        }
      ],
      focusedIndex: draft.focusedOptionIndex,
      ...(multiSelect ? {selectionMode: 'multiple' as const} : {}),
      dismissHint: this.createQuestionDismissHint(request, multiSelect)
    };
  }

  /**
   * 处理用户问题 surface 激活期间的输入；会消费所有事件，避免污染 composer 或 slash command。
   */
  handleEvent(event: InputEvent): boolean {
    const request = this.activeRequest;

    if (!request) {
      return false;
    }

    if (event.type === INPUT_EVENTS.MOVE_LEFT || event.type === INPUT_EVENTS.MOVE_RIGHT) {
      if (this.isOtherFocused()) {
        this.handleOtherEditEvent(event);
      } else if (this.hasTabs(request)) {
        this.moveTab(event.type === INPUT_EVENTS.MOVE_LEFT ? -1 : 1);
      }
      return true;
    }

    if (this.isSubmitTab(request)) {
      if (event.type === INPUT_EVENTS.SUBMIT) {
        this.submitAnswers();
      } else if (event.type === INPUT_EVENTS.ESCAPE) {
        this.cancelActiveRequest();
      }
      return true;
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
      this.confirmCurrentQuestion();
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
    }

    return true;
  }

  /**
   * 创建多题提交页，实时显示每题草稿并给出是否可提交的操作状态。
   */
  private createSubmitSurface(request: ActiveUserQuestionRequest): ChoiceCommandSurface {
    const missingIndexes = this.getMissingQuestionIndexes(request);
    const completed = missingIndexes.length === 0;
    const summary = request.request.questions.map((question, index) => {
      const answer = this.createAnswer(question, request.drafts[index]);
      return answer
        ? `✓ Q${index + 1} ${question.question}\n  ${formatAnswerSummary(answer)}`
        : `! Q${index + 1} ${question.question}\n  未选择`;
    }).join('\n');
    const validation = request.validationMessage ? `\n\n${request.validationMessage}` : '';

    return {
      kind: 'choice',
      title: '提交答案',
      tabs: this.createTabs(request),
      activeTabIndex: request.currentTabIndex,
      message: `${summary}${validation}`,
      messageTitle: '答案预览',
      optionsTitle: '操作',
      options: [{label: completed ? '提交答案' : `还有 ${missingIndexes.length} 个问题未选择`}],
      focusedIndex: 0,
      dismissHint: '←/→ 切换问题 · Enter 提交 · Esc 取消'
    };
  }

  /**
   * 生成多题请求的 tab 状态；单题保持原 surface，避免改变既有交互。
   */
  private createTabs(request: ActiveUserQuestionRequest): ChoiceCommandSurface['tabs'] | undefined {
    if (!this.hasTabs(request)) {
      return undefined;
    }

    const questionTabs = request.request.questions.map((_question, index) => ({
      label: `Q${index + 1}`,
      status: this.createAnswer(request.request.questions[index], request.drafts[index]) ? 'complete' as const : 'missing' as const
    }));
    const missingIndexes = this.getMissingQuestionIndexes(request);

    return [
      ...questionTabs,
      {label: '提交', status: missingIndexes.length === 0 ? 'ready' : 'blocked'}
    ];
  }

  /**
   * 根据当前焦点生成提示，明确 Other 中左右键属于文本编辑而非 tab 导航。
   */
  private createQuestionDismissHint(request: ActiveUserQuestionRequest, multiSelect: boolean): string {
    if (this.isOtherFocused()) {
      return multiSelect
        ? '←/→ 移动光标 · Up/Down 离开 Other · Enter 确认 · Esc 取消'
        : '←/→ 移动光标 · Up/Down 离开 Other · Enter 确认 · Esc 取消';
    }

    const tabHint = this.hasTabs(request) ? '←/→ 切换问题 · ' : '';
    return multiSelect
      ? `${tabHint}Space 选择/取消 · Enter 确认 · Up/Down 移动 · Esc 取消`
      : `${tabHint}Enter 确认 · Up/Down 选择 · Esc 取消`;
  }

  /**
   * 判断当前 tab 是否为多题请求的最终提交页。
   */
  private isSubmitTab(request: ActiveUserQuestionRequest): boolean {
    return this.hasTabs(request) && request.currentTabIndex === request.request.questions.length;
  }

  /**
   * 判断请求是否启用多题 tab 交互。
   */
  private hasTabs(request: ActiveUserQuestionRequest): boolean {
    return request.request.questions.length > 1;
  }

  /**
   * 判断当前键盘焦点是否位于 Other 内联输入项；只有该项接收文本编辑事件。
   */
  private isOtherFocused(): boolean {
    const request = this.activeRequest;

    if (!request || this.isSubmitTab(request)) {
      return false;
    }

    const question = request.request.questions[request.currentTabIndex];
    return request.drafts[request.currentTabIndex].focusedOptionIndex === question.options.length;
  }

  /**
   * 判断当前题是否启用多选；提交 tab 不属于题目选择态。
   */
  private isCurrentQuestionMultiSelect(): boolean {
    const request = this.activeRequest;
    return Boolean(request && !this.isSubmitTab(request) && request.request.questions[request.currentTabIndex].multiSelect === true);
  }

  /**
   * Other 输入项复用主 composer 的编辑操作；左右键在此处优先移动文本光标。
   */
  private handleOtherEditEvent(event: InputEvent): void {
    const request = this.activeRequest;

    if (!request || this.isSubmitTab(request)) {
      return;
    }

    const draft = request.drafts[request.currentTabIndex];

    if (applyComposerEditEvent(draft.otherComposer, event)) {
      this.onUpdate();
    }
  }

  /**
   * 在当前题选项间移动焦点；每题草稿单独保存焦点位置。
   */
  private moveFocus(direction: number): void {
    const request = this.activeRequest;

    if (!request || this.isSubmitTab(request)) {
      return;
    }

    const questionIndex = request.currentTabIndex;
    const draft = request.drafts[questionIndex];
    const optionCount = request.request.questions[questionIndex].options.length + 1;
    const focusedOptionIndex = moveWrappedIndex(draft.focusedOptionIndex, direction, optionCount);
    this.updateDraft(questionIndex, {...draft, focusedOptionIndex});
  }

  /**
   * 在问题和提交 tab 间循环移动；草稿本身不因导航被修改。
   */
  private moveTab(direction: number): void {
    const request = this.activeRequest;

    if (!request || !this.hasTabs(request)) {
      return;
    }

    const currentTabIndex = moveWrappedIndex(request.currentTabIndex, direction, request.request.questions.length + 1);
    this.activeRequest = {...request, currentTabIndex, validationMessage: undefined};
    this.onUpdate();
  }

  /**
   * 切换多选题中当前普通 option 的 checked 状态；Other 由非空文本自动视为已选。
   */
  private toggleFocusedOption(): void {
    const request = this.activeRequest;

    if (!request || this.isSubmitTab(request)) {
      return;
    }

    const questionIndex = request.currentTabIndex;
    const draft = request.drafts[questionIndex];
    const optionCount = request.request.questions[questionIndex].options.length;

    if (draft.focusedOptionIndex >= optionCount) {
      return;
    }

    const checked = draft.checkedOptionIndexes.includes(draft.focusedOptionIndex);
    const checkedOptionIndexes = checked
      ? draft.checkedOptionIndexes.filter((index) => index !== draft.focusedOptionIndex)
      : [...draft.checkedOptionIndexes, draft.focusedOptionIndex].sort((left, right) => left - right);
    this.updateDraft(questionIndex, {...draft, checkedOptionIndexes});
  }

  /**
   * 确认当前题草稿；多题请求进入下一 tab，单题请求沿用直接返回结果的行为。
   */
  private confirmCurrentQuestion(): void {
    const request = this.activeRequest;

    if (!request || this.isSubmitTab(request)) {
      return;
    }

    const questionIndex = request.currentTabIndex;
    const question = request.request.questions[questionIndex];
    const draft = request.drafts[questionIndex];
    const nextDraft = question.multiSelect === true
      ? draft
      : {...draft, selectedOptionIndex: draft.focusedOptionIndex};
    const answer = this.createAnswer(question, nextDraft);

    if (!answer) {
      this.onUpdate();
      return;
    }

    if (!this.hasTabs(request)) {
      this.resolveActive(createAskUserQuestionsSuccessResult(request.call, [answer]));
      return;
    }

    const drafts = request.drafts.map((item, index) => index === questionIndex ? nextDraft : item);
    this.activeRequest = {
      ...request,
      currentTabIndex: questionIndex + 1,
      drafts,
      validationMessage: undefined
    };
    this.onUpdate();
  }

  /**
   * 校验所有草稿并在通过时按问题原始顺序生成最终 tool result。
   */
  private submitAnswers(): void {
    const request = this.activeRequest;

    if (!request || !this.isSubmitTab(request)) {
      return;
    }

    const missingIndexes = this.getMissingQuestionIndexes(request);

    if (missingIndexes.length > 0) {
      this.activeRequest = {
        ...request,
        validationMessage: `请先回答：${missingIndexes.map((index) => `Q${index + 1}`).join('、')}`
      };
      this.onUpdate();
      return;
    }

    const answers = request.request.questions.map((question, index) => this.createAnswer(question, request.drafts[index])).filter((answer): answer is AskUserQuestionsAnswer => answer !== null);
    this.resolveActive(createAskUserQuestionsSuccessResult(request.call, answers));
  }

  /**
   * 返回尚未形成有效答案的问题下标。
   */
  private getMissingQuestionIndexes(request: ActiveUserQuestionRequest): number[] {
    return request.request.questions.flatMap((question, index) => this.createAnswer(question, request.drafts[index]) ? [] : [index]);
  }

  /**
   * 从单题草稿构造最终答案；该 helper 同时作为完成校验唯一来源。
   */
  private createAnswer(question: AskUserQuestionsRequest['questions'][number], draft: QuestionDraft): AskUserQuestionsAnswer | null {
    const otherText = getText(draft.otherComposer).trim();
    return question.multiSelect === true
      ? this.createMultiSelectAnswer(question, draft.checkedOptionIndexes, otherText)
      : this.createSingleSelectAnswer(question, draft.selectedOptionIndex, otherText);
  }

  /**
   * 为单选题创建答案；只有显式选择且 Other 非空时才视为有效。
   */
  private createSingleSelectAnswer(question: AskUserQuestionsRequest['questions'][number], selectedOptionIndex: number | undefined, otherText: string): AskUserQuestionsAnswer | null {
    if (selectedOptionIndex === undefined || selectedOptionIndex < 0 || selectedOptionIndex > question.options.length) {
      return null;
    }

    const isOther = selectedOptionIndex === question.options.length;

    if (isOther && otherText === '') {
      return null;
    }

    const selectedOption = isOther ? {label: OTHER_OPTION_LABEL} : question.options[selectedOptionIndex];
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

  /**
   * 更新单题草稿并触发 footer 重绘，其他题目状态保持引用不变。
   */
  private updateDraft(questionIndex: number, draft: QuestionDraft): void {
    const request = this.activeRequest;

    if (!request) {
      return;
    }

    this.activeRequest = {
      ...request,
      drafts: request.drafts.map((item, index) => index === questionIndex ? draft : item),
      validationMessage: undefined
    };
    this.onUpdate();
  }

  /**
   * 取消当前请求并向等待中的 interactive tool continuation 返回 cancelled result。
   */
  private cancelActiveRequest(): void {
    const request = this.activeRequest;

    if (!request) {
      return;
    }

    this.resolveActive(createAskUserQuestionsCancelledResult(request.call));
  }

  /**
   * 关闭活跃 surface，解析等待 Promise 并重绘 footer。
   */
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

/**
 * 创建一题的初始编辑草稿，避免不同题目共享 Other composer 或选择状态。
 */
function createQuestionDraft(): QuestionDraft {
  return {
    checkedOptionIndexes: [],
    focusedOptionIndex: 0,
    otherComposer: createComposer()
  };
}

/**
 * 将内部答案投影为提交页可读摘要；Other 自定义文本在摘要中与选项标签合并。
 */
function formatAnswerSummary(answer: AskUserQuestionsAnswer): string {
  const labels = answer.multiSelect ? answer.selectedOptions.map((option) => option.label) : [answer.selectedOption.label];
  return labels.map((label) => label === OTHER_OPTION_LABEL && answer.customText ? `${label}：${answer.customText}` : label).join(', ');
}

export {
  UserQuestionContext
};

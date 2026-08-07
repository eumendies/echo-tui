import {INPUT_EVENTS} from '../../input/event-types';
import {applyComposerEditEvent, createComposer, getText} from '../../input/composer';
import {RUN_BASH_COMMAND_TOOL_NAME} from '../../tools/bash-tool-handler';
import {parseBashCommand} from '../../tools/tool-risk-classifier';
import {moveWrappedIndex} from '../utils';

import type {ToolApprovalDecision} from '../../types/agent';
import type {ChoiceCommandSurface} from '../../types/command';
import type {ComposerState} from '../../types/composer';
import type {InputEvent} from '../../types/input';
import type {ToolApprovalRequest, ToolCall} from '../../types/tool';

type ToolApprovalOptionId = 'allow_once' | 'allow_tool_for_session' | 'allow_command_for_session' | 'allow_all_for_session' | 'deny' | 'feedback';

type ToolApprovalOption = {
  id: ToolApprovalOptionId;
  label: string;
};

type ActiveToolApprovalRequest = {
  call: ToolCall;
  display?: ToolApprovalRequest;
  feedbackComposer: ComposerState;
  selectedIndex: number;
  resolve: (decision: ToolApprovalDecision) => void;
};

const TOOL_APPROVAL_OPTIONS: ToolApprovalOption[] = [
  {id: 'allow_once', label: 'Allow once'},
  {id: 'allow_all_for_session', label: 'Allow all tools for this session'},
  {id: 'deny', label: 'Deny'},
  {id: 'feedback', label: 'Tell model what to do'}
];

const TOOL_APPROVAL_FEEDBACK_PLACEHOLDER = 'Type instruction for the model...';

/**
 * 管理 agent 工具执行前的用户授权 modal；只持有授权态，不触碰工具执行或主 composer。
 */
class ToolApprovalContext {
  activeRequest: ActiveToolApprovalRequest | null;
  allowAllForSession: boolean;
  allowedToolsForSession: Set<string>;
  allowedBashCommandsForSession: Set<string>;
  onUpdate: () => void;

  constructor(onUpdate: () => void) {
    this.activeRequest = null;
    this.allowAllForSession = false;
    this.allowedToolsForSession = new Set();
    this.allowedBashCommandsForSession = new Set();
    this.onUpdate = onUpdate;
  }

  /**
   * 处理一次工具授权请求；命中会话缓存时同步返回，只有真实打开选择界面时才返回 Promise。
   */
  request(call: ToolCall, display?: ToolApprovalRequest): ToolApprovalDecision | Promise<ToolApprovalDecision> {
    if (this.activeRequest) {
      this.resolveActive({kind: 'deny', message: 'Tool execution was rejected because another approval request replaced it.'});
    }

    const cachedDecision = this.getCachedDecision(call);

    if (cachedDecision) {
      return cachedDecision;
    }

    return this.requestManual(call, display);
  }

  /** 返回当前会话缓存对该调用的决策；未授权时不创建 modal。 */
  getCachedDecision(call: ToolCall): ToolApprovalDecision | null {
    if (this.allowAllForSession) {
      return {kind: 'allow_all_for_session'};
    }

    if (call.toolName === RUN_BASH_COMMAND_TOOL_NAME) {
      const command = parseBashCommandCall(call);
      return command && this.allowedBashCommandsForSession.has(command)
        ? {kind: 'allow_command_for_session', toolName: RUN_BASH_COMMAND_TOOL_NAME, command}
        : null;
    }

    return this.allowedToolsForSession.has(call.toolName)
      ? {kind: 'allow_tool_for_session', toolName: call.toolName}
      : null;
  }

  /** 创建现有人工审批 modal；调用方应先自行检查会话缓存。 */
  requestManual(call: ToolCall, display?: ToolApprovalRequest): Promise<ToolApprovalDecision> {
    if (this.activeRequest) {
      this.resolveActive({kind: 'deny', message: 'Tool execution was rejected because another approval request replaced it.'});
    }

    return new Promise((resolve) => {
      this.activeRequest = {
        call,
        display,
        feedbackComposer: createComposer(),
        selectedIndex: 0,
        resolve
      };
      this.onUpdate();
    });
  }

  /**
   * 返回当前是否存在需要用户处理的授权请求。
   */
  hasActiveRequest(): boolean {
    return this.activeRequest !== null;
  }

  /**
   * 返回当前会话是否已放开全部工具授权，用于 status line 暴露安全边界变化。
   */
  isAllowAllForSession(): boolean {
    return this.allowAllForSession;
  }

  /**
   * 在普通输入态切换全部工具会话授权；返回切换后的状态供上层按需记录或渲染。
   */
  toggleAllowAllForSession(): boolean {
    this.allowAllForSession = !this.allowAllForSession;
    this.onUpdate();
    return this.allowAllForSession;
  }

  /**
   * 将当前授权请求投影成通用 choice surface；渲染层无需知道 tool approval 内部状态。
   */
  getSurface(): ChoiceCommandSurface | null {
    const request = this.activeRequest;

    if (!request) {
      return null;
    }

    return {
      kind: 'choice',
      title: 'PERMISSION',
      ...(request.display?.preview ? {
        message: request.display.preview,
        messageTitle: request.display.previewTitle || 'command',
        messageStyle: 'code' as const
      } : {}),
      optionsTitle: 'action',
      options: this.createOptions(request.call).map((option) => ({
        label: option.label,
        ...(option.id === 'feedback' ? {
          inlineInput: {
            cursor: request.feedbackComposer.cursor,
            placeholder: TOOL_APPROVAL_FEEDBACK_PLACEHOLDER,
            text: getText(request.feedbackComposer)
          }
        } : {})
      })),
      focusedIndex: request.selectedIndex,
      dismissHint: '↑/↓ move · enter confirm · esc cancel'
    };
  }

  /**
   * 处理授权 modal 激活期间的输入事件；modal 会消费所有输入，避免污染主 composer。
   */
  handleEvent(event: InputEvent): boolean {
    if (!this.activeRequest) {
      return false;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP) {
      this.moveSelection(-1);
      return true;
    }

    if (event.type === INPUT_EVENTS.MOVE_DOWN) {
      this.moveSelection(1);
      return true;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      this.resolveSelectedOption();
      return true;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.resolveActive({kind: 'deny'});
      return true;
    }

    if (this.isFeedbackSelected()) {
      this.handleFeedbackEditEvent(event);
      return true;
    }

    return true;
  }

  private isFeedbackSelected(): boolean {
    const request = this.activeRequest;
    return Boolean(request && this.createOptions(request.call)[request.selectedIndex]?.id === 'feedback');
  }

  /**
   * 反馈输入项复用主 composer 的单行编辑语义；上下键仍保留给 choice 选择移动。
   */
  private handleFeedbackEditEvent(event: InputEvent): void {
    const request = this.activeRequest;

    if (!request) {
      return;
    }

    if (applyComposerEditEvent(request.feedbackComposer, event)) {
      this.onUpdate();
    }
  }

  private moveSelection(direction: number): void {
    const request = this.activeRequest;

    if (!request) {
      return;
    }

    const options = this.createOptions(request.call);
    const nextIndex = moveWrappedIndex(request.selectedIndex, direction, options.length);
    this.activeRequest = {...request, selectedIndex: nextIndex};
    this.onUpdate();
  }

  private resolveSelectedOption(): void {
    const request = this.activeRequest;

    if (!request) {
      return;
    }

    const option = this.createOptions(request.call)[request.selectedIndex];

    if (option.id === 'allow_once') {
      this.resolveActive({kind: 'allow_once'});
      return;
    }

    if (option.id === 'allow_tool_for_session') {
      this.allowedToolsForSession.add(request.call.toolName);
      this.resolveActive({kind: 'allow_tool_for_session', toolName: request.call.toolName});
      return;
    }

    if (option.id === 'allow_command_for_session') {
      const command = parseBashCommandCall(request.call);

      if (command) {
        this.allowedBashCommandsForSession.add(command);
        this.resolveActive({kind: 'allow_command_for_session', toolName: RUN_BASH_COMMAND_TOOL_NAME, command});
        return;
      }

      this.onUpdate();
      return;
    }

    if (option.id === 'allow_all_for_session') {
      this.allowAllForSession = true;
      this.resolveActive({kind: 'allow_all_for_session'});
      return;
    }

    if (option.id === 'feedback') {
      const message = getText(request.feedbackComposer).trim();

      if (message === '') {
        this.onUpdate();
        return;
      }

      this.resolveActive({kind: 'provide_feedback', message});
      return;
    }

    this.resolveActive({kind: 'deny'});
  }

  /**
   * 为当前工具调用生成授权选项；bash 只提供 command 级会话授权，避免放宽到整个 shell 工具。
   */
  private createOptions(call: ToolCall): ToolApprovalOption[] {
    const sessionOption = createSessionApprovalOption(call);
    return [
      TOOL_APPROVAL_OPTIONS[0],
      ...(sessionOption ? [sessionOption] : []),
      ...TOOL_APPROVAL_OPTIONS.slice(1)
    ];
  }

  private resolveActive(decision: ToolApprovalDecision): void {
    const request = this.activeRequest;

    if (!request) {
      return;
    }

    this.activeRequest = null;
    request.resolve(decision);
    this.onUpdate();
  }
}

function createSessionApprovalOption(call: ToolCall): ToolApprovalOption | null {
  if (call.toolName === RUN_BASH_COMMAND_TOOL_NAME) {
    return parseBashCommandCall(call) ? {id: 'allow_command_for_session', label: 'Allow this command for this session'} : null;
  }

  return {id: 'allow_tool_for_session', label: `Allow ${call.toolName} for this session`};
}

function parseBashCommandCall(call: ToolCall): string | null {
  if (call.toolName !== RUN_BASH_COMMAND_TOOL_NAME) {
    return null;
  }

  return parseBashCommand(call.argumentsText);
}

export {
  createSessionApprovalOption,
  parseBashCommandCall,
  ToolApprovalContext
};

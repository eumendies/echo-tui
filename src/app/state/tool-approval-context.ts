import {INPUT_EVENTS} from '../../input/event-types';
import {formatSubagentRawName, isBuiltinSubagentName} from '../../agent/subagent/name';
import {applyComposerEditEvent, createComposer, getText} from '../../input/composer';
import {RUN_BASH_COMMAND_TOOL_NAME} from '../../tools/bash-tool-handler';
import {parseBashCommand} from '../../tools/tool-risk-classifier';
import {moveWrappedIndex} from '../utils';

import type {ToolApprovalDecision} from '../../types/agent';
import type {ChoiceCommandSurface} from '../../types/command';
import type {ComposerState} from '../../types/composer';
import type {InputEvent} from '../../types/input';
import type {SessionApprovalsStore} from '../../types/session-approvals';
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

type ToolApprovalPersistence = {
  getCwd: () => string; // 当前工作目录，决定 transcript 与 sidecar 的项目分区。
  getSessionId: () => string | null; // 当前已落盘会话标识；journal 尚未创建时为 null。
  onPersistError?: (error: unknown, operation: 'read' | 'write') => void; // sidecar 读写失败的提示与排障通道。
  store: SessionApprovalsStore; // 会话级授权 sidecar 读写入口。
};

const TOOL_APPROVAL_OPTIONS: ToolApprovalOption[] = [
  {id: 'allow_once', label: 'Allow once'},
  {id: 'allow_all_for_session', label: 'Allow all tools for this session'},
  {id: 'deny', label: 'Deny'},
  {id: 'feedback', label: 'Tell model what to do'}
];

const TOOL_APPROVAL_FEEDBACK_PLACEHOLDER = 'Type instruction for the model...';
const INTERRUPTED_APPROVAL_DECISION: ToolApprovalDecision = {kind: 'deny', message: 'Tool execution was interrupted.'};

/**
 * 管理 agent 工具执行前的用户授权 modal；只持有授权态，不触碰工具执行或主 composer。
 */
class ToolApprovalContext {
  activeRequest: ActiveToolApprovalRequest | null;
  private pendingRequests: ActiveToolApprovalRequest[];
  allowAllForSession: boolean;
  allowedToolsForSession: Set<string>;
  allowedBashCommandsForSession: Set<string>;
  onUpdate: () => void;
  private readonly persistence?: ToolApprovalPersistence;

  constructor(onUpdate: () => void, persistence?: ToolApprovalPersistence) {
    this.activeRequest = null;
    this.pendingRequests = [];
    this.allowAllForSession = false;
    this.allowedToolsForSession = new Set();
    this.allowedBashCommandsForSession = new Set();
    this.onUpdate = onUpdate;
    this.persistence = persistence;
  }

  /**
   * 处理一次工具授权请求；命中会话缓存时同步返回，只有真实打开选择界面时才返回 Promise。
   * 已有活跃请求时新请求进入 FIFO 队列等待，不抢占式拒绝现有请求。
   */
  request(call: ToolCall, display?: ToolApprovalRequest): ToolApprovalDecision | Promise<ToolApprovalDecision> {
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

  /** 创建现有人工审批 modal；活跃请求存在时排队等待，调用方应先自行检查会话缓存。 */
  requestManual(call: ToolCall, display?: ToolApprovalRequest): Promise<ToolApprovalDecision> {
    return new Promise((resolve) => {
      const request: ActiveToolApprovalRequest = {
        call,
        display,
        feedbackComposer: createComposer(),
        selectedIndex: 0,
        resolve
      };

      if (this.activeRequest) {
        this.pendingRequests.push(request);
        return;
      }

      this.activeRequest = request;
      this.onUpdate();
    });
  }

  /** 父 turn 中断时清算活跃与排队请求；全部以 interrupted 决议收尾，避免并行子 Agent 等待悬挂。 */
  cancelAllPending(): void {
    const request = this.activeRequest;
    const queued = this.pendingRequests;

    if (!request && queued.length === 0) {
      return;
    }

    this.activeRequest = null;
    this.pendingRequests = [];
    request?.resolve(INTERRUPTED_APPROVAL_DECISION);
    for (const entry of queued) {
      entry.resolve(INTERRUPTED_APPROVAL_DECISION);
    }
    this.onUpdate();
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
   * 两个方向都必须落盘：省略关闭方向的写入会让重启后的 TOOLS all 复活。
   */
  toggleAllowAllForSession(): boolean {
    this.allowAllForSession = !this.allowAllForSession;
    this.persistSessionApprovals();
    this.onUpdate();
    return this.allowAllForSession;
  }

  /**
   * 从当前会话的 sidecar 恢复授权；缺失或损坏一律按空授权处理，不向上抛出。
   * 由 /resume 成功加载会话后调用，使审批缓存跟随会话而不是进程。
   */
  restoreForSession(): void {
    this.resetSessionApprovals();

    const persistence = this.persistence;
    const sessionId = persistence?.getSessionId();

    if (persistence && sessionId) {
      try {
        const result = persistence.store.read(persistence.getCwd(), sessionId);

        if (result.kind === 'found') {
          this.applySessionApprovals(result.approvals.allowAll, result.approvals.tools, result.approvals.bashCommands);
        }
      } catch (error: unknown) {
        persistence.onPersistError?.(error, 'read');
      }
    }

    this.onUpdate();
  }

  /**
   * 清空内存授权；用于 /clear 之后的新会话边界。
   * 此处不写盘：调用点已解绑当前 session，新会话首次落盘后才会产生自己的 sidecar。
   */
  clearForNewSession(): void {
    this.resetSessionApprovals();
    this.onUpdate();
  }

  /**
   * 把当前内存授权写入已切换的新会话 sidecar；/fork 创建新会话后调用即可完成分支继承。
   */
  inheritToNewSession(): void {
    this.persistSessionApprovals();
  }

  /**
   * 尽力删除指定会话的授权 sidecar；失败静默，不影响已提交的 journal 删除结果。
   */
  discardSession(sessionId: string): void {
    const persistence = this.persistence;

    if (!persistence) {
      return;
    }

    try {
      persistence.store.remove(persistence.getCwd(), sessionId);
    } catch {
      // Sidecar 仅用于恢复，清理失败不改变调用方已经完成的历史会话删除。
    }
  }

  /** 覆盖内存授权集合，只被恢复路径使用。 */
  private applySessionApprovals(allowAll: boolean, tools: string[], bashCommands: string[]): void {
    this.allowAllForSession = allowAll;
    this.allowedToolsForSession = new Set(tools);
    this.allowedBashCommandsForSession = new Set(bashCommands);
  }

  /** 清空三个内存字段，不触发写盘。 */
  private resetSessionApprovals(): void {
    this.allowAllForSession = false;
    this.allowedToolsForSession = new Set();
    this.allowedBashCommandsForSession = new Set();
  }

  /**
   * 把当前授权镜像到 sidecar；journal 尚未创建时跳过，写盘失败只提示并保留内存授权。
   */
  private persistSessionApprovals(): void {
    const persistence = this.persistence;
    const sessionId = persistence?.getSessionId();

    if (!persistence || !sessionId) {
      return;
    }

    try {
      persistence.store.write(persistence.getCwd(), {
        sessionId,
        allowAll: this.allowAllForSession,
        tools: [...this.allowedToolsForSession],
        bashCommands: [...this.allowedBashCommandsForSession]
      });
    } catch (error: unknown) {
      // 授权写盘失败只影响跨进程存活；本次会话仍按内存状态放行，不能因此中断工具执行。
      persistence.onPersistError?.(error, 'write');
    }
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
      title: request.display?.origin ? `PERMISSION · ${formatApprovalAgentName(request.display.origin.agentName)}` : 'PERMISSION',
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
      dismissHint: '鼠标悬停/点击 · ↑/↓ move · enter confirm · esc cancel'
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

  /**
   * 按 choice option 索引处理鼠标命中；feedback 仅获得输入焦点，普通 action 才可确认授权。
   */
  handlePointerOption(index: number, activate: boolean): boolean {
    const request = this.activeRequest;

    if (!request || !Number.isInteger(index) || index < 0) {
      return false;
    }

    const options = this.createOptions(request.call);
    const option = options[index];

    if (!option) {
      return false;
    }

    const focusChanged = request.selectedIndex !== index;
    if (focusChanged) {
      this.activeRequest = {...request, selectedIndex: index};
      this.onUpdate();
    }

    if (!activate || option.id === 'feedback') {
      return focusChanged;
    }

    this.resolveSelectedOption();
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
      this.persistSessionApprovals();
      this.resolveActive({kind: 'allow_tool_for_session', toolName: request.call.toolName});
      return;
    }

    if (option.id === 'allow_command_for_session') {
      const command = parseBashCommandCall(request.call);

      if (command) {
        this.allowedBashCommandsForSession.add(command);
        this.persistSessionApprovals();
        this.resolveActive({kind: 'allow_command_for_session', toolName: RUN_BASH_COMMAND_TOOL_NAME, command});
        return;
      }

      this.onUpdate();
      return;
    }

    if (option.id === 'allow_all_for_session') {
      this.allowAllForSession = true;
      this.persistSessionApprovals();
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

    // FIFO 提升下一个排队请求；没有排队时回到空闲态。
    this.activeRequest = this.pendingRequests.shift() || null;
    request.resolve(decision);
    this.onUpdate();
  }
}

/** 保留内置审批标题的大写文案，自定义名称按目录原名展示，并隔离损坏身份。 */
function formatApprovalAgentName(agentName: unknown): string {
  const safeName = formatSubagentRawName(agentName);
  return isBuiltinSubagentName(agentName) ? safeName.toUpperCase() : safeName;
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

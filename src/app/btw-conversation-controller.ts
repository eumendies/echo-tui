import * as composerOps from '../input/composer';
import {INPUT_EVENTS} from '../input/event-types';
import {createCompactionNoticeRecord} from '../agent/context/context-compaction';
import {createToolCallTranscriptRecord, createToolResultTranscriptRecord} from '../tools/tool-transcript-record';

import type {AgentCallbacks, AgentSessionInput, AgentUserConfigSnapshot, RunAgent} from '../types/agent';
import type {ComposerState} from '../types/composer';
import type {InputEvent} from '../types/input';
import type {PendingMessageRenderState, PendingState, RenderState, StatusLineState, WorkingState} from '../types/render';
import type {CompactionState, TodoState, TranscriptRecord} from '../types/transcript';
import type {ToolCall} from '../types/tool';

const BTW_BOUNDARY = [
  '[BTW SIDE CONVERSATION]',
  '',
  'This is a temporary side conversation. The preceding primary conversation is frozen reference context only.',
  'Do not continue the primary task, unfinished plans, todos, or intended tool calls.',
  'Answer only this BTW question. Only read-only tools may be used.',
  '',
  '[BTW QUESTION]',
  ''
].join('\n');

type BtwConversationState = {
  conversationId: number; // 当前临时会话 identity，关闭后旧 callback 失效。
  baseRecords: TranscriptRecord[]; // 打开时冻结的主 transcript provider 上下文。
  records: TranscriptRecord[]; // BTW 自身产生且仅在内存存在的 records。
  composer: ComposerState; // BTW 独立输入编辑状态。
  compaction?: CompactionState; // BTW 独立演进的压缩状态。
  todoState?: TodoState; // BTW 独立演进的 todo 状态。
  pendingMessage?: string; // side turn 运行时等待自动 claim 的单槽消息。
  pending: PendingState | null; // 当前 side turn 的 footer pending 投影。
  working: WorkingState | null; // 当前 side turn 是否展示 working 计时行。
  activityStartedAt: number | null; // 当前 side turn 的 elapsedMs 时间锚点。
  activeTurnId: number | null; // 当前 side turn identity。
  abortController: AbortController | null; // 当前 side turn 的取消入口。
  pendingToolCall: ToolCall | null; // 等待 result 配对的当前工具调用。
  streamingDraft: string; // 当前 provider segment 的完整 assistant 草稿。
  reasoningDraft: string; // 当前 side provider turn 的完整可读 reasoning 草稿。
  modelLabel?: string; // provider 解析后的 side model 标签。
  agentOptions: Omit<AgentSessionInput, 'records' | 'compaction' | 'todoState' | 'sessionJournalPath' | 'abortSignal' | 'interactionMode' | 'toolPolicy' | 'conversationKind' | 'userConfigSnapshot'>; // 打开时冻结的模型与压缩阈值选择。
  interactionMode: 'normal' | 'plan'; // BTW 仅继承 normal/plan 回答语义，不继承 shell 提交模式。
};

type BtwParentTurnState = {
  pending: PendingState | null; // 主 turn 当前可见的 pending 阶段，用于生成 BTW 后台摘要。
  responding: boolean; // 主流程是否仍持有 response lock。
};

type BtwConversationDependencies = {
  runAgent: RunAgent; // 共享 provider-neutral agent loop。
  getParentSession(): AgentSessionInput; // 捕获打开瞬间的主 transcript provider 上下文。
  captureUserConfigSnapshot(): AgentUserConfigSnapshot; // 为每次 side turn 捕获当时最新的用户配置 revision。
  getParentTurnState(): BtwParentTurnState; // 读取主 turn 的最小活动状态，不把 BTW 展示文案放进 main 编排层。
  renderRecords(records: TranscriptRecord[]): void; // 成组渲染已经写入 side 会话状态的普通 records。
  render(finalizeRecord?: Extract<TranscriptRecord, {role: 'assistant' | 'reasoning_summary'}>): void; // 提交流式稳定前缀、按需完成流式 record 并重绘 footer。
  repaint(): void; // 进入、退出和终端尺寸变化时清屏重绘。
};

/**
 * 管理不持久化的 BTW 多轮会话，并用 conversation/turn identity 隔离迟到回调。
 */
class BtwConversationController {
  private readonly dependencies: BtwConversationDependencies;
  private state: BtwConversationState | null = null;
  private nextConversationId = 1;
  private nextTurnId = 1;

  constructor(dependencies: BtwConversationDependencies) {
    this.dependencies = dependencies;
  }

  /** 返回 BTW 全视图当前是否接管 app 可见投影。 */
  isActive(): boolean {
    return this.state !== null;
  }

  /** 返回当前 side-only records；关闭后返回空数组。 */
  getRecords(): TranscriptRecord[] {
    return this.state ? this.state.records : [];
  }

  /** 返回 BTW 独立 composer，供投影和测试读取。 */
  getComposer(): ComposerState | null {
    return this.state?.composer || null;
  }

  /** 获取随主 turn 更新的后台活动摘要。 */
  getParentActivity(): string {
    const parent = this.dependencies.getParentTurnState();
    if (parent.pending?.kind === 'tool_call') return `MAIN tool ${parent.pending.toolName}`;
    if (parent.pending?.kind === 'reasoning_streaming') return 'MAIN reasoning';
    if (parent.pending?.kind === 'streaming') return 'MAIN streaming';
    if (parent.pending?.kind === 'thinking') return 'MAIN thinking';
    return parent.responding ? 'MAIN working' : 'MAIN idle';
  }

  /** 捕获主会话快照并进入 BTW；首条问题异步启动，避免阻塞 command runtime。 */
  open(initialQuestion?: string): void {
    if (this.state) return;
    const parent = this.dependencies.getParentSession();
    const {records, compaction, todoState: _todoState, sessionJournalPath: _journalPath, abortSignal: _abortSignal, interactionMode, toolPolicy: _toolPolicy, conversationKind: _conversationKind, userConfigSnapshot: _userConfigSnapshot, ...agentOptions} = parent;
    this.state = {
      conversationId: this.nextConversationId++,
      baseRecords: structuredClone(records),
      records: [],
      composer: composerOps.createComposer(),
      compaction: compaction ? structuredClone(compaction) : undefined,
      pending: null,
      working: null,
      activityStartedAt: null,
      activeTurnId: null,
      abortController: null,
      pendingToolCall: null,
      streamingDraft: '',
      reasoningDraft: '',
      agentOptions: structuredClone(agentOptions),
      interactionMode: interactionMode === 'plan' ? 'plan' : 'normal'
    };
    this.dependencies.repaint();
    if (initialQuestion?.trim()) void this.runTurn(initialQuestion.trim());
  }

  /** 使旧 identity 失效、abort side turn 并丢弃全部临时状态。 */
  close(): void {
    const current = this.state;
    if (!current) return;
    current.abortController?.abort();
    this.state = null;
  }

  /** 把 command session 事件应用到 BTW 独立 composer。 */
  handleEvent(event: InputEvent): Promise<void> | void {
    const state = this.state;
    if (!state) return;
    if (composerOps.applyComposerEditEvent(state.composer, event)) {
      this.dependencies.render();
      return;
    }
    if (event.type === INPUT_EVENTS.MOVE_UP) composerOps.moveUp(state.composer);
    else if (event.type === INPUT_EVENTS.MOVE_DOWN) composerOps.moveDown(state.composer);
    else if (event.type === INPUT_EVENTS.INSERT_NEWLINE) composerOps.insertNewline(state.composer);
    else if (event.type === INPUT_EVENTS.SUBMIT) {
      const text = composerOps.getText(state.composer).trim();
      if (!text) return;
      if (state.activeTurnId !== null) {
        if (state.pendingMessage !== undefined) {
          this.dependencies.render();
          return;
        }
        state.pendingMessage = text;
        composerOps.setText(state.composer, '');
        this.dependencies.render();
        return;
      }
      composerOps.setText(state.composer, '');
      return this.runTurn(text);
    } else return;
    this.dependencies.render();
  }

  /** 返回共享 activity timer 当前是否需要投影 BTW 活动。 */
  hasTimedActivity(): boolean {
    return Boolean(this.state && this.state.activeTurnId !== null && this.state.activityStartedAt !== null);
  }

  /** 用 BTW composer、pending 和状态栏覆盖主 RenderState，其余主题与终端约束继续复用。 */
  createRenderState(base: RenderState): RenderState {
    const state = this.state;
    if (!state) return base;
    const elapsedMs = state.activityStartedAt === null ? 0 : Math.max(0, Date.now() - state.activityStartedAt);
    const pending = state.pending?.kind === 'thinking'
      ? {...state.pending, elapsedMs}
      : state.pending;
    const working = state.working ? {elapsedMs} : null;
    const statusLine: StatusLineState | undefined = base.commandSurface ? undefined : {
      projectName: base.statusLine?.projectName || '',
      model: state.modelLabel ? {kind: 'default', label: state.modelLabel} : base.statusLine?.model || {kind: 'default', label: 'model unavailable'},
      mode: 'btw',
      detail: `readonly · ${this.getParentActivity()}`,
      keyHint: 'Esc 返回主会话'
    };
    const pendingMessage: PendingMessageRenderState | null = state.pendingMessage ? {preview: state.pendingMessage.replace(/\s+/g, ' ')} : null;
    return {
      ...base,
      composer: state.composer,
      slashSuggestions: null,
      conversationReference: null,
      pendingMessage,
      pending,
      working,
      statusLine
    };
  }

  /** 根据当前草稿重建 footer pending。 */
  private refreshPending(state: BtwConversationState): void {
    if (state.streamingDraft !== '') {
      state.pending = {
        kind: 'streaming',
        text: state.streamingDraft,
        ...(state.reasoningDraft ? {reasoningText: state.reasoningDraft} : {})
      };
      return;
    }
    state.pending = state.reasoningDraft !== ''
      ? {kind: 'reasoning_streaming', text: state.reasoningDraft}
      : null;
  }

  /** 把当前 side reasoning 草稿落成 record，并消费草稿。 */
  private finalizeReasoning(state: BtwConversationState, text = state.reasoningDraft): void {
    if (text.trim() === '') return;
    state.reasoningDraft = '';
    this.refreshPending(state);
    const record: TranscriptRecord = {role: 'reasoning_summary', text};
    state.records.push(record);
    this.dependencies.render(record);
  }

  /** 把当前 side assistant segment 落成 record，并消费草稿。 */
  private finalizeAssistantSegment(state: BtwConversationState, text: string): void {
    state.streamingDraft = '';
    state.pending = null;
    if (text.trim() === '') return;
    const record: TranscriptRecord = {role: 'assistant', text};
    state.records.push(record);
    this.dependencies.render(record);
  }

  /** 启动单次 side turn；所有 callback 在写状态前验证 conversation 与 turn identity。 */
  private async runTurn(userText: string): Promise<void> {
    const state = this.state;
    if (!state) return;
    const conversationId = state.conversationId;
    const turnId = this.nextTurnId++;
    const firstQuestion = state.records.every((record) => record.role !== 'user');
    const userRecord: TranscriptRecord = {
      role: 'user',
      text: firstQuestion ? `${BTW_BOUNDARY}${userText}` : `[BTW FOLLOW-UP]\n\n${userText}`,
      displayText: userText
    };
    state.records.push(userRecord);
    state.activeTurnId = turnId;
    state.abortController = new AbortController();
    state.streamingDraft = '';
    state.reasoningDraft = '';
    state.pending = {kind: 'thinking', elapsedMs: 0};
    state.working = null;
    state.activityStartedAt = Date.now();
    this.dependencies.renderRecords([userRecord]);
    const isCurrent = (): boolean => this.state?.conversationId === conversationId && this.state.activeTurnId === turnId;
    const append = (records: TranscriptRecord[]): void => {
      if (!isCurrent() || records.length === 0) return;
      this.state!.records.push(...records);
      this.dependencies.renderRecords(records);
    };
    const callbacks: AgentCallbacks = {
      onModelResolved: (model) => {
        if (!isCurrent()) return;
        this.state!.modelLabel = model.model;
        this.dependencies.render();
      },
      onThinking: () => {
        if (!isCurrent()) return;
        this.state!.pending = {kind: 'thinking', elapsedMs: 0};
        if (this.state!.activityStartedAt === null) this.state!.activityStartedAt = Date.now();
        this.dependencies.render();
      },
      onToken: (_token, draft) => {
        if (!isCurrent()) return;
        const startsAssistant = this.state!.streamingDraft === '';
        this.state!.streamingDraft = draft;
        this.state!.working = {elapsedMs: 0};
        this.refreshPending(this.state!);
        if (startsAssistant) this.dependencies.render();
      },
      onReasoningUpdate: (update) => {
        if (!isCurrent()) return;
        this.state!.working = {elapsedMs: 0};

        if (update.kind === 'draft') {
          this.state!.reasoningDraft = update.text;
          this.refreshPending(this.state!);
          return;
        }

        this.finalizeReasoning(this.state!, update.text);
      },
      onProviderRetry: (retry) => {
        if (!isCurrent()) return;
        this.dependencies.render();
        append([{role: 'local_notice', text: retry.message}]);
      },
      onProviderRecords: (records) => append(records),
      onAssistantSegment: (text) => {
        if (!isCurrent()) return;
        this.finalizeAssistantSegment(this.state!, text);
      },
      onToolCall: (call) => {
        if (!isCurrent()) return;
        this.state!.pendingToolCall = call;
        this.state!.pending = {kind: 'tool_call', toolName: call.toolName, argumentsText: call.argumentsText};
        this.dependencies.render();
      },
      onToolResult: (result) => {
        if (!isCurrent()) return;
        const call = this.state!.pendingToolCall;
        this.state!.pendingToolCall = null;
        this.state!.pending = {kind: 'thinking', elapsedMs: 0};
        append([...(call ? [createToolCallTranscriptRecord(call)] : []), createToolResultTranscriptRecord(result)]);
      },
      onTodoStateChange: (todoState) => {
        if (isCurrent()) this.state!.todoState = structuredClone(todoState);
      },
      onCompacted: (compaction) => {
        if (!isCurrent()) return;
        this.state!.compaction = structuredClone(compaction);
        this.dependencies.render();
        append([createCompactionNoticeRecord(compaction)]);
      },
      onComplete: (text) => {
        if (!isCurrent()) return;
        this.finalizeAssistantSegment(this.state!, text);
        this.state!.pending = null;
        this.state!.working = null;
        this.state!.activityStartedAt = null;
      }
    };

    try {
      await this.dependencies.runAgent({
        ...state.agentOptions,
        userConfigSnapshot: this.dependencies.captureUserConfigSnapshot(),
        records: [...state.baseRecords, ...state.records],
        compaction: state.compaction,
        todoState: state.todoState,
        abortSignal: state.abortController.signal,
        interactionMode: state.interactionMode,
        toolPolicy: 'readonly',
        conversationKind: 'btw'
      }, callbacks);
    } catch (error: unknown) {
      if (isCurrent() && !state.abortController.signal.aborted) {
        this.finalizeReasoning(this.state!);
        this.finalizeAssistantSegment(this.state!, this.state!.streamingDraft);
        this.state!.pending = null;
        this.state!.working = null;
        this.state!.activityStartedAt = null;
        append([{role: 'error', text: error instanceof Error ? error.message : String(error)}]);
      }
    } finally {
      if (!isCurrent()) return;
      const next = this.state!.pendingMessage;
      this.state!.pendingMessage = undefined;
      this.state!.activeTurnId = null;
      this.state!.abortController = null;
      this.state!.pendingToolCall = null;
      this.state!.pending = null;
      this.state!.working = null;
      this.state!.activityStartedAt = null;
      this.dependencies.render();
      if (next) await this.runTurn(next);
    }
  }
}

export {BTW_BOUNDARY, BtwConversationController};
export type {BtwConversationDependencies};

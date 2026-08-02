import type { ComposerState } from './composer';
import type { CommandSurface, CommandSurfaceOption } from './command';
import type { TranscriptRecord } from './transcript';
import type { TuiTheme } from '../config/theme-config';
import type { ContextUsage, ReasoningEffort } from './agent';
import type { AppRenderPreferences } from '../config/app-settings-config';
import type { ConversationReferenceProjectionMode } from './transcript';

export type TerminalSize = {
  columns: number;
  rows: number;
};

export type BannerContext = {
  cwd: string;
  nodeVersion: string;
  terminalSize: TerminalSize;
  mode: string;
};

/**
 * 首字响应前的 thinking 状态，用于展示模型思考中。
 * elapsedMs 由 turn-context 在序列化时根据当前时钟计算，渲染层用其推导 spinner 帧。
 */
export type ThinkingPendingState = {
  kind: 'thinking';
  elapsedMs: number;
};

/**
 * 流式输出状态，用于展示模型响应
 */
export type StreamingPendingState = {
  kind: 'streaming';
  text: string;
};

/**
 * 工具调用预览状态，用于展示模型调用的工具
 */
export type ToolCallPendingState = {
  kind: 'tool_call';
  toolName: string;
  argumentsText: string;
};

/**
 * shell mode 命令运行中的本地输出预览，完成后才会落成 transcript record。
 */
export type ShellOutputPendingState = {
  kind: 'shell_output';
  command: string;
  output: string;
};

export type PendingState = ThinkingPendingState | StreamingPendingState | ToolCallPendingState | ShellOutputPendingState;

export type WorkingState = {
  elapsedMs: number;
};

export type SlashSuggestionState = {
  options: CommandSurfaceOption[];
  selectedIndex: number;
};

export type StatusLineMode = 'idle' | 'command' | 'thinking' | 'streaming' | 'tool' | 'plan' | 'shell' | 'shell-local' | 'mcp';

export type StatusLineModelState = {
  modelLabel: string;
  reasoningEffort?: ReasoningEffort;
  skillOverride?: boolean;
};

export type StatusLineModelRenderState =
  | {
      kind: 'default';
      label: string;
      effort?: ReasoningEffort;
      skillOverride?: boolean;
    }
  | {
      kind: 'tuning';
      label: string;
      effort: ReasoningEffort;
      activeField: 'model' | 'effort';
      error?: string;
    };

export type StatusLineActivityState = {
  kind: 'thinking' | 'working';
  elapsedMs: number;
};

export type StatusLineState = {
  projectName: string;
  model: StatusLineModelRenderState;
  mode: StatusLineMode;
  allowAllTools?: boolean;
  contextUsage?: ContextUsage;
  detail?: string;
  activity?: StatusLineActivityState;
  keyHint?: string;
};

export type RenderPreferences = AppRenderPreferences;

export type ConversationReferenceRenderState = {
  preparing?: boolean; // 指示长引用总结正在运行，footer 会切换取消提示。
  projectionMode: ConversationReferenceProjectionMode; // 指示引用卡片展示全文或总结标签。
  title: string; // 引用卡片中展示的历史会话标题。
};

export type PendingMessageRenderState = {
  preview: string; // 已压成单行但尚未按终端宽度裁剪的待发送文本。
};

export type RenderState = {
  composer: ComposerState;
  conversationReference?: ConversationReferenceRenderState | null; // composer 上方展示的瞬时历史会话引用卡片。
  pendingMessage?: PendingMessageRenderState | null; // composer 上方展示的单条 transient 待发送消息。
  commandSurface: CommandSurface | null;
  slashSuggestions?: SlashSuggestionState | null;
  pending: PendingState | null;
  working: WorkingState | null;
  theme: TuiTheme;
  renderPreferences: RenderPreferences;
  statusLine?: StatusLineState;
  rows?: number;
  width: number;
};

export type FooterLayout = {
  lines: string[];
  cursorRow: number;
  cursorColumn: number;
  showCursor: boolean;
};

export type ComposerLayout = Omit<FooterLayout, 'showCursor'>;

export type RenderInitialOptions = RenderState & {
  bannerContext: BannerContext;
};

export type AppendRecordOptions = RenderState & {
  record: TranscriptRecord;
};

export type AppendRecordsOptions = RenderState & {
  records: TranscriptRecord[];
};

export type RenderDestructiveOptions = RenderState & {
  bannerContext: BannerContext;
  records: TranscriptRecord[];
};

export type RenderFinalOptions = {
  bannerContext: BannerContext;
  records: TranscriptRecord[];
  theme: TuiTheme;
  renderPreferences: RenderPreferences;
  width: number;
};

export type AppRenderer = {
  appendRecord: (options: AppendRecordOptions) => void;
  appendRecords: (options: AppendRecordsOptions) => void;
  clearFooter: () => void;
  renderDestructive: (options: RenderDestructiveOptions) => void;
  renderFinal: (options: RenderFinalOptions) => void;
  renderFooter: (options: RenderState) => void;
  renderInitial: (options: RenderInitialOptions) => void;
};

export type FooterRenderer = {
  clear: () => void;
  rememberLayout: (layout: FooterLayout) => void;
  render: (options: RenderState) => void;
};

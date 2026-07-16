import type { ComposerState } from './composer';
import type { CommandSurface, CommandSurfaceOption } from './command';
import type { TranscriptRecord } from './transcript';
import type { TuiTheme } from '../config/theme-config';
import type { ContextUsage, ReasoningEffort } from './agent';

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

export type StatusLineActivityState = {
  kind: 'thinking' | 'working';
  elapsedMs: number;
};

export type StatusLineState = {
  projectName: string;
  modelLabel: string;
  reasoningEffort?: ReasoningEffort;
  skillOverride?: boolean;
  mode: StatusLineMode;
  allowAllTools?: boolean;
  contextUsage?: ContextUsage;
  detail?: string;
  activity?: StatusLineActivityState;
  keyHint?: string;
};

export type RenderState = {
  composer: ComposerState;
  commandSurface: CommandSurface | null;
  slashSuggestions?: SlashSuggestionState | null;
  pending: PendingState | null;
  working: WorkingState | null;
  theme: TuiTheme;
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
  rememberLayout?: (layout: FooterLayout) => void;
  render: (options: RenderState) => void;
};

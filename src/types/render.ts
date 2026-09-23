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
  appVersion: string; // echo-tui 自身版本号，来自 package.json，展示在 banner 的运行时信息中。
  terminalSize: TerminalSize;
  mode: string;
  variant?: 'main' | 'btw'; // 选择主启动 banner 或 BTW 紧凑 workspace banner。
  parentActivity?: string; // BTW banner 展示的后台主 turn 有界状态摘要。
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
 * Reasoning 流式状态，仅在完成边界到达前展示可读推理摘要。
 */
export type ReasoningStreamingPendingState = {
  kind: 'reasoning_streaming'; // 表示当前 assistant turn 正在输出可见 reasoning preview。
  text: string; // 当前可读 reasoning 全文草稿。
  historyText?: string; // 仅由 renderer 补充，表示已经移入终端历史区的部分。
};

/**
 * 正文流式输出状态，用于展示模型响应。
 */
export type StreamingPendingState = {
  kind: 'streaming'; // 表示当前 assistant turn 已进入可见流式 preview。
  text: string; // 当前 assistant 正文草稿。
  reasoningText?: string; // 正文开始时仍需先写完的 reasoning 草稿。
  historyText?: string; // 仅由 renderer 补充，表示已经移入终端历史区的正文。
};

/**
 * 工具调用预览状态，用于展示模型调用的工具
 */
export type ToolCallPendingState = {
  kind: 'tool_call';
  toolName: string;
  argumentsText: string;
};

export type PendingToolCall = {
  callId: string; // 当前 assistant turn 内用于关联稳定 result 的 provider call identity。
  toolName: string; // 选择专属 pending renderer 的 provider-neutral 工具名。
  argumentsText: string; // 交给工具 preview renderer 的原始 JSON 参数文本。
};

export type ToolCallsPendingState = {
  kind: 'tool_calls'; // 表示多个只读工具正在同一 assistant turn 内重叠执行。
  calls: PendingToolCall[]; // 按 provider 原始顺序保留的运行中调用快照。
};

/**
 * shell mode 命令运行中的本地投影状态，完成后才会落成 transcript record。
 */
export type ShellOutputPendingState = {
  kind: 'shell_output'; // 表示本地 shell 命令正在运行。
  commandLine: string; // 运行期 echo 的完整命令行文本；与最终 shell record 首行同源（由 app 层生成）。
  output: string; // 已到达的运行期合并输出原始文本（保留 CR 进度语义）。
  historyRawLength?: number; // 仅由 renderer 注入：已确定投影对应的原始输出前缀长度。
};

export type SubagentPendingState = {
  kind: 'subagent'; // 区分主 assistant pending 与隔离子 Agent 活动。
  agentName: string; // 当前内置或自定义子 Agent 的目录名称，渲染前仍需安全格式化。
  argumentsText?: string; // 内部工具参数，供现有工具 preview renderer 生成摘要。
  draft?: string; // reasoning 或 assistant 的瞬时完整草稿。
  elapsedMs: number; // 从当前子运行 start 开始计算的毫秒数。
  phase: 'thinking' | 'reasoning' | 'streaming' | 'tool' | 'waiting_approval' | 'waiting_question'; // 当前活动阶段。
  runId: string; // 当前子运行身份，仅用于本地渲染隔离。
  task: string; // 当前委派任务摘要来源。
  model?: string; // 子运行实际使用的模型名；旧记录缺省时窗口回退主模型显示。
  reasoningEffort?: ReasoningEffort; // 解析 effortPolicy 后实际生效的推理强度。
  toolName?: string; // tool 阶段的内部工具名称。
};

export type SubagentsPendingState = {
  kind: 'subagents'; // 并行子 Agent 群组的 footer 紧凑活动块。
  runs: SubagentPendingState[]; // 按 start 顺序排列的全部活跃并行子运行。
};

export type PendingState = ThinkingPendingState | ReasoningStreamingPendingState | StreamingPendingState | ToolCallPendingState | ToolCallsPendingState | ShellOutputPendingState | SubagentPendingState | SubagentsPendingState;

export type WorkingState = {
  elapsedMs: number;
};

export type SlashSuggestionState = {
  options: CommandSurfaceOption[];
  selectedIndex: number;
};

export type StatusLineMode = 'idle' | 'command' | 'thinking' | 'streaming' | 'tool' | 'plan' | 'shell' | 'shell-local' | 'mcp' | 'btw' | 'subagent_view';

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
  footerInteractionId?: string | null; // 当前 footer 可鼠标交互消费者的稳定身份；省略时所有命中区域仅作布局投影。
  streamingOwner?: string; // 区分主会话与各个 BTW 会话独立的流式显示进度。
  conversationReference?: ConversationReferenceRenderState | null; // composer 上方展示的瞬时历史会话引用卡片。
  pendingMessage?: PendingMessageRenderState | null; // composer 上方展示的单条 transient 待发送消息。
  commandSurface: CommandSurface | null;
  slashSuggestions?: SlashSuggestionState | null;
  viewIndexLines?: string[]; // subagent 会话窗口输入区下方的 run 索引块；命令 surface 浮层激活时保持为空。
  pending: PendingState | null;
  working: WorkingState | null;
  theme: TuiTheme;
  renderPreferences: RenderPreferences;
  statusLine?: StatusLineState;
  rows?: number;
  width: number;
};

export type FooterMouseTarget =
  | {
      kind: 'slash_suggestion'; // 普通 composer 中当前可见 slash 建议项。
      index: number; // 建议在完整匹配列表中的绝对索引。
    }
  | {
      kind: 'choice_option'; // choice card 中当前可见的 option。
      index: number; // option 在调用方完整 option 数组中的绝对索引。
      inlineInput: boolean; // 是否为只聚焦、不直接确认的内联文本输入项。
    }
  | {
      kind: 'choice_tab'; // choice card 顶部的多题导航 tab。
      index: number; // tab 在调用方完整 tab 数组中的绝对索引。
    }
  | {
      kind: 'file_picker_entry'; // file picker 左栏中当前可见的路径 entry。
      index: number; // entry 在当前过滤后列表中的绝对索引。
    }
  | {
      kind: 'command_select_option'; // command select surface 中当前可见的 option。
      index: number; // option 在 command handler 完整候选集合中的绝对索引。
    }
  | {
      kind: 'command_resume_session'; // /resume 左栏中当前可见的会话。
      index: number; // 会话在当前 command session 完整候选集合中的绝对索引。
    }
  | {
      kind: 'command_copy_message'; // /copy 左栏中当前可见的可复制消息。
      index: number; // 消息在当前 command session 完整候选集合中的绝对索引。
    }
  | {
      kind: 'command_diff_file'; // /diff 左栏中当前可见的文件。
      index: number; // 文件在当前 command session 完整候选集合中的绝对索引。
    };

export type FooterHitRegion = {
  interactionId?: string; // 生成本区域的 pointer consumer 身份；缺省区域不得被终端鼠标路由执行。
  owner: 'slash_suggestion' | 'choice' | 'file_picker' | 'command_select' | 'resume' | 'copy' | 'diff'; // 生成该区域的 footer 交互 surface 类别。
  target: FooterMouseTarget; // 命中后交给输入路由的无副作用语义目标。
  rowStart: number; // 相对 footer 的 0-based 起始可见行，含端点。
  rowEnd: number; // 相对 footer 的 0-based 结束可见行，含端点。
  columnStart: number; // 相对终端行的 1-based 起始列，含端点。
  columnEnd: number; // 相对终端行的 1-based 结束列，含端点。
};

export type FooterLayout = {
  lines: string[];
  cursorRow: number;
  cursorColumn: number;
  showCursor: boolean;
  hitRegions?: FooterHitRegion[]; // 当前 frame 可鼠标命中的临时区域；不参与持久化。
};

export type FooterPointerSnapshot = {
  version: number; // footer 实际写入终端后的单调递增 frame 版本。
  cursorRow: number; // 当前终端光标相对 footer 的 0-based 行位置。
  cursorColumn: number; // 当前终端光标相对 footer 的 0-based 列位置。
  hitRegions: FooterHitRegion[]; // 与该 frame 版本绑定的全部可见命中区域。
  originStable: boolean; // 本帧是否仅原位更新且 footer 顶部物理屏幕位置未变。
};

export type ComposerLayout = Omit<FooterLayout, 'showCursor'>;

export type RenderInitialOptions = RenderState & {
  bannerContext: BannerContext;
};

export type RenderRecordsOptions = RenderState & {
  records: TranscriptRecord[];
};

export type RenderDestructiveOptions = RenderState & {
  bannerContext: BannerContext;
  records: TranscriptRecord[];
  skipParallelSubagentFilter?: boolean; // subagent 会话窗口 body 专用：调用方已按 runId 选定记录，跳过主窗口的并行 run 过滤，否则窗口内容会被自己的过滤规则滤空。
};

export type AppRenderer = {
  renderRecords: (options: RenderRecordsOptions) => FooterPointerSnapshot;
  render: (options: RenderState, finalizeRecord?: Extract<TranscriptRecord, {role: 'assistant' | 'reasoning_summary'}>) => FooterPointerSnapshot;
  clearFooter: () => void;
  renderDestructive: (options: RenderDestructiveOptions) => FooterPointerSnapshot;
  renderInitial: (options: RenderInitialOptions) => FooterPointerSnapshot;
};

export type FooterRenderer = {
  append: (content: string, options: RenderState) => FooterPointerSnapshot;
  clear: () => void;
  rememberLayout: (layout: FooterLayout) => FooterPointerSnapshot;
  render: (options: RenderState) => FooterPointerSnapshot;
};

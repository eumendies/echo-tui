import type {DiffFile, DiffSourceInfo} from '../diff';
import type {AgentsCommandSurface} from './agents-surface';
import type {ConfigCommandSurface} from './config-surface';
import type {HooksCommandSurface, MemoryCommandSurface, TasksCommandSurface} from './management-surface';
import type {McpCommandSurface} from './mcp-surface';
import type {SkillsCommandSurface} from './model-skills-surface';
import type {ContextUsageCommandSurface, StatusCommandSurface, UsageCommandSurface} from './status-surface';

export type CommandSurfaceOption = {
  label: string;
  description?: string;
  inlineInput?: {
    placeholder: string;
    text: string;
    cursor: number;
  };
};

export type ChoiceCommandSurfaceOption = CommandSurfaceOption & {
  checked?: boolean;
  selected?: boolean;
};

export type ChoiceCommandSurfaceTab = {
  label: string;
  status?: 'complete' | 'missing' | 'ready' | 'blocked';
};

export type SlashCommandDescriptor = {
  name: string;
  description: string;
  allowDuringAssistantTurn?: boolean; // 指示 active assistant turn 期间是否允许展示并立即启动该命令。
};

export type InfoCommandSurface = {
  kind: 'info';
  title: string;
  lines: string[];
  dismissHint: string;
};

export type SelectCommandSurface = {
  kind: 'select';
  title: string;
  options: CommandSurfaceOption[];
  selectedIndex: number;
  dismissHint: string;
};

export type ResumeCommandSurfaceSession = {
  label: string;
};

export type ResumeCommandSurfacePreviewRecord = {
  role: string;
  text: string;
  createdAt?: string;
};

export type ResumeCommandSurface = {
  kind: 'resume';
  focus: 'list' | 'preview'; // 当前焦点栏，决定上下方向键作用对象。
  title: string; // 面板顶部标题。
  sessions: ResumeCommandSurfaceSession[]; // 完整候选列表，可见窗口由渲染层投影。
  selectedIndex: number; // 选中项在完整候选列表中的绝对索引。
  previewScroll: number; // 右栏预览相对首条渲染行的滚动偏移，上界由渲染层钳制。
  previewStatus: 'loading' | 'ready' | 'error'; // 当前右栏预览的异步生命周期状态。
  previewRecords: ResumeCommandSurfacePreviewRecord[]; // ready 状态下按渲染行折行显示的预览记录。
  previewError?: string; // 预览读取失败时展示的稳定错误文案。
  notice?: string; // 当前浏览器状态的临时中文说明，例如当前会话删除保护提示。
  emptyPreviewHint: string; // 预览无记录时的占位文案。
  dismissHint: string; // 面板底部键位提示。
};

export type ScaleCommandSurface = {
  kind: 'scale';
  title: string;
  leftLabel: string;
  rightLabel: string;
  options: CommandSurfaceOption[];
  selectedIndex: number;
  dismissHint: string;
};

export type ChoiceCommandSurface = {
  kind: 'choice';
  title: string;
  message?: string;
  messageTitle?: string;
  messageStyle?: 'text' | 'code';
  optionsTitle: string;
  options: ChoiceCommandSurfaceOption[];
  focusedIndex: number;
  selectionMode?: 'single' | 'multiple';
  tabs?: ChoiceCommandSurfaceTab[];
  activeTabIndex?: number;
  dismissHint: string;
};

export type ConfirmCommandSurface = {
  kind: 'confirm';
  title: string;
  bodyLines: string[];
  confirmLabel: string;
  cancelLabel: string;
};

export type CopyableMessageRole = 'user' | 'assistant';

export type CopyableMessageRecord = {
  createdAt?: string;
  id: string;
  role: CopyableMessageRole;
  text: string;
};

export type CopySurfaceMessage = CopyableMessageRecord & {
  selected: boolean;
};

export type CopyCommandSurface = {
  dismissHint: string;
  focus: 'list' | 'preview';
  kind: 'copy';
  messages: CopySurfaceMessage[];
  notice?: string;
  previewScroll: number;
  selectedIds: string[];
  selectedIndex: number;
  title: string;
};

export type FilePickerSurfaceEntry = {
  kind: 'directory' | 'text' | 'pdf' | 'image' | 'unsupported';
  name: string;
  path: string;
  selectable: boolean;
  selected: boolean;
};

export type FilePickerCommandSurface = {
  kind: 'file_picker';
  currentDir: string;
  dismissHint: string;
  entries: FilePickerSurfaceEntry[];
  focus: 'list' | 'preview';
  notice?: string;
  previewLines: string[];
  previewScroll: number; // 文本预览正文在换行后物理行中的滚动偏移，标题保持固定。
  previewMode?: 'code' | 'text';
  query: string;
  selectedIndex: number;
  selectedPaths: string[];
  title: string;
};

export type DiffCommandSurface = {
  detailScroll: number;
  files: DiffFile[];
  focus: 'list' | 'detail';
  kind: 'diff';
  notices?: string[];
  selectedIndex: number;
  source: DiffSourceInfo;
  title: string;
};

export type BtwCommandSurface = {
  kind: 'btw'; // 标识 command session 当前拥有 BTW 全视图输入。
  title: string; // BTW command runtime 的可读标题，仅用于兜底 surface。
  dismissHint: string; // BTW surface 意外直接渲染时的退出提示。
};

/** footer 可渲染的全部 command surface；新增命令只需追加一个成员。 */
export type CommandSurface = InfoCommandSurface | SelectCommandSurface | ResumeCommandSurface | SkillsCommandSurface | McpCommandSurface | MemoryCommandSurface | HooksCommandSurface | AgentsCommandSurface | TasksCommandSurface | ScaleCommandSurface | ChoiceCommandSurface | ConfirmCommandSurface | ConfigCommandSurface | ContextUsageCommandSurface | UsageCommandSurface | StatusCommandSurface | CopyCommandSurface | FilePickerCommandSurface | DiffCommandSurface | BtwCommandSurface;

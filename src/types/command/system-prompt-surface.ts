import type {SystemPromptFileFact, SystemPromptSourceKind, SystemPromptTarget} from '../agent';
import type {ComposerState} from '../composer';

export type SystemPromptSurfaceMode = 'confirmReset' | 'confirmSave' | 'edit' | 'menu' | 'read';

export type SystemPromptMenuRowId = 'back' | 'deleteGlobal' | 'deleteProject' | 'editGlobal' | 'editProject' | 'view';

export type SystemPromptMenuRow = {
  available: boolean; // false 表示该动作当前不可执行（目标文件不存在），行仍可见可聚焦。
  id: SystemPromptMenuRowId; // 固定按钮标识，handler 与 renderer 共用。
};

export type SystemPromptSummary = {
  kind: SystemPromptSourceKind | 'unknown'; // unknown 表示快照读取失败，无法判断来源。
};

export type SystemPromptDynamicSection = {
  detail: string; // 该段的来源摘要，例如文件数量或条目数。
  estimatedTokens?: number; // 估算 token；无法估算时省略。
  label: string; // 段名，例如 Runtime environment。
};

export type SystemPromptConfigState = {
  baseContent: string; // 当前生效基础文本；阅读态直接投影，编辑态作为兜底预填。
  confirmIndex: number; // 确认态二选一焦点：0 执行，1 取消。
  draft?: ComposerState; // 编辑态草稿；其它状态省略。
  dynamicSections: SystemPromptDynamicSection[]; // 运行时拼装的动态段摘要，不可在此编辑。
  error?: string; // 最近一次操作的错误；下一次操作清除。
  feedback?: string; // 最近一次成功操作的提示。
  global: SystemPromptFileFact; // 用户级 ~/.echo/SYSTEM.md 的事实快照。
  menuRows: SystemPromptMenuRow[]; // menu 按钮及其可用性，由 handler 随快照计算。
  mode: SystemPromptSurfaceMode; // 当前视图的状态机阶段。
  pendingFallback?: string; // 删除确认态展示的回落目标，由 handler 预先计算。
  pendingOverwrites: boolean; // 待写入是否覆盖已存在文件；保存确认态展示。
  project: SystemPromptFileFact; // 项目根 SYSTEM.md 的事实快照。
  readScroll: number; // 阅读态首行在正文中的绝对行偏移。
  selectedIndex: number; // menu 态按钮焦点索引。
  sourceKind: SystemPromptSourceKind; // 当前生效来源：project、global 或 builtin。
  target: SystemPromptTarget; // 写入目标；menu 态保留上次选择但不参与渲染。
};

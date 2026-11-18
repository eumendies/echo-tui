import type {BackgroundTaskView} from '../background-task';
import type {LifecycleHookDraftEntry, LifecycleHookEventName, LifecycleHookTestResult} from '../hooks';
import type {AgentMemoryScope} from '../memory';

export type MemoryCommandSurfaceMode = 'list' | 'edit' | 'deleteConfirm';

// 层级由 section 表达；list 与 detail 在渲染层同构，都是可聚焦行列表，Esc 据此逐级返回。
export type MemoryCommandSection =
  | 'types' // 一级类型选择：user memory / agent global / agent project。
  | 'user-list' // user memory 列表。
  | 'user-detail' // 单条 user memory 详情。
  | 'catalog-list' // agent catalog 列表。
  | 'catalog-detail' // catalog 详情：元信息、启停、item 列表与 catalog 动作。
  | 'item-detail'; // 单条 agent item 详情。

// 行角色决定 Enter 语义，避免同层出现“查看/编辑”两种隐含行为。
export type MemoryCommandRowKind = 'entry' | 'action' | 'toggle' | 'field' | 'option';

export type MemoryCommandRow = {
  id: string; // 稳定行标识；handler 按 `entry:`、`action:`、`toggle:`、`option:` 前缀分派动作。
  kind: MemoryCommandRowKind; // 行角色：条目、动作、开关、只读字段或确认选项。
  label: string; // 行主文本，条目行为内容预览或名称，动作行为动作名。
  value?: string; // 行右侧值：条目为描述/计数，开关为当前状态，字段为字段值。
  detail?: string; // 动作行的次要提示，渲染为右侧弱化说明。
  dot?: 'on' | 'off'; // 条目的 enabled 状态圆点；无状态语义的行缺省。
  tone?: 'danger'; // 破坏性动作的危险色语气，不改变 Enter 行为。
};

export type MemoryItemCounts = {
  user: number;
  global: number;
  project: number;
};

export type MemoryCatalogForm = {
  fields: {label: string; text: string; cursor: number}[];
  selectedIndex: number;
};

export type MemoryCommandSurface = {
  kind: 'memory'; // footer 独立 surface 分派标识。
  title: string; // 当前层级标题。
  mode: MemoryCommandSurfaceMode; // 行列表、编辑或删除确认；只有后两者是模态。
  section: MemoryCommandSection; // 当前层级，决定行集合与 Esc 返回目标。
  scope?: AgentMemoryScope['kind']; // agent 层级的 global/project 范围。
  rows: MemoryCommandRow[]; // handler 与 renderer 共用的行投影；deleteConfirm 时是确认行。
  selectedIndex: number; // 当前行在 rows 中的焦点索引，已钳制。
  detailContent?: string; // 详情层正文原文，按宽度折行由渲染层完成。
  itemCounts?: MemoryItemCounts; // 一级类型的条目统计，包含 disabled 条目。
  catalogForm?: MemoryCatalogForm; // catalog 新建/编辑的多字段表单状态。
  editText?: string; // 普通编辑器的可见文本。
  editCursor?: number; // 普通编辑器的 grapheme 光标位置。
  error?: string; // 最近一次校验或持久化失败的中文说明。
  dismissHint: string; // 当前层级可用键位的提示。
};

export type HooksCommandSurfaceMode = 'events' | 'entries' | 'entryDetail';

export type HooksCommandEditTarget = 'command' | 'timeoutMs';

export type HooksCommandSurfaceTest = {
  command: string;
  entryIndex: number;
  event: LifecycleHookEventName;
  result?: LifecycleHookTestResult;
  status: 'running' | 'completed';
};

export type HooksCommandSurface = {
  commandScroll?: number;
  diagnostics?: string[];
  dismissHint: string;
  editBuffer?: string;
  editCursor?: number;
  editTarget?: HooksCommandEditTarget;
  detailIndex?: number;
  entries: LifecycleHookDraftEntry[];
  entryIndex: number;
  error?: string;
  eventIndex: number;
  events: Array<{
    count: number;
    event: LifecycleHookEventName;
  }>;
  kind: 'hooks';
  mode: HooksCommandSurfaceMode;
  selectedEvent: LifecycleHookEventName;
  test?: HooksCommandSurfaceTest;
  title: string;
};

export type TasksCommandSurfaceMode = 'list' | 'detail' | 'confirmStop';

export type TasksCommandSurface = {
  kind: 'tasks'; // footer 独立 surface 分派标识。
  title: string; // 当前层级标题,含可见任务数。
  mode: TasksCommandSurfaceMode; // 列表、详情或停止确认。
  tasks: BackgroundTaskView[]; // 进入或刷新时取得的快照,不随运行态自动更新。
  selectedIndex: number; // 列表焦点在快照中的绝对索引。
  logLines?: string[]; // 详情层展示的有界日志尾部。
  logTruncated?: boolean; // 日志尾部被预算截断,不是完整输出。
  logUnavailable?: string; // 日志不可读取时的中文原因。
  error?: string; // 停止等操作失败的中文说明。
  dismissHint: string; // 当前层级的键位提示。
};

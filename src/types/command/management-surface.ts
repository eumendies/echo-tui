import type {BackgroundTaskView} from '../background-task';
import type {LifecycleHookDraftEntry, LifecycleHookEventName, LifecycleHookTestResult} from '../hooks';
import type {AgentMemoryCatalog, AgentMemoryItem, AgentMemoryScope, UserMemory} from '../memory';

export type MemoryCommandSurfaceMode = 'list' | 'edit' | 'deleteConfirm';

export type MemoryCommandSection = 'types' | 'user' | 'catalogs' | 'items';

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
  kind: 'memory';
  title: string;
  mode: MemoryCommandSurfaceMode;
  section?: MemoryCommandSection;
  scope?: AgentMemoryScope['kind'];
  memories: UserMemory[];
  catalogs?: AgentMemoryCatalog[];
  agentItems?: AgentMemoryItem[];
  selectedCatalog?: AgentMemoryCatalog;
  itemCounts?: MemoryItemCounts;
  catalogForm?: MemoryCatalogForm;
  selectedIndex: number;
  editText?: string;
  editCursor?: number;
  error?: string;
  dismissHint: string;
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

import type {McpPromptArgument} from '../mcp';

export type McpSurfaceView = 'overview' | 'server' | 'entries' | 'entryDetail' | 'inventory' | 'discardConfirm' | 'deleteConfirm' | 'error';

export type McpInventorySection = 'tools' | 'resources' | 'templates' | 'prompts';

export type McpCommandRowTone = 'normal' | 'muted' | 'warning' | 'success';

export type McpCommandRow = {
  id: string; // 稳定行 id；handler 用它定位动作，渲染只做投影。
  kind: 'global' | 'server' | 'field' | 'inventory' | 'entries' | 'action' | 'entry' | 'option';
  label: string; // 行主文本。
  value?: string; // 行右侧值（密钥已掩码）。
  detail?: string; // 次级说明：普通行渲染为缩进备注，动作/清单行渲染为右侧提示。
  tone?: McpCommandRowTone; // 行强调色语义。
  disabled?: boolean; // 条目不可用（例如未初始化 server 的清单入口）。
  dot?: 'on' | 'off'; // 行首开关圆点：on 为绿色实心，off 为暗色空心。
  masked?: boolean; // 输入行是否为密钥值：缓冲按 • 掩码显示。
  input?: {text: string; cursor: number; placeholder?: string}; // 内联编辑缓冲。
};

export type CommandMcpServerFacts = {
  initialized: boolean; // server 是否初始化成功；false 时清单不可用。
  capabilities: {tools: boolean; resources: boolean; prompts: boolean}; // server 声明的能力。
  toolCount: number;
  readOnlyToolCount: number;
  resourceCount: number;
  resourceTemplateCount: number;
  promptCount: number;
  diagnostics: string[]; // 该 server 的配置与运行诊断摘要。
};

export type CommandMcpInventoryItem = {
  label: string; // 主展示文本（工具名、uri、命令名）。
  detail?: string; // 次级信息（只读标记、mime、参数签名、描述）。
};

export type McpCommandSurface = {
  kind: 'mcp';
  view: McpSurfaceView; // 当前面板视图，决定行语义与键位。
  title: string;
  rows: McpCommandRow[]; // handler 与渲染共享的行投影结果。
  selectedIndex: number;
  facts?: CommandMcpServerFacts; // server 视图附带的运行事实快照。
  emptyLines?: string[]; // 总览无 server 时的空状态说明。
  feedback?: string; // 最近一次成功的提示（例如保存完成）。
  error?: string; // 当前视图的错误提示。
  dirty: boolean; // 草稿是否存在未保存改动。
  dismissHint: string;
};

export type CommandMcpServerInfo = {
  name: string;
  enabled: boolean;
  valid: boolean;
  summary: string;
  kind: 'global' | 'server';
  transport?: 'stdio' | 'http';
  diagnostic?: string;
  toolCount?: number;
  resourceCount?: number;
  promptCount?: number;
};

export type CommandMcpPromptInfo = {
  serverName: string; // prompt 所属的 server 名。
  promptName: string; // server 侧 prompt 名称。
  commandName: string; // 归一后的命令名 `<server>:<prompt>`，供匹配与补全共用。
  description?: string; // 可选描述，用于命令建议。
  arguments: McpPromptArgument[]; // 按 server 声明顺序排列的参数，供解析与缺失收集。
};

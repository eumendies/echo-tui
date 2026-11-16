import type {SandboxMode} from '../../sandbox/types';
import type {AgentInstructionFileName, AgentType, ContextUsage} from '../agent';
import type {CompactionState, TodoState} from '../transcript';
import type {UsageDailyAggregate, UsageModelAggregate} from '../usage';

export type ContextUsageCommandSurface = {
  kind: 'context';
  title: string;
  usage: ContextUsage;
  dismissHint: string;
};

export type UsageCommandSurface = {
  dailyUsage: UsageDailyAggregate[]; // 全部按日聚合数据；日期列表与当日明细共享其选中日期上下文。
  dismissHint: string; // 当前视图对应的中文键位提示。
  kind: 'usage'; // footer command surface 的稳定分派标识。
  modelUsage: UsageModelAggregate[]; // 选中日期内 provider/模型组合的聚合；按日视图为空。
  offset: number; // 当前视图可见窗口在完整日期或当日模型列表中的起始索引。
  selectedIndex: number; // 当前选中日期在 dailyUsage 中的绝对索引；模型明细中仅保留该上下文。
  title: string; // 当前视图显示的面板标题。
  view: 'daily' | 'dayModels'; // 可选择的按日列表或选中日期的模型明细。
};

export type StatusCommandPage = 'overview' | 'compaction' | 'todos';

export type CommandStatusSandboxState = {
  mode: SandboxMode; // 归一化后的生效档位;plan interaction mode 派生的只读收紧也反映在这里。
  network: boolean; // 沙箱生效后的实际网络状态;read-only 恒为 false,与配置原值无关。
  provider: string | null; // 沙箱实现标识;平台不支持时为 null。
  available: boolean; // 沙箱在当前环境是否实际生效。
  unavailableReason?: string; // 配置生效但沙箱不可用时的降级原因;available 时缺省。
};

export type CommandStatusSnapshot = {
  agentInstructionFileName: AgentInstructionFileName;
  agentInstructions: Array<{
    filePath: string;
    label: string;
    sourceKind: 'global' | 'project';
  }>;
  agentMemoryCatalogs: Array<{
    name: string;
    scope: 'global' | 'project';
  }>;
  cwd: string;
  diagnostics: string[];
  model: {
    agentType: AgentType;
    model: string;
    provider: string;
  } | null;
  sandbox: CommandStatusSandboxState;
  sessionId: string | null;
  userMemoryCount: number;
  compaction: CompactionState | null; // 打开或刷新 status 时复制的当前生效压缩摘要；无压缩时为 null。
  todoState: TodoState; // 打开或刷新 status 时复制的当前会话结构化待办状态。
};

export type CommandCodexUsageWindow = {
  resetAt: number;
  usedPercent: number;
};

export type CommandCodexUsageResult =
  | {
      status: 'available';
      primary: CommandCodexUsageWindow;
      secondary?: CommandCodexUsageWindow;
    }
  | {status: 'not_applicable'}
  | {status: 'unavailable'; error: string};

export type StatusCommandUsageState = CommandCodexUsageResult | {status: 'loading'};

export type CommandDeepseekBalanceInfo = {
  currency: string; // 币种代码，如 CNY / USD。
  grantedBalance: string; // 赠送余额。
  totalBalance: string; // 账户总余额。
  toppedUpBalance: string; // 充值余额。
};

export type CommandDeepseekBalanceResult =
  | {
      status: 'available';
      isAvailable: boolean; // 余额是否足以继续调用 API。
      balanceInfos: CommandDeepseekBalanceInfo[];
    }
  | {status: 'not_applicable'}
  | {status: 'unavailable'; error: string};

export type StatusCommandDeepseekBalanceState = CommandDeepseekBalanceResult | {status: 'loading'};

export type CommandOpencodeUsageWindow = {
  name: string; // 窗口键名:rolling/weekly/monthly,未知键原样展示。
  status: string; // 窗口状态原文,展示层不做枚举假设。
  percent: number; // 已用百分比,规范到 0–100。
  resetsAtMs: number; // 重置时间点毫秒值。
};

export type CommandOpencodeUsageResult =
  | {
      status: 'available';
      windows: CommandOpencodeUsageWindow[];
    }
  | {status: 'not_applicable'}
  | {status: 'unavailable'; error: string};

export type StatusCommandOpencodeUsageState = CommandOpencodeUsageResult | {status: 'loading'};

export type StatusCommandSurface = {
  compactionScroll: number; // 压缩摘要正文的视觉行偏移；渲染时再按实际行数钳制。
  deepseekBalance: StatusCommandDeepseekBalanceState;
  dismissHint: string;
  kind: 'status';
  opencodeUsage: StatusCommandOpencodeUsageState;
  page: StatusCommandPage; // 当前显示的 status 页面，概览页保留运行信息和账户用量。
  snapshot: CommandStatusSnapshot;
  title: string;
  todoScroll: number; // Todo 正文的视觉行偏移；渲染时再按实际行数钳制。
  usage: StatusCommandUsageState;
};

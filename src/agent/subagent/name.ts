const MAX_SUBAGENT_NAME_CODE_POINTS = 64;
const SUBAGENT_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const BUILTIN_SUBAGENT_NAMES = Object.freeze(['explorer', 'worker'] as const);

type BuiltinSubagentName = typeof BUILTIN_SUBAGENT_NAMES[number];
type SubagentTerminalStatus = 'completed' | 'failed' | 'cancelled';

/** 校验可用于 schema、文件名和 transcript 身份的稳定小写名称。 */
function isValidSubagentName(value: unknown): value is string {
  return typeof value === 'string'
    && Array.from(value).length <= MAX_SUBAGENT_NAME_CODE_POINTS
    && SUBAGENT_NAME_PATTERN.test(value);
}

/** 识别拥有固定产品身份和文案的内置子 Agent。 */
function isBuiltinSubagentName(value: unknown): value is BuiltinSubagentName {
  return value === 'explorer' || value === 'worker';
}

/** 把合法动态名称转换为无控制字符的短显示标签；不可信值使用通用身份。 */
function formatSubagentDisplayName(value: unknown): string {
  if (value === 'explorer') {
    return 'Explorer';
  }
  if (value === 'worker') {
    return 'Worker';
  }
  if (!isValidSubagentName(value)) {
    return 'Subagent';
  }

  const words = value.split(/[-_]+/u).filter(Boolean);
  const label = words.join(' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** 保留合法目录名称的原始拼写供 rail 和状态详情展示；不可信值使用通用身份。 */
function formatSubagentRawName(value: unknown): string {
  return isValidSubagentName(value) ? value : 'Subagent';
}

/** 生成终态短文案，同时保留 Explorer 和 Worker 的既有专属身份。 */
function formatSubagentTerminalIdentity(value: unknown, status: SubagentTerminalStatus): string {
  const label = formatSubagentDisplayName(value);
  if (status === 'completed' && value === 'explorer') {
    return `${label} · returned report`;
  }
  if (status === 'completed' && value === 'worker') {
    return `${label} · completed task`;
  }
  return `${label} · ${status}`;
}

export {
  BUILTIN_SUBAGENT_NAMES,
  MAX_SUBAGENT_NAME_CODE_POINTS,
  SUBAGENT_NAME_PATTERN,
  formatSubagentDisplayName,
  formatSubagentRawName,
  formatSubagentTerminalIdentity,
  isBuiltinSubagentName,
  isValidSubagentName
};

export type {BuiltinSubagentName, SubagentTerminalStatus};

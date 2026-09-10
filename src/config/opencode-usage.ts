import {redactSensitiveText} from '../agent/agent-errors';

const OPENCODE_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const OPENCODE_API_HOST = 'opencode.ai';
const OPENCODE_GO_PATH_PREFIX = '/zen/go/';

// 上游 usage 对象按窗口名分键;归一化顺序固定为 5 小时/每周/每月,未知键排在其后。
const OPENCODE_WINDOW_ORDER = ['rolling', 'weekly', 'monthly'];

type OpencodeUsageWindow = {
  name: string; // 窗口键名:rolling/weekly/monthly,未知键原样保留。
  status: string; // 上游窗口状态原文,展示层不做枚举假设。
  percent: number; // 已用百分比,规范到 0–100。
  resetsAtMs: number; // 重置时间点毫秒值,由 ISO 字符串解析。
};

type OpencodeUsage = {
  windows: OpencodeUsageWindow[];
};

type OpencodeUsageDependencies = {
  fetch?: typeof fetch;
  usageUrl?: string;
};

class OpencodeUsageError extends Error {
  constructor(message: string) {
    super(redactSensitiveText(message));
    this.name = 'OpencodeUsageError';
  }
}

/**
 * 查询 OpenCode Go 订阅配额;apiKey 只用于 Authorization 头,任何错误信息先脱敏再抛出。
 */
async function queryOpencodeUsage(apiKey: string, dependencies: OpencodeUsageDependencies = {}): Promise<OpencodeUsage> {
  const requestFetch = dependencies.fetch || fetch;
  let response: Response;

  try {
    response = await requestFetch(dependencies.usageUrl || OPENCODE_USAGE_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'echo-tui/1.0'
      }
    });
  } catch (error: unknown) {
    throw new OpencodeUsageError(`OpenCode Go 用量请求失败:${formatError(error)}`);
  }

  if (!response.ok) {
    throw new OpencodeUsageError(`OpenCode Go 用量请求失败:HTTP ${response.status}`);
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new OpencodeUsageError('OpenCode Go 用量响应不是有效 JSON');
  }

  return parseOpencodeUsageResponse(payload);
}

/**
 * 校验 OpenCode Go usage 响应;真实结构为 usage.{rolling,weekly,monthly} 键控对象,
 * 每窗口含 status/percent/resetsAt;归一化为固定顺序窗口数组,未知键排在已知键之后。
 */
function parseOpencodeUsageResponse(payload: unknown): OpencodeUsage {
  if (!isRecord(payload)) {
    throw new OpencodeUsageError('OpenCode Go 用量响应根节点必须是对象');
  }

  const usage = isRecord(payload.usage) ? payload.usage : undefined;

  if (!usage) {
    throw new OpencodeUsageError(`OpenCode Go 用量响应缺少 usage 对象(实际键:${formatKeys(payload)})`);
  }

  const names = [
    ...OPENCODE_WINDOW_ORDER.filter((name) => name in usage),
    ...Object.keys(usage).filter((name) => !OPENCODE_WINDOW_ORDER.includes(name))
  ];

  return {
    windows: names.map((name) => parseUsageWindow(name, usage[name]))
  };
}

function parseUsageWindow(name: string, value: unknown): OpencodeUsageWindow {
  const entry = isRecord(value) ? value : undefined;
  const status = readString(entry, 'status');
  const percent = readFiniteNumber(entry, 'percent');
  const resetsAtMs = readResetAtMs(entry);

  if (!status || percent === undefined || resetsAtMs === undefined) {
    throw new OpencodeUsageError(`OpenCode Go 用量响应的 usage.${name} 字段不完整(实际键:${formatKeys(entry)})`);
  }

  return {
    name,
    status,
    percent: clampPercent(percent),
    resetsAtMs
  };
}

/**
 * 判断 baseURL 是否指向 OpenCode Go 服务;命中时才展示用量查询,覆盖全部三个 opencode-go 预设。
 */
function isOpencodeGoBaseUrl(baseURL: string | undefined): boolean {
  if (!baseURL) {
    return false;
  }

  try {
    const url = new URL(baseURL);
    return url.hostname === OPENCODE_API_HOST && url.pathname.startsWith(OPENCODE_GO_PATH_PREFIX);
  } catch {
    return false;
  }
}

function readResetAtMs(source: Record<string, unknown> | undefined): number | undefined {
  const value = source?.resetsAt;
  if (typeof value !== 'string') {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function formatError(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : '未知错误';
}

function readString(source: Record<string, unknown> | undefined, fieldName: string): string | undefined {
  const value = source?.[fieldName];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function readFiniteNumber(source: Record<string, unknown> | undefined, fieldName: string): number | undefined {
  const value = source?.[fieldName];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 解析失败时把实际收到的键名带进错误,联调时可直接在 /status 上看到真实结构;键名不涉密,脱敏后原样输出。 */
function formatKeys(source: Record<string, unknown> | undefined): string {
  const keys = source ? Object.keys(source) : [];
  return keys.length > 0 ? keys.join(', ') : '无';
}

export {
  OPENCODE_USAGE_URL,
  OpencodeUsageError,
  isOpencodeGoBaseUrl,
  parseOpencodeUsageResponse,
  queryOpencodeUsage
};

export type {
  OpencodeUsage,
  OpencodeUsageDependencies,
  OpencodeUsageWindow
};

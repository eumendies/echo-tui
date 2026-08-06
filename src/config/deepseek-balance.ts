import {redactSensitiveText} from '../agent/agent-errors';

const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance';
const DEEPSEEK_API_HOST = 'api.deepseek.com';

type DeepseekBalanceInfo = {
  currency: string; // 币种代码，如 CNY / USD。
  grantedBalance: string; // 赠送余额，保持 API 返回的字符串原样，避免精度损失。
  totalBalance: string; // 账户总余额。
  toppedUpBalance: string; // 充值余额。
};

type DeepseekBalance = {
  isAvailable: boolean; // 余额是否足以继续调用 API。
  balanceInfos: DeepseekBalanceInfo[];
};

type DeepseekBalanceDependencies = {
  balanceUrl?: string;
  fetch?: typeof fetch;
};

class DeepseekBalanceError extends Error {
  constructor(message: string) {
    super(redactSensitiveText(message));
    this.name = 'DeepseekBalanceError';
  }
}

/**
 * 查询 DeepSeek 账户余额；apiKey 只用于 Authorization 头，任何错误信息先脱敏再抛出。
 */
async function queryDeepseekBalance(apiKey: string, dependencies: DeepseekBalanceDependencies = {}): Promise<DeepseekBalance> {
  const requestFetch = dependencies.fetch || fetch;
  let response: Response;

  try {
    response = await requestFetch(dependencies.balanceUrl || DEEPSEEK_BALANCE_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
  } catch (error: unknown) {
    throw new DeepseekBalanceError(`DeepSeek 余额请求失败：${formatError(error)}`);
  }

  if (!response.ok) {
    throw new DeepseekBalanceError(`DeepSeek 余额请求失败：HTTP ${response.status}`);
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new DeepseekBalanceError('DeepSeek 余额响应不是有效 JSON');
  }

  return parseDeepseekBalanceResponse(payload);
}

/**
 * 校验 DeepSeek balance 响应结构；金额字段是字符串，逐项检查避免把非法数据带到 UI。
 */
function parseDeepseekBalanceResponse(payload: unknown): DeepseekBalance {
  if (!isRecord(payload)) {
    throw new DeepseekBalanceError('DeepSeek 余额响应根节点必须是对象');
  }

  if (typeof payload.is_available !== 'boolean') {
    throw new DeepseekBalanceError('DeepSeek 余额响应缺少 is_available');
  }

  if (!Array.isArray(payload.balance_infos)) {
    throw new DeepseekBalanceError('DeepSeek 余额响应缺少 balance_infos');
  }

  return {
    isAvailable: payload.is_available,
    balanceInfos: payload.balance_infos.map((entry, index) => parseBalanceInfo(entry, index))
  };
}

function parseBalanceInfo(value: unknown, index: number): DeepseekBalanceInfo {
  const entry = isRecord(value) ? value : undefined;
  const currency = readString(entry, 'currency');
  const totalBalance = readString(entry, 'total_balance');
  const grantedBalance = readString(entry, 'granted_balance');
  const toppedUpBalance = readString(entry, 'topped_up_balance');

  if (!currency || !totalBalance || !grantedBalance || !toppedUpBalance) {
    throw new DeepseekBalanceError(`DeepSeek 余额响应的 balance_infos[${index}] 字段不完整`);
  }

  return {
    currency,
    totalBalance,
    grantedBalance,
    toppedUpBalance
  };
}

/**
 * 判断 baseURL 是否指向 DeepSeek 官方 API；命中时才展示余额查询。
 */
function isDeepseekBaseUrl(baseURL: string | undefined): boolean {
  if (!baseURL) {
    return false;
  }

  try {
    return new URL(baseURL).hostname === DEEPSEEK_API_HOST;
  } catch {
    return false;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : '未知错误';
}

function readString(source: Record<string, unknown> | undefined, fieldName: string): string | undefined {
  const value = source?.[fieldName];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export {
  DEEPSEEK_BALANCE_URL,
  DeepseekBalanceError,
  isDeepseekBaseUrl,
  parseDeepseekBalanceResponse,
  queryDeepseekBalance
};

export type {
  DeepseekBalance,
  DeepseekBalanceDependencies,
  DeepseekBalanceInfo
};

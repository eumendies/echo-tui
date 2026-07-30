import type {ReasoningEffort} from './agent';

export type SessionModelSettings = {
  schemaVersion: 1; // Sidecar 数据结构版本，读取时只接受当前支持版本。
  sessionId: string; // 与同目录 JSONL journal 一一对应的持久化会话标识。
  modelProfileId: string; // 当前会话选择的用户级 model profile 标识，不复制 profile 定义。
  reasoningEffortOverride?: ReasoningEffort; // 当前会话显式 effort；缺失时继承所选 profile 默认值。
  updatedAt: string; // 当前值最后一次成功原子保存的 ISO 时间。
};

export type SessionModelSettingsInput = {
  sessionId: string; // 即将创建或已经存在的 journal session 标识。
  modelProfileId: string; // 本次需要保存的当前 model profile 标识。
  reasoningEffortOverride?: ReasoningEffort; // 本次需要保存的显式 effort，缺失表示清除 override。
};

export type SessionModelSettingsReadResult =
  | {kind: 'found'; settings: SessionModelSettings} // Sidecar 完整有效且 sessionId 与请求一致。
  | {kind: 'missing'} // Sidecar 不存在，通常表示旧 session 尚未生成 settings。
  | {kind: 'invalid'}; // Sidecar 不可读、损坏、版本不支持或身份不匹配。

export type SessionModelSettingsStore = {
  getFilePath: (cwd: string, sessionId: string) => string; // 返回当前 cwd/session 对应 sidecar 的绝对路径。
  read: (cwd: string, sessionId: string) => SessionModelSettingsReadResult; // 容错读取当前 settings，不向恢复路径抛出解析错误。
  write: (cwd: string, input: SessionModelSettingsInput, updatedAt?: string) => SessionModelSettings; // 原子覆盖并返回规范化后的当前值。
};

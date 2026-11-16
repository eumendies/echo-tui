export type SessionApprovals = {
  schemaVersion: 1; // Sidecar 数据结构版本；读取时只接受当前支持版本。
  sessionId: string; // 与同目录 JSONL journal 一一对应的持久化会话标识。
  updatedAt: string; // 最后一次成功保存的 ISO 时间，仅用于人工排查，不参与读取校验。
  allowAll: boolean; // 该会话内是否已放开全部需审批工具。
  tools: string[]; // 已允许的非 bash 工具完整名称，按用户批准顺序去重。
  bashCommands: string[]; // 已允许的 bash 命令精确文本，按用户批准顺序去重。
};

export type SessionApprovalsInput = {
  sessionId: string; // 即将写入授权的已落盘会话标识。
  allowAll: boolean; // 本次需要保存的全部授权状态。
  tools: string[]; // 本次需要保存的工具名集合，写入时归一化去重。
  bashCommands: string[]; // 本次需要保存的命令文本集合，写入时归一化去重。
};

export type SessionApprovalsReadResult =
  | {kind: 'found'; approvals: SessionApprovals} // Sidecar 完整有效且 sessionId 与请求一致。
  | {kind: 'missing'} // Sidecar 不存在，表示该会话尚未产生任何持久授权。
  | {kind: 'invalid'}; // Sidecar 不可读、损坏、版本不支持或身份不匹配；调用方必须按空授权处理。

export type SessionApprovalsStore = {
  getFilePath: (cwd: string, sessionId: string) => string; // 返回当前 cwd/session 对应 sidecar 的绝对路径。
  read: (cwd: string, sessionId: string) => SessionApprovalsReadResult; // 容错读取授权；不向调用方抛出解析错误。
  write: (cwd: string, input: SessionApprovalsInput, updatedAt?: string) => SessionApprovals | null; // 原子覆盖授权；空授权降级为删除并返回 null。
  remove: (cwd: string, sessionId: string) => void; // 删除 sidecar；缺失文件视为已清理，其他失败向上抛出。
};

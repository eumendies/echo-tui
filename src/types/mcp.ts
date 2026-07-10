export type McpApprovalMode = 'always' | 'never';

export type McpBaseServerConfig = {
  name: string;
  enabled: boolean;
  timeoutMs: number;
  approval: McpApprovalMode;
};

export type McpStdioServerConfig = McpBaseServerConfig & {
  transport: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type McpHttpServerConfig = McpBaseServerConfig & {
  transport: 'http';
  url: string;
  headers?: Record<string, string>;
};

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export type McpConfigDiagnostic = {
  serverName: string;
  message: string;
};

export type McpConfig = {
  enabled: boolean;
  servers: McpServerConfig[];
  diagnostics: McpConfigDiagnostic[];
};

export type McpServerConfigDraft = {
  name: string;
  enabled: boolean;
  valid: boolean;
  summary: string;
  transport?: 'stdio' | 'http';
  diagnostic?: string;
};

export type McpConfigDraft = {
  enabled: boolean;
  servers: McpServerConfigDraft[];
};

export type McpServerEnabledState = {
  name: string;
  enabled: boolean;
};

export type McpEnabledStateDraft = {
  enabled: boolean;
  servers: McpServerEnabledState[];
};

export type McpBootstrapDiagnostic = {
  serverName: string;
  message: string;
};

export type McpToolReference = {
  serverName: string;
  toolName: string;
  namespacedName: string;
  approval: McpApprovalMode;
};

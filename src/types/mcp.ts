export type McpBaseServerConfig = {
  name: string;
  enabled: boolean;
  timeoutMs: number;
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
  readOnly: boolean; // server 通过 ToolAnnotations.readOnlyHint 声明的只读 hint，缺失按 false 归一。
};

export type McpResourceReference = {
  serverName: string; // 资源所属的 server 名，读取时用于定位连接。
  uri: string; // server 暴露的稳定资源标识，读取时原样回传，不做长度截断。
  name: string; // server 指定的资源名称。
  title?: string; // 可选展示标题，超长时按字符预算截断。
  description?: string; // 可选人类可读描述，超长时按字符预算截断。
  mimeType?: string; // 可选内容类型。
};

export type McpResourceTemplateReference = {
  serverName: string; // 模板所属的 server 名。
  uriTemplate: string; // RFC 6570 uri 模板，供模型构造具体 uri。
  name: string; // server 指定的模板名称。
  title?: string; // 可选展示标题，超长时按字符预算截断。
  description?: string; // 可选人类可读描述，超长时按字符预算截断。
  mimeType?: string; // 可选内容类型。
};

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

export type McpPromptArgument = {
  name: string; // prompt 声明的参数名。
  description?: string; // 可选参数说明，超长时按字符预算截断。
  required: boolean; // 是否必填；缺失按 false 归一，缺必填时命令会先收集。
};

export type McpPromptReference = {
  serverName: string; // prompt 所属的 server 名。
  promptName: string; // server 侧 prompt 名称，注册命令时与 server 名组合。
  description?: string; // 可选描述，超长时按字符预算截断。
  arguments: McpPromptArgument[]; // 按 server 声明顺序排列的参数。
};

export type McpPromptContentBlock =
  | {kind: 'text'; text: string} // 文本内容，注入时直接拼接。
  | {kind: 'image'; mimeType: string; sizeBytes: number} // 图片只保留类型与字节数，不内联 base64。
  | {kind: 'audio'; mimeType: string; sizeBytes: number} // 音频同上。
  | {kind: 'resource'; uri: string; mimeType?: string; text?: string} // 内嵌资源：文本保留，二进制只保留 uri。
  | {kind: 'resource_link'; uri: string; name?: string}; // 资源引用只保留 uri 与可选名称。

export type McpPromptMessage = {
  role: 'user' | 'assistant'; // 消息角色，注入时作为来源标签。
  content: McpPromptContentBlock; // 单条内容块。
};

export type McpPromptResult = {
  description?: string; // 可选说明，来自 prompts/get 响应。
  messages: McpPromptMessage[]; // 按 server 返回顺序排列，注入时保持顺序。
};

## ADDED Requirements

### Requirement: Codex OAuth provider 配置解析
系统 SHALL 支持通过用户级 `~/.echo/config.json` 配置 Codex OAuth provider。该 provider SHALL 使用独立 provider preset 解析为 Codex backend Responses 传输，SHALL NOT 要求用户配置 OpenAI Platform API key，且 SHALL NOT 将 Codex OAuth access token 或 refresh token 保存到 `~/.echo/config.json`。

#### Scenario: 解析 Codex OAuth provider
- **WHEN** 当前生效 provider profile 引用 Codex OAuth preset
- **THEN** 系统 SHALL 将其解析为 `agentType: "codex"` 的 Codex backend Responses 传输配置
- **THEN** 系统 SHALL 使用固定 Base URL `https://chatgpt.com/backend-api/codex`
- **THEN** 系统 SHALL NOT 要求 provider profile 包含 `apiKey`

#### Scenario: 缺少 Codex auth cache 时明确失败
- **WHEN** 当前生效 provider profile 引用 Codex OAuth preset
- **AND** 系统无法在配置路径、`CODEX_HOME` 或默认 `~/.codex/auth.json` 找到 file-based Codex auth cache
- **THEN** 系统 SHALL 明确提示需要已有 Codex file auth cache
- **THEN** 系统 SHALL NOT 发起 provider request
- **THEN** 错误提示 SHALL NOT 包含任何 token、header value 或 auth cache 文件内容

#### Scenario: Codex auth cache 格式无法识别时明确失败
- **WHEN** 当前生效 provider profile 引用 Codex OAuth preset
- **AND** Codex auth cache 存在但缺少可识别的 ChatGPT/Codex OAuth access token
- **THEN** 系统 SHALL 明确提示 Codex OAuth 凭据不可用或需要重新登录
- **THEN** 系统 SHALL NOT 发起 provider request
- **THEN** 错误提示 SHALL NOT 输出 auth cache 原文

### Requirement: Codex OAuth token 刷新
系统 SHALL 在 Codex OAuth access token 过期且 refresh token 可用时，通过 OpenAI OAuth token endpoint 刷新 access token。刷新结果 SHALL 只用于当前进程运行时，系统 SHALL NOT 回写 Codex CLI 的 `auth.json`、keyring 或其他外部 credential store。

#### Scenario: access token 未过期时直接使用
- **WHEN** Codex auth cache 中的 access token 存在且未过期
- **THEN** 系统 SHALL 使用该 access token 构造 Codex backend 请求
- **THEN** 系统 SHALL NOT 调用 OAuth refresh endpoint

#### Scenario: access token 过期时刷新
- **WHEN** Codex auth cache 中的 access token 已过期
- **AND** refresh token 存在
- **THEN** 系统 SHALL 向 `https://auth.openai.com/oauth/token` 发送 refresh token 请求
- **THEN** 请求 SHALL 使用 `grant_type=refresh_token`
- **THEN** 刷新成功后系统 SHALL 使用新的 access token 发起本次 provider request
- **THEN** 系统 SHALL NOT 将新的 access token 或 refresh token 写回 Codex auth cache

#### Scenario: refresh token 缺失或刷新失败
- **WHEN** Codex auth cache 中的 access token 已过期
- **AND** refresh token 缺失或 refresh endpoint 返回失败
- **THEN** 系统 SHALL 阻止本次 provider request
- **THEN** 系统 SHALL 提示用户通过 Codex CLI 重新登录或刷新本机 Codex auth cache
- **THEN** 错误提示 SHALL 对 access token、refresh token 和响应体中的敏感字段脱敏

### Requirement: Codex backend Responses 请求
Codex OAuth provider SHALL 使用独立 Codex adapter 调用 Codex backend Responses 端点发起流式模型请求。请求 SHALL 复用现有 OpenAI Responses transcript conversion、工具 schema 投影、streaming 回调、usage 上报和中断语义；认证 SHALL 使用 Codex OAuth access token 的 Bearer header。

#### Scenario: 构造 Codex Responses 请求
- **WHEN** 当前 provider preset 为 Codex OAuth 且用户提交普通消息
- **THEN** adapter SHALL 向 `https://chatgpt.com/backend-api/codex/responses` 发起流式 Responses 请求
- **THEN** 请求 SHALL 包含当前模型名、转换后的 transcript input、prompt cache key 和可用工具 definitions
- **THEN** 请求 SHALL 包含 `Authorization: Bearer <access token>` header
- **THEN** 请求日志、错误文本和 transcript SHALL NOT 包含 access token 明文

#### Scenario: 发送 ChatGPT account id header
- **WHEN** 系统能从 Codex OAuth token 或 auth cache 中解析 ChatGPT account id
- **THEN** Codex backend 请求 SHALL 包含 `ChatGPT-Account-ID` header
- **THEN** 系统 SHALL NOT 将 account id 当作敏感 token 脱敏为不可诊断内容

#### Scenario: 保持 Responses 工具循环
- **WHEN** Codex backend stream 返回 function tool call
- **THEN** 系统 SHALL 按现有 OpenAI Responses tool call 语义生成 provider-neutral tool call
- **THEN** 外层 agent loop SHALL 继续执行本地工具并发起后续 Codex backend continuation request

#### Scenario: Codex 请求被用户中断
- **WHEN** 用户在 Codex backend provider turn 进行中触发中断
- **THEN** adapter SHALL 将 abort signal 传递给 provider request
- **THEN** 系统 SHALL 按现有用户主动中断语义结束本次 assistant turn

### Requirement: Codex backend 模型枚举
系统 SHALL 支持 Codex OAuth provider 的模型枚举。模型枚举 SHALL 使用当前 Codex OAuth access token 访问 Codex backend models endpoint，并 SHALL 过滤出可供用户选择的模型 id。

#### Scenario: 枚举 Codex 订阅模型
- **WHEN** 用户在 `/config` 中对 Codex OAuth provider 激活模型枚举
- **AND** Codex OAuth credential 可用
- **THEN** 系统 SHALL 请求 `https://chatgpt.com/backend-api/codex/models?client_version=1.0.0`
- **THEN** 请求 SHALL 包含 Bearer access token
- **THEN** 系统 SHALL 返回可见模型 id 列表供配置面板选择

#### Scenario: 模型枚举失败时保护凭据
- **WHEN** Codex backend 模型枚举因鉴权、网络、usage limit 或响应格式失败
- **THEN** 系统 SHALL 返回脱敏后的错误
- **THEN** 错误 SHALL NOT 包含 access token、refresh token、Authorization header 或 auth cache 内容
- **THEN** 用户 SHALL 仍可手动添加模型 id

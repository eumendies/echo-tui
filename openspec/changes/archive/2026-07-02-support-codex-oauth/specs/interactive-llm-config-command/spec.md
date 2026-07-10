## ADDED Requirements

### Requirement: Codex OAuth provider preset 配置
`/config` SHALL 支持 Codex OAuth provider preset。该 preset SHALL 表示使用本机已有 Codex/ChatGPT OAuth 登录态访问 Codex 订阅模型，配置面板 SHALL NOT 将其呈现为需要用户粘贴 API key 的 provider。

#### Scenario: provider 类型列表展示 Codex OAuth
- **WHEN** 用户新增 provider 并打开 provider preset 选择
- **THEN** 配置面板 SHALL 提供 Codex OAuth provider 选项
- **THEN** 该选项 SHALL 说明需要本机已有 Codex 登录态和 file-based auth cache
- **THEN** 该选项 SHALL NOT 要求用户输入 OpenAI Platform API key

#### Scenario: Codex OAuth 详情页隐藏 API key
- **WHEN** 用户打开 Codex OAuth provider 详情页
- **THEN** 配置面板 SHALL 隐藏或禁用 API key 编辑字段
- **THEN** 配置面板 SHALL 展示 Codex auth cache 来源摘要或缺失提示
- **THEN** 配置面板 SHALL NOT 展示 access token、refresh token 或 auth cache 原文

#### Scenario: 保存 Codex OAuth provider
- **WHEN** 用户保存包含 Codex OAuth provider 和至少一个模型 profile 的配置草稿
- **THEN** 保存校验 SHALL NOT 要求该 provider 配置 `apiKey`
- **THEN** 保存后的 provider profile SHALL 包含 Codex OAuth preset id
- **THEN** 保存后的 `~/.echo/config.json` SHALL NOT 包含 access token 或 refresh token

### Requirement: Codex OAuth provider 模型管理
`/config` SHALL 允许用户为 Codex OAuth provider 手动添加模型 id，并 SHALL 在 Codex OAuth credential 可用时支持从 Codex backend 枚举模型。该流程 SHALL 保持 command surface 内部交互，不写入 transcript，也不触发 assistant turn。

#### Scenario: 手动添加 Codex 模型
- **WHEN** 用户在 Codex OAuth provider 详情页激活 `+ add model`
- **THEN** 配置面板 SHALL 允许用户输入 Codex backend 模型 id
- **THEN** 模型 SHALL 绑定到当前 Codex OAuth provider
- **THEN** 保存前 SHALL NOT 修改 `~/.echo/config.json`

#### Scenario: 从 Codex backend 模型列表添加模型
- **WHEN** 用户在 Codex OAuth provider 详情页激活 `list models`
- **AND** Codex OAuth credential 可用且模型枚举成功
- **THEN** 配置面板 SHALL 展示 Codex backend 返回的可选模型 id
- **THEN** 用户选择模型后系统 SHALL 将该模型加入当前草稿或聚焦已有同名模型
- **THEN** 系统 SHALL 返回 provider 详情页且不写入 transcript

#### Scenario: Codex 模型枚举不可用时继续允许手动配置
- **WHEN** 用户在 Codex OAuth provider 详情页激活 `list models`
- **AND** Codex auth cache 缺失、过期刷新失败、网络失败或响应格式无效
- **THEN** 配置面板 SHALL 显示脱敏后的错误提示
- **THEN** 配置面板 SHALL 保留当前草稿
- **THEN** 用户 SHALL 仍可通过 `+ add model` 手动新增模型 id

### Requirement: Codex OAuth 配置敏感信息保护
`/config` SHALL 将 Codex OAuth auth cache 和 token 视为敏感凭据。配置读取、校验、保存、模型枚举和错误渲染 SHALL NOT 泄漏 access token、refresh token、Authorization header 或 auth cache 文件内容。

#### Scenario: 配置错误不泄漏 Codex token
- **WHEN** Codex OAuth provider 的 auth cache 读取、token 刷新或模型枚举失败
- **THEN** 配置面板 SHALL 显示可理解的脱敏错误
- **THEN** 错误 SHALL NOT 包含 access token、refresh token、Bearer token、Authorization header 或 auth cache 原文

#### Scenario: 取消 Codex OAuth 配置不持久化草稿
- **WHEN** 用户在 `/config` 中新增或编辑 Codex OAuth provider 后按 Esc 取消
- **THEN** 系统 SHALL 关闭 command session
- **THEN** 系统 SHALL NOT 修改 `~/.echo/config.json`
- **THEN** 系统 SHALL NOT 写入任何 Codex OAuth credential

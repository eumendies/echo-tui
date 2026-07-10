## ADDED Requirements

### Requirement: MCP server 配置
系统 SHALL 从用户级配置文件读取 MCP server 配置。配置 SHALL 支持全局开关、多个具名 server、`stdio` transport、`http` transport、初始化/调用 timeout 和 server 级审批策略。未配置 MCP 或显式关闭 MCP 时，系统 SHALL 保持现有仅内置工具行为。

#### Scenario: 未配置 MCP 时保持现有行为
- **WHEN** 用户级配置文件没有 `mcp` 字段
- **THEN** 系统 SHALL 不初始化任何 MCP server
- **THEN** 默认 tool registry SHALL 只包含既有内置工具

#### Scenario: 读取 stdio MCP server 配置
- **WHEN** `mcp.servers` 中存在 `transport: "stdio"` 的 enabled server
- **THEN** 系统 SHALL 读取该 server 的 `command`、可选 `args`、可选 `env`、可选 `cwd`、可选 `timeoutMs` 和可选 `approval`
- **THEN** 缺少有效 `command` 的该 server SHALL 被视为配置失败

#### Scenario: 读取 http MCP server 配置
- **WHEN** `mcp.servers` 中存在 `transport: "http"` 的 enabled server
- **THEN** 系统 SHALL 读取该 server 的 `url`、可选字符串 `headers`、可选 `timeoutMs` 和可选 `approval`
- **THEN** 缺少有效 `url` 的该 server SHALL 被视为配置失败

#### Scenario: 忽略 disabled MCP server
- **WHEN** 某个 MCP server 配置了 `enabled: false`
- **THEN** 系统 SHALL 不初始化该 server
- **THEN** 系统 SHALL 不注册该 server 的任何 MCP tools

#### Scenario: 无效 MCP server 配置不阻止普通问答
- **WHEN** 某个 MCP server 配置无效
- **THEN** 系统 SHALL 为该 server 记录初始化失败诊断
- **THEN** 系统 SHALL 不注册该 server 的任何 MCP tools
- **THEN** 其他有效 MCP servers 和普通 LLM 问答 SHALL 继续可用

### Requirement: MCP 启动期初始化
系统 SHALL 在 TUI 启动并完成首屏渲染后初始化 enabled MCP servers。初始化期间 TUI SHALL 可见、可退出并响应 resize；系统 SHALL 在初始化完成前阻止用户提交问答、启动 slash command 或切换 interaction mode。初始化结束后，无论是否存在失败 server，系统 SHALL 进入可问答状态。

#### Scenario: 启动后进入 MCP 初始化状态
- **WHEN** TUI 启动且存在 enabled MCP servers
- **THEN** 系统 SHALL 先渲染 TUI 首屏
- **THEN** 系统 SHALL 进入 MCP initializing 状态并开始初始化 enabled MCP servers
- **THEN** 初始化状态 SHALL 在 footer 或等价临时 UI 中可见

#### Scenario: 初始化期间阻止问答提交
- **WHEN** MCP initializing 状态仍在进行
- **AND** 用户按下 Enter 提交 composer 内容
- **THEN** 系统 SHALL NOT 追加 user transcript record
- **THEN** 系统 SHALL NOT 启动 agent provider request
- **THEN** composer 内容 SHALL 保留供初始化完成后继续编辑或提交

#### Scenario: 初始化期间允许退出和 resize
- **WHEN** MCP initializing 状态仍在进行
- **AND** 用户触发 Ctrl+C、Ctrl+D 或 terminal resize
- **THEN** 系统 SHALL 保持既有退出或 resize recovery 语义
- **THEN** 系统 SHALL NOT 因初始化状态卡死终端清理或重绘

#### Scenario: 初始化失败 server 不注册 tools
- **WHEN** 某个 MCP server 在连接、initialize 或 `tools/list` 阶段失败
- **THEN** 系统 SHALL 记录该 server 的失败诊断
- **THEN** 系统 SHALL NOT 将该 server 的 tools 加入 registry
- **THEN** 系统 SHALL 继续初始化其他 enabled MCP servers

#### Scenario: 初始化完成后允许普通问答
- **WHEN** 所有 enabled MCP servers 均已初始化成功、失败或跳过
- **THEN** 系统 SHALL 离开 MCP initializing 状态
- **THEN** 用户 SHALL 可以提交普通问答
- **THEN** 成功初始化的 MCP servers 的 tools SHALL 可用于后续 provider request

#### Scenario: 初始化诊断不写入 transcript
- **WHEN** MCP 初始化完成且存在失败 server 诊断
- **THEN** 系统 SHALL 通过 transient UI 展示失败 server 和脱敏错误摘要
- **THEN** 系统 SHALL NOT 为 MCP 初始化诊断追加 user、assistant、error 或 local_notice transcript record
- **THEN** 系统 SHALL NOT 将 MCP 初始化诊断持久化到 transcript session

### Requirement: MCP tools 暴露为 provider tools
系统 SHALL 将成功初始化的 MCP server 返回的 tools 转换为 provider-neutral `ToolDefinition` 并加入 normal mode 的 tool registry。MCP tool 名称 SHALL 包含 server namespace，以避免不同 MCP servers 之间或与内置工具之间发生名称冲突。

#### Scenario: MCP tool 使用 namespace 名称
- **WHEN** MCP server `docs` 返回名为 `search` 的 tool
- **THEN** provider-visible tool name SHALL 使用 `mcp__docs__search` 或等价 namespace 格式
- **THEN** 系统 SHALL 能根据 provider-visible name 反查原始 server 和 MCP tool 名

#### Scenario: MCP tool schema 转换为 ToolDefinition
- **WHEN** MCP server 成功返回 tool 的名称、描述和 input schema
- **THEN** 系统 SHALL 创建对应的 provider-neutral `ToolDefinition`
- **THEN** 该 definition SHALL 保留 MCP tool 的描述和参数 schema 语义

#### Scenario: 只注册成功初始化 server 的 tools
- **WHEN** MCP bootstrap 中部分 servers 成功、部分 servers 失败
- **THEN** registry SHALL 只包含成功 servers 的 MCP tools
- **THEN** provider request SHALL NOT 包含失败 servers 的 MCP tool definitions

#### Scenario: plan mode 默认不暴露 MCP tools
- **WHEN** 当前 interaction mode 为 plan
- **THEN** provider-visible tool registry SHALL NOT 包含 MCP tools
- **THEN** plan mode SHALL 继续只暴露既有只读工具集合和受限 readonly bash inspection

### Requirement: MCP tool 调用代理
系统 SHALL 在 provider 调用 MCP namespace tool 时，通过 MCP manager 调用对应 server 的原始 MCP tool，并将 MCP result 转换为现有 `ToolExecutionResult`。MCP tool result SHALL 保留原始 provider tool call id 和 provider-visible tool name，以便后续 continuation 正确关联。

#### Scenario: 执行 MCP tool 成功
- **WHEN** provider 调用 `mcp__docs__search` 并传入有效 JSON object arguments
- **THEN** tool executor SHALL 将调用代理到 server `docs` 的原始 `search` tool
- **THEN** 执行成功时系统 SHALL 返回 `ok: true` 的 tool execution result
- **THEN** result 文本 SHALL 包含 MCP text content 或可读的结构化结果摘要

#### Scenario: MCP tool 返回错误
- **WHEN** MCP server 对某次 tool call 返回错误或 `isError` 结果
- **THEN** 系统 SHALL 返回 `ok: false` 的 tool execution result
- **THEN** result 文本 SHALL 包含脱敏后的 MCP 错误摘要
- **THEN** 系统 SHALL NOT 抛出未捕获异常中断 app

#### Scenario: MCP rich content 安全降级为文本
- **WHEN** MCP tool result 包含 text 之外的 content block
- **THEN** 系统 SHALL 将其转换为可读文本占位或摘要
- **THEN** 系统 SHALL 保持现有 transcript 和 provider continuation 的纯文本 tool result 语义

#### Scenario: MCP server 断开后的调用失败
- **WHEN** provider 调用某个已注册 MCP tool 但对应 server 已断开或调用超时
- **THEN** 系统 SHALL 返回 `ok: false` 的 tool execution result
- **THEN** result 文本 SHALL 说明 MCP server 当前不可用或调用超时
- **THEN** 系统 SHALL NOT 自动把该失败转换为本地 transcript error

### Requirement: MCP tool 审批策略
系统 SHALL 对 MCP tools 应用 server 级审批策略。除非 server 配置显式 `approval: "never"`，MCP tool call 默认 SHALL 在执行前请求用户授权。用户拒绝时，系统 SHALL 不调用 MCP server，并 SHALL 返回可回传模型的拒绝 tool result。

#### Scenario: MCP tool 默认请求审批
- **WHEN** MCP server 没有配置 `approval` 或配置为 `approval: "always"`
- **AND** provider 调用该 server 的 MCP tool
- **THEN** 系统 SHALL 在调用 MCP server 前请求用户授权
- **THEN** 用户允许前 SHALL NOT 执行该 MCP tool

#### Scenario: 受信任 MCP server 跳过审批
- **WHEN** MCP server 配置为 `approval: "never"`
- **AND** provider 调用该 server 的 MCP tool
- **THEN** 系统 SHALL 将该 MCP tool call 判定为 safe
- **THEN** 系统 SHALL 不打开工具授权 surface，直接代理执行 MCP tool

#### Scenario: 用户拒绝 MCP tool 调用
- **WHEN** MCP tool 授权请求处于活跃状态且用户选择拒绝或按 Esc
- **THEN** 系统 SHALL NOT 调用 MCP server
- **THEN** 系统 SHALL 生成 `ok: false` 的 tool result
- **THEN** 该 result SHALL 保留原始 MCP provider-visible tool name 和 call id

### Requirement: MCP 生命周期清理
系统 SHALL 在 app 退出时关闭已初始化的 MCP clients/transports。stdio MCP server 进程 SHALL 被关闭或终止；HTTP MCP client SHALL 释放其持有的 transport/session 资源。

#### Scenario: 退出时关闭 MCP servers
- **WHEN** 用户通过 Ctrl+C、Ctrl+D 或其他正常退出路径退出 TUI
- **THEN** 系统 SHALL 请求 McpManager 关闭所有已初始化 MCP clients/transports
- **THEN** 系统 SHALL 继续执行既有 terminal cleanup 和进程退出逻辑

#### Scenario: 部分关闭失败不阻止退出
- **WHEN** 某个 MCP client/transport 在关闭时失败
- **THEN** 系统 SHALL 继续关闭其他 MCP clients/transports
- **THEN** 系统 SHALL NOT 因 MCP 关闭失败阻止 terminal cleanup

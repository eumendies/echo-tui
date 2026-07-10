# mcp-tool-integration Specification

## Purpose
定义 echo_tui 与 Model Context Protocol (MCP) server 集成的外部行为，包括用户级 MCP 配置、启动期初始化、provider tool 暴露、tool call 代理、审批策略和生命周期清理。
## Requirements
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
系统 SHALL 将成功初始化的 MCP server 返回的 tools 转换为 provider-neutral `ToolDefinition` 并加入 provider-visible tool registry。MCP tool 名称 SHALL 包含 server namespace，以避免不同 MCP servers 之间或与内置工具之间发生名称冲突。Plan mode SHALL 保持 MCP tool definitions 的 provider 可见性以稳定 tools schema，但 SHALL 在执行前拒绝 MCP tool call。

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

#### Scenario: plan mode 保持 MCP tools schema 可见
- **WHEN** 当前 interaction mode 为 plan
- **AND** MCP bootstrap 已成功初始化一个或多个 MCP tools
- **THEN** provider-visible tool registry SHALL 包含这些 MCP tool definitions
- **THEN** provider-visible MCP tool definitions SHALL 与 normal mode 在相同 MCP 状态下保持一致

#### Scenario: plan mode 拒绝 MCP tool 执行
- **WHEN** 当前 interaction mode 为 plan
- **AND** provider 调用任意 MCP namespace tool
- **THEN** classifier SHALL 将该 MCP tool call 判定为 rejected
- **AND** 系统 SHALL NOT 调用对应 MCP server
- **AND** runtime SHALL 返回 `ok: false` 的 tool result，说明 MCP tools 在 plan mode 不可执行

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

### Requirement: setup skill 文档化 MCP 配置
默认 `echo-tui-setup` skill SHALL 文档化用户级 MCP 配置结构，使模型和用户可以按现有 MCP runtime 规则配置 server，但 bootstrap SHALL NOT 自动创建任何 enabled MCP server。

#### Scenario: setup skill 说明 MCP server 配置
- **WHEN** 用户或模型加载 `echo-tui-setup` skill
- **THEN** skill 正文 SHALL 说明 `mcp.enabled` 和 `mcp.servers` 的基本结构
- **THEN** skill 正文 SHALL 说明 `stdio` server 的 `command`、`args`、`env`、`cwd`、`timeoutMs` 和 `approval` 字段
- **THEN** skill 正文 SHALL 说明 `http` server 的 `url`、`headers`、`timeoutMs` 和 `approval` 字段

#### Scenario: 默认配置不自动启用 MCP server
- **WHEN** bootstrap 创建默认 `~/.echo/config.json`
- **THEN** 默认配置 SHALL NOT 包含依赖外部命令、本机路径或网络地址的 enabled MCP server
- **THEN** MCP runtime SHALL 保持未配置 MCP 时的既有行为

### Requirement: MCP runtime 支持配置保存后的 reload
系统 SHALL 支持在 TUI 运行期间按最新用户配置重载 MCP manager。reload SHALL 关闭不再保留的 active MCP clients，重新读取 `~/.echo/config.json`，按最新 enabled MCP 配置初始化 servers，并更新后续 provider-visible MCP tools。

#### Scenario: 保存后禁用 MCP server
- **WHEN** 某个已初始化 MCP server 通过 `/mcp` 保存为 disabled
- **THEN** MCP manager SHALL 关闭该 server 的 active client 或 transport
- **THEN** 后续 provider request SHALL NOT 包含该 server 的 MCP tools

#### Scenario: 保存后启用 MCP server
- **WHEN** 某个配置有效的 MCP server 通过 `/mcp` 保存为 enabled
- **THEN** MCP manager SHALL 按最新配置初始化该 server
- **THEN** 初始化成功后，后续 provider request SHALL 包含该 server 的 MCP tools

#### Scenario: 保存后全局关闭 MCP
- **WHEN** `/mcp` 保存后的配置为 `mcp.enabled: false`
- **THEN** MCP manager SHALL 关闭所有 active MCP clients 或 transports
- **THEN** 后续 provider request SHALL NOT 包含任何 MCP tools

#### Scenario: reload 诊断不阻止普通问答
- **WHEN** MCP reload 期间某个 enabled server 初始化失败
- **THEN** 系统 SHALL 记录该 server 的脱敏诊断
- **THEN** 系统 SHALL 不注册该 server 的 MCP tools
- **THEN** 其他成功初始化的 MCP servers 和普通问答 SHALL 继续可用

#### Scenario: reload 后 tool registry 使用最新状态
- **WHEN** MCP manager 完成 reload
- **THEN** `listTools` 或等价 provider-visible tool 枚举 SHALL 基于 reload 后的 active server 集合
- **THEN** 下一轮 assistant request SHALL 使用该最新 MCP tool 集合

### Requirement: MCP 配置提供 UI 草稿视图和安全写回
系统 SHALL 提供面向 `/mcp` command 的 MCP 配置草稿读取和保存能力。草稿读取 SHALL 保留 disabled server 与 invalid server；保存 SHALL 原子写回用户配置，并 SHALL 只修改 enabled 字段。

#### Scenario: 草稿读取保留 disabled server
- **WHEN** 用户配置中某个 MCP server 配置了 `enabled: false`
- **THEN** MCP UI 草稿读取 SHALL 返回该 server
- **THEN** 返回结果 SHALL 标记该 server 当前为 disabled

#### Scenario: 草稿读取保留 invalid server
- **WHEN** 用户配置中某个 MCP server 配置无效
- **THEN** MCP UI 草稿读取 SHALL 返回该 server 的名称和 enabled 草稿状态
- **THEN** 返回结果 SHALL 包含可展示的配置诊断

#### Scenario: 保存 enabled 状态保留未知字段
- **WHEN** `/mcp` 保存 MCP enabled 草稿状态
- **THEN** 系统 SHALL 保留用户配置根对象中的非 MCP 字段
- **THEN** 系统 SHALL 保留 MCP server 对象中的未知字段和非 enabled 字段
- **THEN** 系统 SHALL 使用临时文件和 rename 或等价机制避免部分写入


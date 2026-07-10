## ADDED Requirements

### Requirement: MCP 启动初始化 UI
系统 SHALL 在 TUI 启动后展示 MCP 初始化状态。初始化期间普通 composer 可见，用户 MAY 编辑输入内容，但系统 SHALL 阻止提交问答、启动 slash command 和切换 interaction mode，直到 MCP 初始化完成。

#### Scenario: 显示 MCP 初始化状态
- **WHEN** TUI 启动后正在初始化 MCP servers
- **THEN** footer 或等价临时 UI SHALL 显示 MCP initializing 状态
- **THEN** UI SHALL 表达当前正在准备外部工具能力

#### Scenario: 初始化期间可编辑但不可提交
- **WHEN** MCP initializing 状态仍在进行
- **AND** 用户输入普通字符或编辑 composer
- **THEN** composer SHALL 正常更新
- **WHEN** 用户按 Enter 提交
- **THEN** 系统 SHALL NOT 追加 transcript record 或启动 agent request

#### Scenario: 初始化完成后恢复普通输入
- **WHEN** MCP 初始化完成
- **THEN** footer SHALL 回到普通 composer/status line 或显示可关闭的 MCP 诊断 surface
- **THEN** 用户 SHALL 能提交初始化期间已输入的 composer 内容

#### Scenario: MCP 失败诊断不污染 transcript
- **WHEN** MCP 初始化完成且存在失败 server
- **THEN** TUI SHALL 展示包含失败 server 名称和脱敏错误摘要的 transient 诊断
- **THEN** 该诊断 SHALL NOT 作为 transcript block 出现在历史区域
- **THEN** 该诊断 SHALL 可关闭并回到普通 composer footer

### Requirement: MCP 初始化状态不复用 assistant response lock
系统 SHALL 使用独立的 app readiness 或 MCP bootstrap 状态表示启动初始化。该状态 SHALL NOT 伪装成 assistant thinking、streaming、working 或 shell command 状态，也 SHALL NOT 触发 assistant interruption、partial assistant persistence 或 shell interruption 语义。

#### Scenario: Esc 不作为 assistant interrupt 处理 MCP 初始化
- **WHEN** MCP initializing 状态仍在进行且没有 active assistant turn
- **AND** 用户按下 Esc
- **THEN** 系统 SHALL NOT 追加 assistant partial record
- **THEN** 系统 SHALL NOT 追加本地 assistant interruption notice

#### Scenario: 初始化状态不改变 transcript
- **WHEN** MCP initializing 状态开始、更新或完成
- **THEN** 系统 SHALL NOT 因状态变化追加 user、assistant、tool、shell 或 error transcript record

## ADDED Requirements

### Requirement: Plan mode provider prompt cache stability
agent loop runtime SHALL keep the built-in provider system prompt stable across normal and plan interaction modes when cwd、AGENTS.md、enabled skill catalog 和 MCP 状态不变。Plan mode 的具体只读约束 SHALL 作为 transient `user` record 注入 provider records，SHALL NOT 写入本地 transcript 或持久化 session。

#### Scenario: Plan mode does not alter built-in system prompt
- **WHEN** agent loop runtime 分别为 normal mode 和 plan mode 构造 provider records
- **AND** cwd、AGENTS.md、enabled skill catalog 和 compaction state 相同
- **THEN** 两次 provider records 中的第一条 `system` record 文本 SHALL 相同
- **AND** plan mode 的只读约束 SHALL NOT 出现在该 `system` record 文本中

#### Scenario: Plan mode injects transient user instruction
- **WHEN** agent loop runtime 为 plan mode 构造 provider records
- **THEN** runtime SHALL 在 provider records 末尾追加一条 transient `user` record
- **AND** 该 record SHALL 说明当前处于 plan mode、禁止修改文件或执行会改变状态的命令，并提示需要切换回 normal mode 才能实施计划
- **AND** normal mode provider records SHALL 是相同上下文下 plan mode provider records 的完整前缀

#### Scenario: Plan mode transient instruction is not persisted
- **WHEN** plan mode provider request 完成
- **THEN** 本地 transcript SHALL NOT 追加 plan mode transient instruction record
- **AND** transcript session persistence SHALL NOT 保存该 transient instruction

## MODIFIED Requirements

### Requirement: Agent loop 行为不依赖测试专用 runtime dependencies
系统 SHALL 在删除 agent runtime 创建入口测试专用 dependencies 后保持 agent loop 外部行为不变，包括读取配置、初始化 provider、构建工具 registry、执行 tool call continuation、处理 approval/user question、context compaction 和 context usage callback。Plan mode SHALL 使用与 normal mode 相同的 provider-visible tool registry 来初始化 provider agent，但 SHALL 在执行前风险分类中继续强制只读规划约束。

#### Scenario: Runtime 使用真实配置和 provider 装配
- **WHEN** app 启动 agent loop runtime
- **THEN** runtime SHALL 按当前配置读取和初始化 provider agent
- **THEN** runtime SHALL 使用真实工具 registry 和 tool executor 装配路径
- **THEN** 调用方 SHALL 不需要提供测试专用 provider/config/tool factory dependencies

#### Scenario: Tool continuation 行为保持不变
- **WHEN** provider 返回 tool calls
- **THEN** runtime SHALL 仍追加 tool call/result continuation records
- **THEN** runtime SHALL 仍按工具风险分类处理拒绝、授权和执行结果

#### Scenario: Plan mode 使用稳定 provider-visible registry
- **WHEN** session interaction mode 为 plan
- **THEN** runtime SHALL 使用与 normal mode 相同的 provider-visible tool registry 初始化底层 provider agent
- **THEN** provider-visible tool definitions SHALL 包含默认内置工具，并在 MCP manager 可用时包含成功初始化的 MCP tools
- **THEN** 删除测试专用 dependencies SHALL NOT 放宽 plan mode 的工具执行约束

#### Scenario: MCP 工具仍合并到 runtime registry
- **WHEN** runtime 具有 MCP manager
- **THEN** runtime SHALL 仍将 MCP tool registry 与本地 tool registry 合并
- **THEN** MCP tool approval 配置 SHALL 仍参与 normal mode 风险分类
- **THEN** plan mode SHALL 在执行前风险分类中拒绝 MCP tool call

#### Scenario: 底层 provider agent 不执行工具循环
- **WHEN** provider agent 返回 tool calls
- **THEN** 底层 provider agent SHALL NOT 直接执行本地工具
- **THEN** agent loop runtime SHALL 继续负责执行工具、追加 tool continuation records 并发起后续 provider turn

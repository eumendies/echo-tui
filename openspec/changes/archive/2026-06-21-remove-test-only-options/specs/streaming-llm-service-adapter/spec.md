## ADDED Requirements

### Requirement: Agent loop 行为不依赖测试专用 runtime dependencies
系统 SHALL 在删除 agent runtime 创建入口测试专用 dependencies 后保持 agent loop 外部行为不变，包括读取配置、初始化 provider、构建工具 registry、执行 tool call continuation、处理 approval/user question、context compaction 和 context usage callback。

#### Scenario: Runtime 使用真实配置和 provider 装配
- **WHEN** app 启动 agent loop runtime
- **THEN** runtime SHALL 按当前配置读取和初始化 provider agent
- **THEN** runtime SHALL 使用真实工具 registry 和 tool executor 装配路径
- **THEN** 调用方 SHALL 不需要提供测试专用 provider/config/tool factory dependencies

#### Scenario: Tool continuation 行为保持不变
- **WHEN** provider 返回 tool calls
- **THEN** runtime SHALL 仍追加 tool call/result continuation records
- **THEN** runtime SHALL 仍按工具风险分类处理拒绝、授权和执行结果

#### Scenario: Plan mode 使用只读工具 registry
- **WHEN** session interaction mode 为 plan
- **THEN** runtime SHALL 仍使用只读工具 registry
- **THEN** 删除测试专用 dependencies SHALL NOT 放宽 plan mode 的工具执行约束

#### Scenario: MCP 工具仍合并到 runtime registry
- **WHEN** runtime 具有 MCP manager
- **THEN** runtime SHALL 仍将 MCP tool registry 与本地 tool registry 合并
- **THEN** MCP tool approval 配置 SHALL 仍参与风险分类


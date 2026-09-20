## MODIFIED Requirements

### Requirement: Worker 拥有除再次委派外的完整任务工具能力
Worker SHALL 获得当前主 Agent 用于完成任务的本地工具能力，包括配置选择的文件编辑工具、Bash、读取与搜索、Web、Skill、Todo、`ask_user_questions` 和 MCP 资源读取工具，并 SHALL 获得当前父运行已初始化的 MCP tools。Worker registry SHALL 是独立实例，MCP tools 与资源读取 SHALL 复用共享 MCP manager 而不得重新建立连接。Provider-visible schema 与 executable registry SHALL 来自同一装配结果。

#### Scenario: Worker registry 包含完整工具面
- **WHEN** 系统在 normal mode 为 Worker 构造 registry
- **THEN** definitions SHALL 包含当前配置选择的 `apply_patch` 或 `edit_file`、`run_bash_command`、读取搜索、Web、Skill、Todo 与 `ask_user_questions`
- **THEN** definitions SHALL 包含共享 MCP manager 当前发现的可用 tools
- **THEN** definitions SHALL 包含 `list_mcp_resources` 与 `read_mcp_resource`
- **THEN** definitions SHALL NOT 包含 `run_subagent`

#### Scenario: Worker 与 Explorer 工具面保持区分
- **WHEN** 同一个父运行分别创建 Explorer 与 Worker
- **THEN** Explorer SHALL 继续只取得其严格只读本地 allowlist，不包含 MCP tools、Todo、提问或文件编辑
- **THEN** Explorer 与 Worker SHALL 都能读取 MCP 资源，且该共同能力 SHALL NOT 放宽 Explorer 的 schema 或执行策略

## MODIFIED Requirements

### Requirement: Worker 拥有除再次委派外的完整任务工具能力
Worker SHALL 按自身 definition 的本地工具白名单获得任务能力，文件编辑仅包含 `apply_patch`，不包含 `edit_file`；其他能力包括 Bash、读取与搜索、Web、Skill、Todo、`ask_user_questions` 和 MCP 资源读取工具，并 SHALL 获得当前父运行已初始化的 MCP tools。公共工具工厂 SHALL 始终构造两个编辑工具，再按子运行的 `allowedToolNames` 筛选，不读取旧 `tools.fileEdit.mode` 或使用内部编辑互斥分支。Worker SHALL NOT 继承主 Agent 的 `disabledTools`。Worker registry SHALL 是独立实例，MCP tools 与资源读取 SHALL 复用共享 MCP manager 而不得重新建立连接。Provider-visible schema 与 executable registry SHALL 来自同一装配结果。

#### Scenario: Worker registry 包含完整工具面
- **WHEN** 系统在 normal mode 为 Worker 构造 registry
- **THEN** definitions SHALL 包含 `apply_patch`、`run_bash_command`、读取搜索、Web、Skill、Todo 与 `ask_user_questions`
- **THEN** definitions SHALL 包含共享 MCP manager 当前发现的可用 tools
- **THEN** definitions SHALL 包含 `list_mcp_resources` 与 `read_mcp_resource`
- **THEN** definitions 与 executable registry SHALL NOT 包含 `edit_file` 或 `run_subagent`

#### Scenario: Worker 不继承主禁用名单或旧编辑模式
- **WHEN** 主 Agent 禁用两个编辑工具或其他 Worker 白名单内工具，并仍允许委派 Worker
- **THEN** Worker SHALL 继续注册自身白名单允许且满足可用性条件的工具，包括 `apply_patch`，但不包含 `edit_file`
- **THEN** 旧文件编辑模式 SHALL NOT 改变 Worker definition 指定的编辑工具，普通审批、plan 和 headless 执行限制 SHALL 继续生效

#### Scenario: Worker 拒绝伪造的 edit_file 调用
- **WHEN** Worker provider 返回 `edit_file` 调用
- **THEN** 子运行 SHALL 返回匹配原调用身份的 `ok: false` 结果并说明该工具未注册
- **THEN** 子运行 SHALL NOT 请求该工具的审批、执行 handler 或产生文件修改

#### Scenario: Worker 与 Explorer 工具面保持区分
- **WHEN** 同一个父运行分别创建 Explorer 与 Worker
- **THEN** Explorer SHALL 继续只取得其严格只读本地 allowlist，不包含 MCP tools、Todo、提问或文件编辑
- **THEN** Explorer 与 Worker SHALL 都能读取 MCP 资源，且该共同能力 SHALL NOT 放宽 Explorer 的 schema 或执行策略

#### Scenario: 自定义 Agent 继续自身白名单
- **WHEN** 同一个父运行委派自定义 Agent
- **THEN** 自定义 Agent SHALL 只按自身白名单及可用性筛选工具，不继承主禁用名单，也不因 Worker 移除 `edit_file` 而改变自身编辑工具选择
- **THEN** 未被该 Agent 白名单允许的编辑工具 SHALL NOT 出现在其 provider definitions 或 executable registry 中

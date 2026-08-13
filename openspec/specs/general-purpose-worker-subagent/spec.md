# general-purpose-worker-subagent Specification

## Purpose
TBD - created by archiving change add-general-purpose-worker-subagent. Update Purpose after archive.
## Requirements
### Requirement: Worker 可执行自包含通用子任务
系统 SHALL 在内置 Subagent 定义目录中提供 `worker`。主 Agent SHALL 能通过 `run_subagent` 把一个自包含通用任务同步交给 Worker，并在 Worker 完成、失败或取消后取得外层 tool result。Worker SHALL 使用专属行为 prompt，只完成被委派任务、遵守适用项目指令、在受阻时向父 Agent 报告，不得接管父任务或继续委派。

#### Scenario: 主 Agent 委派 Worker
- **WHEN** 主 Agent 调用 `run_subagent` 并提交 `agent: worker` 与非空 `task`
- **THEN** 系统 SHALL 创建一个绑定 Worker 定义的独立 Subagent runtime 并等待其结束
- **THEN** 成功的外层 tool result SHALL 返回 Worker 最终报告供主 Agent 继续既有 continuation

#### Scenario: Worker 不能继续委派
- **WHEN** 系统为 Worker 构造 provider-visible 和 executable registry
- **THEN** registry SHALL NOT 包含 `run_subagent`
- **THEN** 伪造的嵌套委派调用 SHALL 在本地执行边界失败

### Requirement: Worker 拥有除再次委派外的完整任务工具能力
Worker SHALL 获得当前主 Agent 用于完成任务的本地工具能力，包括配置选择的文件编辑工具、Bash、读取与搜索、Web、Skill、Todo 和 `ask_user_questions`，并 SHALL 获得当前父运行已初始化的 MCP tools。Worker registry SHALL 是独立实例，MCP tools SHALL 复用共享 MCP manager 而不得重新建立连接。Provider-visible schema 与 executable registry SHALL 来自同一装配结果。

#### Scenario: Worker registry 包含完整工具面
- **WHEN** 系统在 normal mode 为 Worker 构造 registry
- **THEN** definitions SHALL 包含当前配置选择的 `apply_patch` 或 `edit_file`、`run_bash_command`、读取搜索、Web、Skill、Todo 与 `ask_user_questions`
- **THEN** definitions SHALL 包含共享 MCP manager 当前发现的可用 tools
- **THEN** definitions SHALL NOT 包含 `run_subagent`

#### Scenario: Worker 与 Explorer 工具面保持区分
- **WHEN** 同一个父运行分别创建 Explorer 与 Worker
- **THEN** Explorer SHALL 继续只取得其严格只读本地 allowlist且不包含 MCP、Todo、提问或文件编辑
- **THEN** Worker 的完整工具面 SHALL NOT 放宽 Explorer 的 schema 或执行策略

### Requirement: Worker Todo 独立于父会话
Worker runtime SHALL 在自身 continuation 中维护独立 `TodoState`，并 SHALL 以与主 Agent 相同的语义处理 `create_todos` 和 `complete_todo`。Worker Todo SHALL 注入 Worker 后续 provider context，但 SHALL NOT 读取、覆盖或持久化为父 session TodoState。Todo call/result SHALL 作为普通内部工具过程镜像到 Worker Subagent records。

#### Scenario: Worker 创建并完成 Todo
- **WHEN** Worker 先调用 `create_todos` 后调用 `complete_todo`
- **THEN** Worker 后续 provider request SHALL 看到更新后的自身 open Todo
- **THEN** 内部 Todo call/result SHALL 出现在 Worker rail 可恢复过程里
- **THEN** 父 session TodoState SHALL 保持不变

### Requirement: Worker 复用主 Agent 普通执行策略
Worker SHALL 继承父 Agent 当前 normal或plan交互语义，并通过与主 Agent相同的风险分类处理本地写入、Bash 和 MCP。所有 approval-required Worker调用 SHALL 使用与主 Agent共享的会话授权缓存、manual/auto resolver和change recorder，同时附加 Worker run origin用于surface身份和迟到回调隔离。

#### Scenario: Normal Worker 执行普通任务工具
- **WHEN** normal mode Worker 请求安全工具或需要审批的文件编辑、高风险 Bash、MCP调用
- **THEN** 系统 SHALL 使用主 Agent normal mode的风险分类结果
- **THEN** approval-required调用 SHALL 在共享会话缓存未命中时进入当前manual或auto审批流程
- **THEN** 人工surface SHALL显示Worker身份，批准后的变更 SHALL沿用父turn change recorder

#### Scenario: Plan Worker 不能绕过只读边界
- **WHEN** plan mode Worker 请求文件编辑、非只读 Bash 或 MCP tool
- **THEN** 系统 SHALL 按主 Agent plan mode语义直接拒绝该调用
- **THEN** 系统 SHALL NOT 因调用来自Worker而进入写入审批或执行对应handler

#### Scenario: Headless Worker 沿用父策略
- **WHEN** headless Worker产生approval-required工具调用
- **THEN** approval policy为`deny`时系统 SHALL返回失败tool result且不等待stdin
- **THEN** approval policy为`full-access`时系统 SHALL允许该调用一次并继续Worker continuation

### Requirement: Worker 运行状态与父运行隔离
每次 Worker委派 SHALL 使用独立 transcript、Todo、compaction、provider continuation和registry实例。Worker MAY复用父运行捕获的配置revision、cwd、模型选择、AGENTS指令、memory、skill catalog、MCP manager、hooks、debug和usage store，但 SHALL NOT继承父transcript、父Todo、父compaction或父journal路径。

#### Scenario: 连续 Worker 委派互不共享状态
- **WHEN** 同一个父run先后接受两个Worker委派
- **THEN** 两次运行 SHALL分别创建新的runtime、record region、Todo、compaction和registry
- **THEN** 第二个Worker SHALL NOT看到第一个Worker的对话、Todo或内部工具continuation

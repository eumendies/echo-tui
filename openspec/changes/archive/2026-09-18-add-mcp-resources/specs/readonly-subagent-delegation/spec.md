## MODIFIED Requirements

### Requirement: 子 Agent 只看到专属工具目录
系统 SHALL 在 provider adapter 创建前为 `explorer` 构造真实裁剪后的工具 registry，而不是只在执行时拒绝主 Agent 工具。该 registry SHALL 包含 `read_files`、`glob`、`grep`、`run_bash_command`、`web_fetch`、`web_search`、`use_skill` 和 MCP 资源读取工具 `list_mcp_resources`、`read_mcp_resource`；SHALL NOT 包含 `apply_patch`、`edit_file`、Todo、`ask_user_questions`、`mcp__` 命名空间的 MCP tools 或其他未列入 allowlist 的工具。执行边界 SHALL 再次按同一 allowlist 校验工具名，防止伪造调用绕过 provider-visible schema。

#### Scenario: Provider 只接收 allowlist 工具
- **WHEN** 系统构造 `explorer` provider 请求
- **THEN** tool definitions SHALL 只包含子 Agent allowlist 中的工具
- **THEN** tool definitions SHALL NOT 因主 registry 存在 MCP tools 或写入工具而包含它们

#### Scenario: 资源读取工具进入 explorer 目录
- **WHEN** 父运行已初始化至少一个 MCP server
- **THEN** `explorer` 的 provider-visible 与 executable registry SHALL 包含 `list_mcp_resources` 与 `read_mcp_resource`
- **THEN** 两个工具 SHALL 复用父运行的共享 MCP manager

#### Scenario: 执行边界拒绝未允许工具
- **WHEN** 子 Agent provider 返回一个不在 allowlist 中的 tool call
- **THEN** 系统 SHALL NOT 执行对应 handler
- **THEN** 系统 SHALL 生成失败 tool result 并允许子 Agent 根据反馈继续或结束

### Requirement: 只读 Subagent 使用定义约束后的 Skill 作用域
内置 Explorer 与自定义 readonly Subagent SHALL 从父运行冻结的 enabled Skill snapshot 派生独立 scoped registry，并 SHALL 应用各自定义的 Skill allowlist。Skill scope SHALL 只影响 catalog 与 `use_skill` 加载，不得改变严格只读 Bash 分类、MCP tools 禁用、文件编辑禁用、提问禁用、Todo 禁用或单层委派限制，也不得扩大或缩小资源读取工具的白名单。并行只读 Subagent SHALL 可共享不可变父 snapshot，但每个运行 SHALL 使用自身定义和模型生成独立 scope 与 catalog 投影。

#### Scenario: 两个并行只读 Agent 使用不同 Skills
- **WHEN** 同一并行段启动两个 readonly Subagent且它们配置不同 Skill allowlist
- **THEN** 每个 provider prompt与`use_skill` handler SHALL 只暴露各自 effective Skill 集合
- **THEN** 两个 scoped registry SHALL NOT 因共享父 snapshot而合并允许名称

#### Scenario: Skill 指令不能放宽 readonly 边界
- **WHEN** Explorer 加载的允许 Skill 要求编辑文件、调用 MCP tools 或再次委派
- **THEN** 对应工具 SHALL 仍不出现在 provider-visible 和 executable registry 中
- **THEN** Skill 正文 SHALL NOT 被解释为授权或改变 Bash 风险分类

#### Scenario: readonly 自定义 Agent 不含 use_skill
- **WHEN** readonly 自定义定义省略 `use_skill` 本地工具但配置缺省或显式 Skill allowlist
- **THEN** 子运行 SHALL 使用空 Skill catalog且 provider schema SHALL 不包含 `use_skill`
- **THEN** 系统 SHALL 保持其余声明的只读工具不变

### Requirement: Explorer 保持现有严格只读策略
新增Worker SHALL NOT改变Explorer的工具allowlist、固定Bash分类(默认父 run 下的人工升级、只读父 run 下的 fail-closed 和生效只读沙箱下的直接执行)、headless fail-closed或不接收父interaction mode的行为。Explorer定义 SHALL继续只包含读取搜索、Bash、只读Web、Skill和MCP资源读取工具，并 SHALL继续禁用Todo、提问、`mcp__` 命名空间的 MCP tools、文件编辑和再次委派。

#### Scenario: Worker 不放宽 Explorer
- **WHEN** Worker已注册且主Agent选择`explorer`
- **THEN** Explorer provider-visible和executable registry SHALL与新增Worker前的严格只读集合同源，仅追加资源读取工具
- **THEN** Explorer非只读Bash在默认父 run 下的interactive/headless行为 SHALL保持不变

#### Scenario: Explorer 的资源读取不继承 MCP tools 可见性
- **WHEN** 父运行声明某 server 提供 MCP tools 与 resources 两者
- **THEN** Explorer SHALL 只能调用资源读取工具
- **THEN** 任何 `mcp__` 工具调用 SHALL 继续在本地执行边界被拒绝


## MODIFIED Requirements

### Requirement: Readonly policy 只允许明确安全的临时操作
Readonly policy SHALL 允许明确列入只读集合的文件读取、glob/grep、网页读取/搜索、skill 加载和 MCP 资源读取工具，并 SHALL 允许只修改当前 BTW 临时 todo state 的 todo 工具。`run_bash_command` SHALL 按生效沙箱分层执行：当该次运行的生效沙箱可用且档位为 `read-only` 时，任意命令 SHALL 直接进入既有 executor，效果由内核沙箱边界约束；否则 SHALL 仅在共享 readonly classifier 明确认可为 inspection command 时执行。`run_subagent` SHALL 仅在调用目标属于该次运行冻结的 readonly 执行策略子代理集合时放行。允许的调用 SHALL 继续使用既有 executor、abort、输出截断和 tool result 语义。

#### Scenario: 执行只读文件检查
- **WHEN** readonly run 收到 `read_files`、`glob` 或 `grep` 的有效 tool call
- **THEN** policy SHALL 允许调用进入普通 executor
- **THEN** result SHALL 保持对应工具既有成功、失败和中断语义

#### Scenario: 沙箱未生效时执行只读 bash inspection
- **WHEN** readonly run 的生效沙箱不是可用 `read-only` 档
- **AND** 收到共享 classifier 认可的只读 bash 命令，例如 `git status --short` 或 `git diff --stat`
- **THEN** policy SHALL 允许普通 bash executor 执行该命令
- **THEN** result SHALL 保持既有 stdout、stderr、exit code、timeout 和 truncation 语义

#### Scenario: 生效只读沙箱下任意 bash 进入执行
- **WHEN** readonly run 的生效沙箱可用且档位为 `read-only`
- **AND** 收到任意 `run_bash_command`，包括严格只读 allowlist 之外的命令
- **THEN** policy SHALL 允许调用直接进入普通 bash executor
- **THEN** 系统 SHALL NOT 请求人工审批或自动审批模型
- **THEN** 命令副作用 SHALL 由内核沙箱边界约束

#### Scenario: 只读运行放行 MCP 资源读取
- **WHEN** readonly run 收到 `list_mcp_resources` 或 `read_mcp_resource` 的有效 tool call
- **THEN** policy SHALL 允许调用进入普通 executor
- **THEN** 系统 SHALL NOT 请求人工审批

#### Scenario: 只读运行仅委派只读子代理
- **WHEN** readonly run 收到 `run_subagent` tool call
- **THEN** 目标属于本轮 readonly 执行策略集合时 policy SHALL 放行
- **THEN** 目标为 general_purpose、未知名称或参数无法解析时 runtime SHALL 返回失败 tool result

#### Scenario: 更新临时 todo
- **WHEN** readonly BTW run 收到有效 todo tool call
- **THEN** runtime SHALL 允许更新该 run 的临时 todo state
- **THEN** 更新 SHALL NOT 写入主 todo state 或主 session journal

### Requirement: 工具调用并发分类
判断工具调用能否与相邻只读调用重叠执行；未知或无法证明只读的调用一律独占。`read_files`、`glob`、`grep`、`web_fetch`、`web_search`、`use_skill`、`list_mcp_resources`、`read_mcp_resource` SHALL 分类为 `parallel_read`。`run_bash_command` SHALL 按严格只读 Bash 策略判定：命中只读 allowlist 为 `parallel_read`，否则 `exclusive`。`run_subagent` SHALL 在调用参数可解析为目标 readonly executionPolicy subagent 时分类为 `parallel_read`；参数 JSON 解析失败、agent 名称未知或目标为 general_purpose 时 SHALL 分类为 `exclusive`。其余工具一律 `exclusive`。分类器 SHALL 通过注入的只读 subagent 名称谓词获取策略，不携带目录依赖。

#### Scenario: 观察工具保持并行分类
- **WHEN** 分类器收到 `grep`、`read_files`、`glob`、`web_fetch`、`web_search` 或 `use_skill` 调用
- **THEN** 分类结果 SHALL 为 `parallel_read`

#### Scenario: 资源读取参与并行分类
- **WHEN** 分类器收到 `list_mcp_resources` 或 `read_mcp_resource` 调用
- **THEN** 分类结果 SHALL 为 `parallel_read`
- **THEN** 连续的资源读取与其它只读调用 SHALL 允许在同一并行段执行

#### Scenario: 只读 Bash 与风险 Bash 分类不变
- **WHEN** 分类器收到只读 allowlist 内外的 `run_bash_command` 调用
- **THEN** 前者 SHALL 为 `parallel_read`，后者 SHALL 为 `exclusive`

#### Scenario: 只读子 Agent 委派并行分类
- **WHEN** 分类器收到 `agent` 参数指向 readonly executionPolicy subagent 的 `run_subagent` 调用
- **THEN** 分类结果 SHALL 为 `parallel_read`

#### Scenario: 未知或解析失败的委派保持独占
- **WHEN** `run_subagent` 参数不是合法 JSON object、`agent` 名称不在目录中，或目标为 general_purpose
- **THEN** 分类结果 SHALL 为 `exclusive`

#### Scenario: 无委派目录的运行保持独占
- **WHEN** 当前运行没有注入 subagent 委派目录
- **THEN** 所有 `run_subagent` 调用 SHALL 分类为 `exclusive`

## ADDED Requirements

### Requirement: 主 Agent 工具选择作用域

系统 SHALL 提供用户级主 Agent 工具选择，作用于 TUI、`--once` 及复用主运行入口的只读旁路运行。选择 SHALL 只控制主运行的工具暴露和调用，不自动改变 subagent 定义、工具上限、Skill scope 或 MCP 可见性。系统 SHALL 明确说明工具选择不是文件、网络或命令权限隔离；用户主动执行的 slash 命令、shell-local、文件选择等本地操作 SHALL 保持原有语义。

#### Scenario: 主运行之间使用相同配置
- **WHEN** TUI 和 `--once` 使用同一配置 revision 及相同可用工具目录创建主运行
- **THEN** 两者 SHALL 使用相同的工具选择结果
- **THEN** 各自的 interactive/headless 审批策略 SHALL 继续独立生效

#### Scenario: 主工具选择不传染给子运行
- **WHEN** 主 Agent 禁用 `read_files`，但保留 `run_subagent` 并委派允许读取文件的子 Agent
- **THEN** 主运行 SHALL 不暴露或执行 `read_files`
- **THEN** 子运行 SHALL 继续按其既有定义及工具策略决定是否暴露 `read_files`
- **THEN** 系统 SHALL NOT 把主运行禁用名单作为子运行的额外 allowlist 或 denylist

#### Scenario: 本地命令不受工具开关误伤
- **WHEN** 主 Agent 禁用 `apply_patch`、`edit_file` 或 `read_files`
- **THEN** 用户主动执行的 `/diff`、`/undo`、文件选择和 shell-local 等本地操作 SHALL 仍按各自原有规则工作
- **THEN** 这些操作 SHALL NOT 因执行成功而重新授予已禁用的模型工具

### Requirement: Bash 始终可用

主运行 SHALL 始终注册 `run_bash_command`；UI、手写配置和工具配置归一化 SHALL NOT 允许将其禁用。该必选约束 SHALL NOT 绕过 Bash 原有审批、readonly、plan、沙箱、timeout 或输出上限规则，也 SHALL NOT 扩展子 Agent 的工具集合。

#### Scenario: UI 中尝试关闭 Bash
- **WHEN** 用户在工具页对 `run_bash_command` 按 Space 或 Enter
- **THEN** 该工具 SHALL 保持开启并显示“必需，不可关闭”或等价提示
- **THEN** 系统 SHALL NOT 因该操作产生未保存修改

#### Scenario: 手写配置将 Bash 列为禁用
- **WHEN** `tools.mainAgent.disabledTools` 包含 `run_bash_command`
- **THEN** 归一化结果 SHALL 排除该名称，新的主运行 SHALL 仍注册 Bash
- **THEN** 工具页显式保存时 SHALL NOT 将 Bash 写入禁用名单

#### Scenario: 仅 Bash 的主运行
- **WHEN** 用户禁用所有其他当前可用工具
- **THEN** 主运行 provider definitions 和 executable registry SHALL 只包含 Bash
- **THEN** Bash 请求越界操作时 SHALL 仍受到现有审批和沙箱限制

### Requirement: 独立的工具禁用名单

系统 SHALL 将主 Agent 工具选择持久化为 `tools.mainAgent.disabledTools` 名称数组，按真实工具名精确匹配，覆盖除 Bash 外所有内置工具及已发现的 MCP tools。`create_todos` 与 `complete_todo` SHALL 作为同一个 Todo 配置项同时启停；其他工具 SHALL 可独立选择，包括 `ask_user_questions`、`use_skill`、`run_subagent`、`list_mcp_resources` 与 `read_mcp_resource`。系统 SHALL 去重并保留未知非空工具名，不支持通配符，不凭工具偏好创建不存在的 handler。字段存在但结构非法时 SHALL 给出明确错误，不得静默开启原本意图禁用的工具。

#### Scenario: 精确关闭工具
- **WHEN** 禁用名单包含 `web_search` 而不包含 `web_fetch`
- **THEN** 主运行 SHALL 不注册 `web_search`，并在其可用时继续注册 `web_fetch`

#### Scenario: MCP 按名称独立关闭
- **WHEN** 一个 server 暴露两个 MCP tools，且用户只禁用其中一个完整 namespace 名称
- **THEN** 主运行 SHALL 只移除该工具，并保留另一个可用工具
- **THEN** 系统 SHALL NOT 因工具开关而关闭 MCP 连接或改变其他运行的 MCP 目录

#### Scenario: 未知及暂不可用的名称
- **WHEN** 禁用名单包含当前未发现的 MCP 名称或未知工具名
- **THEN** 系统 SHALL 保留这些名称而不注册对应 handler
- **THEN** 保存可见工具偏好 SHALL NOT 丢弃这些名称
- **THEN** 后续同名工具变为可用时 SHALL 仍按该禁用偏好处理

#### Scenario: 非法名单明确失败
- **WHEN** `disabledTools` 存在但不是数组，或数组中存在非字符串或空工具名
- **THEN** 工具草稿读取和新的主运行 SHALL 报告可理解的配置错误
- **THEN** 系统 SHALL NOT 将非法字段静默视为缺失名单或空数组
- **THEN** 其他配置 Tab SHALL 仍可按各自读取规则使用

#### Scenario: 新增工具默认开启
- **WHEN** 后续版本新增工具或 MCP 新发现一个工具，且禁用名单未包含其真实名称
- **THEN** 主运行 SHALL 默认启用该工具，但仍要求工具本身满足可用性条件

### Requirement: Todo 工具成对启停

主 Agent 的 `create_todos` 和 `complete_todo` SHALL 共享一个 Todo 开关，默认同时开启，不允许只有其中一个可用。持久化 SHALL 继续使用真实工具名：关闭时禁用名单包含两者，开启时两者均不在名单中。名单仅包含其中一个时，系统 SHALL 将其归一化为两个均禁用，并在工具页显式保存时写入完整的一对。Todo 名单归一化 SHALL NOT 自动写盘。此规则 SHALL 同时作用于工具页状态、TUI 和 headless 主运行的 definitions 及执行入口，不改变 subagent 既有工具策略。

#### Scenario: Todo 默认同时开启
- **WHEN** 主 Agent 禁用名单不包含任一 Todo 工具名
- **THEN** 工具页 SHALL 显示 Todo 开启
- **THEN** 主运行 SHALL 同时注册 `create_todos` 和 `complete_todo`，不注册名为 `todo` 的替代工具

#### Scenario: 关闭和重新开启 Todo
- **WHEN** 用户关闭 Todo 并保存
- **THEN** 禁用名单 SHALL 同时包含 `create_todos` 和 `complete_todo`，下一次主运行 SHALL 不暴露或执行任一工具
- **THEN** 用户重新开启 Todo 并保存时 SHALL 同时移除两个禁用项，下一次主运行 SHALL 同时恢复两个工具

#### Scenario: 手写单项禁用不得产生半启用状态
- **WHEN** 手写名单只包含 `create_todos` 或只包含 `complete_todo`
- **THEN** 归一化结果 SHALL 同时禁用两者，工具页 SHALL 显示 Todo 关闭
- **THEN** TUI 和 headless 新主运行 SHALL 均不暴露或执行任一 Todo 工具
- **THEN** 读取 SHALL 不改写文件，工具页显式保存 SHALL 写入两个真实名称

### Requirement: 双编辑工具独立选择与默认全开

主 Agent SHALL 将 `apply_patch` 和 `edit_file` 作为独立工具，允许同时开启、同时关闭或仅开启一个。`disabledTools` 字段缺失时 SHALL 默认 `[]`，两个编辑工具及其他可用工具默认 SHALL 开启。系统 SHALL 完全停止读取旧 `tools.fileEdit.mode`，不再据此推导任何主／子运行工具选择；内部 `fileEditMode` 与 `includeBothFileEditTools` SHALL 移除。旧 JSON 字段 MAY 作为未识别数据保留，但 SHALL NOT 被主动清理；读取 SHALL NOT 迁移写盘，显式保存 SHALL 只更新本页拥有的字段。

#### Scenario: 缺失名单默认启用全部可用工具
- **WHEN** `tools.mainAgent.disabledTools` 缺失，无论旧编辑模式是否存在及其值
- **THEN** 主 Agent SHALL 启用 `apply_patch`、`edit_file` 及其他可用工具
- **THEN** 系统 SHALL NOT 因读取默认值而修改配置文件

#### Scenario: 旧字段仅作为未识别数据保留
- **WHEN** 配置包含旧 `tools.fileEdit.mode`，且用户读取配置或显式保存工具页
- **THEN** 工具页和主／子运行 SHALL NOT 读取旧 mode 或按其值筛选编辑工具
- **THEN** 读取 SHALL NOT 写盘，显式保存工具页 SHALL 只更新当前主禁用名单并保留旧字段和未知配置，不主动清理旧节点

#### Scenario: 显式空名单启用两个编辑工具
- **WHEN** `disabledTools` 是空数组
- **THEN** 主运行 SHALL 同时注册 `apply_patch` 与 `edit_file`
- **THEN** 缺失名单 SHALL 与显式空数组使用相同的默认结果，旧 mode SHALL NOT 排除其中任何一个

#### Scenario: 同时关闭两个编辑工具
- **WHEN** 禁用名单同时包含 `apply_patch` 与 `edit_file`
- **THEN** 主运行 SHALL 不注册任何文件编辑工具，且 SHALL 继续保留 Bash
- **THEN** 系统 SHALL NOT 自动补回某个编辑工具作为 fallback

### Requirement: 可恢复的工具候选目录

系统 SHALL 保留 `main-agent-tool-catalog` 作为配置页未应用主 Agent 禁用名单的候选目录，工具页 SHALL 据此展示工具，并区分启用偏好和当前可用性。目录 SHALL 包含两个编辑工具、其他内置工具、MCP 资源工具及当前已发现的 MCP tools；离线工具偏好 SHALL 可保留。目录读取 SHALL NOT 为展示列表主动建立 MCP 连接，开启偏好 SHALL NOT 使缺少运行依赖的工具凭空可用。

#### Scenario: 禁用后仍能重新启用
- **WHEN** 用户禁用某工具并保存后重新打开工具页
- **THEN** 该工具 SHALL 仍出现在候选列表中并显示关闭状态
- **THEN** 用户 SHALL 能重新启用并保存它

#### Scenario: 未连接 MCP 时设置资源工具偏好
- **WHEN** 当前没有可用 MCP server
- **THEN** 工具页 SHALL 仍提供资源工具偏好并说明当前不可用
- **THEN** 开启偏好 SHALL NOT 导致主运行注册没有可用依赖的资源工具或触发新连接

#### Scenario: 目录枚举不装配执行依赖
- **WHEN** 工具页列举候选目录
- **THEN** 系统 SHALL 只投影工具名、来源和可用性，不为获取模型 description 创建工具 handler 或扫描 Skill 目录
- **THEN** 目录名称集合 SHALL 与拥有完整依赖时的主运行 registry 保持一致，关闭偏好仍不影响候选展示

### Requirement: 工具定义与执行入口一致

主运行 SHALL 从同一最终 registry 生成 provider definitions 并执行工具。系统 SHALL 在 Todo、提问、委派、风险审批及普通 executor 等执行入口之前检查调用工具是否已注册。禁用或未注册调用 SHALL 返回保留 call id、工具名的 `ok: false` 结果，不产生对应执行副作用；该检查 SHALL 覆盖普通调用和并行调用。审批授权、会话授权缓存及 `--full-access` SHALL NOT 覆盖禁用决定。

#### Scenario: 普通禁用工具的伪造调用
- **WHEN** provider 返回禁用的文件读取、编辑、Web 或 MCP tool call
- **THEN** runtime SHALL 返回对应失败结果供 continuation 消费
- **THEN** 系统 SHALL NOT 执行 handler、change recorder 或请求工具审批

#### Scenario: 特殊工具不能绕过 registry
- **WHEN** provider 返回禁用的 `create_todos`、`complete_todo`、`ask_user_questions` 或 `run_subagent` 调用
- **THEN** runtime SHALL 在特殊执行分支之前拒绝调用
- **THEN** 系统 SHALL NOT 修改 Todo、打开用户问题、请求审批或创建子运行

#### Scenario: Full-access 不重新启用工具
- **WHEN** headless 主运行使用 `--full-access`，且 provider 请求一个被禁用的工具
- **THEN** 系统 SHALL 仍返回失败结果且不执行该工具

### Requirement: 工具选择的运行快照与刷新

每次主运行 SHALL 从同一配置 snapshot 和工具可用目录冻结一次最终工具集合。配置保存或 watcher 更新 SHALL 仅影响后续运行，当前运行的 continuation、已启动工具和子运行 SHALL 保持原工具集合。TUI SHALL 通过既有共享刷新链路安装新 snapshot，不为工具偏好重复读盘；实际 schema 变化 SHALL 使旧 context usage 失效，但 SHALL NOT 改写历史 tool records、追加设置 transcript 或触发不必要的完整 transcript 重绘。

#### Scenario: 运行期间更新配置
- **WHEN** 主运行已创建 registry 后工具偏好发生变化
- **THEN** 当前运行所有 continuation SHALL 使用原 definitions 和 registry
- **THEN** 下一次运行 SHALL 使用新偏好创建 definitions 和 registry

#### Scenario: 保存引起 schema 变化
- **WHEN** 工具页保存改变了下一轮实际暴露的工具集合
- **THEN** 系统 SHALL 清理旧 context usage 快照
- **THEN** 历史 tool call/result records SHALL 保留，且 SHALL NOT 为配置变化追加 transcript record

### Requirement: 工具开关不覆盖其他执行策略

工具被启用仅 SHALL 表示它具备进入后续执行策略的资格，不代表自动授权。normal、plan 和 readonly 运行 SHALL 在同一主工具配置及可用目录下使用同一组工具选择，再叠加各自执行限制。提示材料 SHALL 不把已禁用工具宣传为当前可调用；禁用 `use_skill` 时 SHALL 停止自动注入要求模型使用它的 Skill 目录，同时保留独立子运行所需的父 Skill snapshot。

#### Scenario: 编辑工具开启但处于 plan
- **WHEN** `apply_patch` 和 `edit_file` 均开启，且主运行处于 plan
- **THEN** definitions SHALL 与同配置 normal 运行一致
- **THEN** 两个编辑工具的调用 SHALL 均受现有 plan 写入拒绝规则约束

#### Scenario: 禁用主运行 Skill 加载
- **WHEN** 主 Agent 禁用 `use_skill`，而允许委派的子 Agent 仍拥有该工具
- **THEN** 主运行 SHALL 不自动公布要求调用 `use_skill` 的 Skill 目录，且不得执行该工具
- **THEN** 子运行 SHALL 仍按父 Skill snapshot 和自身 allowlist 派生独立 Skill scope

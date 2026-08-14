# agents-command Specification

## Purpose
TBD - created by syncing change add-agents-command. Update Purpose after archive.
## Requirements
### Requirement: `/agents` 提供按来源组织的 Agent 管理入口
系统 SHALL 注册 `/agents` command，并使用独立 command session 与 `agents` footer surface 展示 `Overview`、`Project`、`User` 和 `Built-in` 范围。Overview SHALL 投影下一 primary assistant run 候选的有效 Agent 与关键诊断；Project 与 User SHALL 分别展示对应物理目录中的全部直接 Markdown 候选；Built-in SHALL 展示固定内置定义及其生效模型策略。每个条目 SHALL 显示名称、来源、有效状态、capability、模型策略、effort 策略、工具数量、MCP 状态和 description 或诊断中的可用信息。

#### Scenario: 打开 Agent 管理界面
- **WHEN** 用户在没有 active assistant turn 时提交 `/agents`
- **THEN** 系统 SHALL 打开 Overview 范围并聚焦第一个可选择条目
- **THEN** surface SHALL 替换普通 composer，且不得切换到 alternate screen

#### Scenario: 查看同名来源覆盖
- **WHEN** User 与 Project 范围都存在同名合法自定义 Agent
- **THEN** Overview SHALL 把项目级定义标记为 active
- **THEN** User 范围 SHALL 继续显示用户级物理文件并标记其被项目级定义覆盖，而不是将其隐藏

#### Scenario: 查看无效物理文件
- **WHEN** 用户级或项目级目录包含无法解析、引用无效模型或使用保留名称的 Agent 文件
- **THEN** 对应来源范围 SHALL 显示该物理项、来源路径与不包含正文或凭据的有界诊断
- **THEN** Overview SHALL NOT 将该项显示为可执行 Agent

#### Scenario: active assistant turn 阻止管理命令
- **WHEN** primary assistant turn 仍处于 active 状态且用户尝试启动 `/agents`
- **THEN** command runtime SHALL 沿用普通管理命令的互斥规则，不打开可修改 Agent 文件的 surface

### Requirement: 管理操作通过可见选项和 Enter 激活
`/agents` SHALL 把新建、配置、保存、删除和移除 override 表达为列表或详情中的可聚焦选项。用户 SHALL 使用方向键移动焦点并使用 Enter 激活选项；系统 SHALL NOT 使用 `a`、`d`、`e` 或其他字符快捷键直接触发创建、删除或编辑。Esc SHALL 按“字段编辑 → 确认视图 → 详情/表单 → 范围列表 → 关闭 command”的层级取消或返回。

#### Scenario: 从 Project 列表选择新建
- **WHEN** Project 范围处于列表状态
- **THEN** 列表 SHALL 包含可聚焦的“新建 Agent…”选项
- **THEN** 用户选中该选项并按 Enter 后系统 SHALL 打开项目级创建表单

#### Scenario: 字符键不触发变更动作
- **WHEN** 用户在 Agent 列表或详情中输入 `a`、`d` 或 `e`
- **THEN** 系统 SHALL NOT 因该字符创建、删除或编辑 Agent
- **THEN** surface SHALL 继续等待方向键和 Enter 驱动的可见选项

#### Scenario: Esc 逐层取消
- **WHEN** 用户正在 instructions 字段编辑、创建确认或详情页面中按 Esc
- **THEN** 系统 SHALL 只退出当前最内层状态且不执行持久化
- **THEN** 只有在范围列表再次按 Esc 才 SHALL 关闭 `/agents`

### Requirement: 自定义 Agent 表单管理全部受支持字段
Project 与 User 创建/编辑表单 SHALL 管理 name、description、capability、model、effort、local tools、MCP 和 Markdown instructions。创建时 name SHALL 可编辑且必须通过稳定名称校验；已有 Agent 的 name SHALL 只读且本变更 SHALL NOT提供 rename。模型选项 SHALL 包含继承父模型及当前用户配置中的有效 profile；effort SHALL 包含继承父 effort、使用目标模型默认值和全部固定 effort 枚举。工具选项 SHALL 仅来自当前 capability ceiling，readonly SHALL 禁止 MCP。

#### Scenario: 创建通用 Agent 草稿
- **WHEN** 用户进入自定义 Agent 创建表单并选择 `general`
- **THEN** 系统 SHALL 只展示 General capability 允许的本地工具和 MCP 开关
- **THEN** 用户 SHALL 能进入独立 instructions 编辑视图并使用 Ctrl+J 插入换行

#### Scenario: capability 收窄为 readonly
- **WHEN** 草稿从 general 切换为 readonly 且已选择写入工具或 MCP
- **THEN** surface SHALL 明确标记不再允许的选择并要求在保存前移除，且 MCP SHALL 被关闭
- **THEN** 存储端 SHALL 再次执行相同 capability 校验，不能仅信任 surface 投影

#### Scenario: 编辑已有合法定义
- **WHEN** 用户在来源列表中选择合法自定义 Agent 并按 Enter 打开详情
- **THEN** 详情 SHALL 提供可聚焦的“编辑配置…”或字段选项以及“保存更改…”选项
- **THEN** 保存后的规范化 manifest SHALL 表达表单中的全部字段与 instructions

#### Scenario: 无效文件不被表单静默覆盖
- **WHEN** 物理 Agent 文件不能解析为完整结构化草稿
- **THEN** 详情 SHALL 展示诊断和删除选项，但 SHALL NOT提供会静默丢弃未知内容的普通编辑表单

### Requirement: 创建和删除必须经过显式确认
创建表单 SHALL 提供可聚焦的“创建 Agent…”选项，删除详情 SHALL 提供可聚焦的“删除 Agent…”选项。激活任一选项后系统 SHALL 打开包含“取消”和明确目标动作的确认视图，默认聚焦“取消”；只有用户移动到目标动作并按 Enter 后，系统才 SHALL执行创建或删除。删除确认 SHALL 说明目标 scope、路径以及删除后会重新生效的同名低优先级定义。

#### Scenario: 确认创建 Agent
- **WHEN** 用户完成合法创建表单并选中“创建 Agent…”后按 Enter
- **THEN** 系统 SHALL 打开默认聚焦“取消”的确认视图并显示将创建的 scope、名称与路径
- **THEN** 只有用户选中明确创建动作并再次按 Enter 才 SHALL 写入文件

#### Scenario: 取消创建
- **WHEN** 创建确认视图活跃且用户按 Esc或在“取消”选项上按 Enter
- **THEN** 系统 SHALL 返回创建表单并保留草稿
- **THEN** 目标目录 SHALL 保持不变

#### Scenario: 确认删除覆盖定义
- **WHEN** 用户准备删除项目级 Agent，且存在同名合法用户级 Agent
- **THEN** 确认视图 SHALL 提示删除后用户级定义将在后续 primary assistant run 重新生效
- **THEN** 只有用户选中明确删除动作并按 Enter 才 SHALL 删除项目级文件

### Requirement: 内置 Agent 仅开放模型策略
Built-in 范围 SHALL 保持 `explorer` 与 `worker` 的名称、description、prompt、capability、本地工具、MCP 可见性和执行策略只读。详情 SHALL 显示 effective 策略，并只提供可聚焦的项目级策略配置和用户级策略配置选项；策略表单只允许 model 与 effort。移除已有 override SHALL 使用可见选项并经过与删除相同的确认流程。

#### Scenario: 配置 Explorer 项目模型
- **WHEN** 用户在 Explorer 详情选择“配置项目级策略…”并完成模型/effort 表单
- **THEN** 系统 SHALL 只更新项目级内置 override settings
- **THEN** Explorer 的只读工具、MCP 禁用和固定 prompt SHALL 保持不变

#### Scenario: 尝试编辑内置安全字段
- **WHEN** 用户查看任一 Built-in Agent 详情
- **THEN** surface SHALL NOT提供编辑 description、instructions、capability、tools 或 MCP 的选项

### Requirement: Agent 管理写入报告冲突与生效时机
创建、更新、删除和 override 写入 SHALL 通过受控 command port 返回结构化成功、校验失败、冲突或 I/O 错误。成功后 command SHALL 重新扫描管理视图，并提示变更只在下一次 primary assistant run 生效；系统 SHALL NOT修改当前 active 或已经冻结的 Subagent catalog。冲突或失败 SHALL 保留当前表单/详情和磁盘原内容。

#### Scenario: 外部修改导致更新冲突
- **WHEN** 用户打开 Agent 后目标文件在保存前被其他进程修改
- **THEN** 更新 SHALL 因内容指纹不匹配而失败，并提示用户重新加载
- **THEN** 系统 SHALL NOT覆盖外部修改，且 SHALL 保留当前草稿供用户查看

#### Scenario: 保存成功后下一轮生效
- **WHEN** 用户确认创建、保存或删除且存储操作成功
- **THEN** surface SHALL 显示“将在下一次 assistant turn 生效”的反馈并刷新列表
- **THEN** 已经启动的 primary run 的 `run_subagent` schema 与定义 SHALL 保持其原冻结快照

#### Scenario: 创建目标已存在
- **WHEN** 确认创建时目标名称的文件已经存在
- **THEN** 存储 SHALL 返回冲突且 SHALL NOT覆盖现有文件
- **THEN** 创建表单 SHALL 保留用户草稿

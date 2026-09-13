## MODIFIED Requirements

### Requirement: `/agents` 提供按来源组织的 Agent 管理入口
系统 SHALL 注册 `/agents` command，并使用独立 command session 与 `agents` footer surface 展示 `Overview`、`Project`、`User` 和 `Built-in` 范围。Overview SHALL 投影下一 primary assistant run 候选的有效 Agent 与关键诊断；Project 与 User SHALL 分别展示对应物理目录中的全部直接 Markdown 候选；Built-in SHALL 展示固定内置定义及其生效模型与 Skill 策略。每个条目 SHALL 显示名称、来源、有效状态、capability、模型策略、effort 策略、工具数量、Skill 策略摘要、MCP 状态和 description 或诊断中的可用信息。

#### Scenario: 打开 Agent 管理界面
- **WHEN** 用户在没有 active assistant turn 时提交 `/agents`
- **THEN** 系统 SHALL 打开 Overview 范围并聚焦第一个可选择条目
- **THEN** surface SHALL 替换普通 composer，且不得切换到 alternate screen

#### Scenario: 查看同名来源覆盖
- **WHEN** User 与 Project 范围都存在同名合法自定义 Agent
- **THEN** Overview SHALL 把项目级定义标记为 active
- **THEN** User 范围 SHALL 继续显示用户级物理文件并标记其被项目级定义覆盖，而不是将其隐藏

#### Scenario: 查看 Agent Skill 摘要
- **WHEN** `/agents` 列表包含分别使用缺省、空和非空 Skill allowlist 的 Agent
- **THEN** 对应条目 SHALL 可区分显示全部 enabled Skills、无 Skills和已配置数量
- **THEN** 摘要 SHALL NOT 把暂时不可用的配置名称误报为当前 effective 数量

#### Scenario: 查看无效物理文件
- **WHEN** 用户级或项目级目录包含无法解析、引用无效模型或使用保留名称的 Agent 文件
- **THEN** 对应来源范围 SHALL 显示该物理项、来源路径与不包含正文或凭据的有界诊断
- **THEN** Overview SHALL NOT 将该项显示为可执行 Agent

#### Scenario: active assistant turn 阻止管理命令
- **WHEN** primary assistant turn 仍处于 active 状态且用户尝试启动 `/agents`
- **THEN** command runtime SHALL 沿用普通管理命令的互斥规则，不打开可修改 Agent 文件的 surface

### Requirement: 自定义 Agent 表单管理全部受支持字段
Project 与 User 创建/编辑表单 SHALL 管理 name、description、capability、model、effort、local tools、Skill allowlist、MCP 和 Markdown instructions。创建时 name SHALL 可编辑且必须通过稳定名称校验；已有 Agent 的 name SHALL 只读且本变更 SHALL NOT 提供 rename。模型选项 SHALL 包含继承父模型及当前用户配置中的有效 profile；effort SHALL 包含继承父 effort、使用目标模型默认值和全部固定 effort 枚举。工具选项 SHALL 仅来自当前 capability ceiling，readonly SHALL 禁止 MCP。Skill 字段 SHALL 支持全部 enabled Skills、明确空集合和名称多选三种状态，并 SHALL 保留已配置但当前 missing 或 disabled 的名称直到用户明确移除。

#### Scenario: 创建通用 Agent 草稿
- **WHEN** 用户进入自定义 Agent 创建表单并选择 `general`
- **THEN** 系统 SHALL 只展示 General capability 允许的本地工具和 MCP 开关，并提供独立 Skill 策略入口
- **THEN** 用户 SHALL 能进入独立 instructions 编辑视图并使用 Ctrl+J 插入换行

#### Scenario: 选择指定 Skills
- **WHEN** 用户关闭“全部 enabled Skills”并在 Skills 多选层选择两个当前 enabled Skill
- **THEN** 返回表单后 Skill 字段 SHALL 显示指定 allowlist 摘要
- **THEN** 保存后的规范化 manifest SHALL 只在 `skills` 序列中包含这两个名称

#### Scenario: 配置空 Skill allowlist
- **WHEN** 用户关闭“全部 enabled Skills”并清空全部 Skill 选择
- **THEN** 表单 SHALL 明确显示“无 Skills”而不是恢复缺省策略
- **THEN** 保存和再次打开 SHALL 保留显式空 allowlist

#### Scenario: 保留不可用 Skill 名称
- **WHEN** 已有 Agent 配置的 Skill 当前 missing 或 disabled且用户打开编辑表单
- **THEN** Skills 层 SHALL 标记并保留该已配置名称，用户可明确取消选择
- **THEN** 未进入或未修改该字段直接保存 SHALL NOT 静默删除该名称

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
- **THEN** 详情 SHALL 展示诊断和删除选项，但 SHALL NOT 提供会静默丢弃未知内容的普通编辑表单

### Requirement: 内置 Agent 仅开放模型策略
Built-in 范围 SHALL 保持 `explorer` 与 `worker` 的名称、description、prompt、capability、本地工具、MCP 可见性和执行策略只读。详情 SHALL 显示 effective 模型、effort 与 Skill 策略，并只提供可聚焦的项目级策略配置和用户级策略配置选项；策略表单 SHALL 只允许 model、effort 与 Skill allowlist。移除已有 override SHALL 使用可见选项并经过与删除相同的确认流程。

#### Scenario: 配置 Explorer 项目模型与 Skills
- **WHEN** 用户在 Explorer 详情选择“配置项目级策略…”并完成 model、effort 与 Skill 表单
- **THEN** 系统 SHALL 只更新项目级内置 override settings
- **THEN** Explorer 的只读工具、MCP 禁用和固定 prompt SHALL 保持不变

#### Scenario: 为 Worker 禁止所有 Skills
- **WHEN** 用户在 Worker 内置策略表单选择明确空 Skill allowlist并保存
- **THEN** 项目级或用户级 override SHALL 持久化空 Skill 序列
- **THEN** 下一 primary run 的 Worker SHALL 保留 `use_skill` 工具但拥有空 effective Skill catalog

#### Scenario: 尝试编辑内置安全字段
- **WHEN** 用户查看任一 Built-in Agent 详情
- **THEN** surface SHALL NOT 提供编辑 description、instructions、capability、tools 或 MCP 的选项

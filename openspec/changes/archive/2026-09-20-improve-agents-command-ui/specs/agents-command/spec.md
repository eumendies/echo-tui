## MODIFIED Requirements

### Requirement: `/agents` 提供按来源组织的 Agent 管理入口
系统 SHALL 注册 `/agents` command，并使用独立 command session 与 `agents` footer surface 展示内部范围 ID 为 `overview`、`project`、`user` 和 `builtin` 的“总览”“项目”“用户”“内置”范围。总览 SHALL 投影下一 primary assistant run 候选的有效 Agent 与关键诊断；项目与用户范围 SHALL 分别展示对应物理目录中的全部直接 Markdown 候选；内置范围 SHALL 展示固定内置定义及其生效模型与 Skill 策略。每个 Agent 列表条目 SHALL 优先显示名称、来源、有效状态与 capability；当前选中项的结构化摘要 SHALL 显示模型策略、effort 策略、工具数量、Skill 策略摘要、MCP 状态以及 description、来源路径或诊断中的可用信息，从而不要求把全部字段压缩在同一列表行中。

#### Scenario: 打开 Agent 管理界面
- **WHEN** 用户在没有 active assistant turn 时提交 `/agents`
- **THEN** 系统 SHALL 打开总览范围并聚焦第一个可选择条目
- **THEN** surface SHALL 替换普通 composer，且不得切换到 alternate screen
- **THEN** 当前选中 Agent 的摘要 SHALL 与列表同时可见，或在高度受限时保留明确的详情入口

#### Scenario: 查看同名来源覆盖
- **WHEN** 用户与项目范围都存在同名合法自定义 Agent
- **THEN** 总览 SHALL 把项目级定义标记为生效
- **THEN** 用户范围 SHALL 继续显示用户级物理文件并将其标记为被项目级定义覆盖，而不是将其隐藏
- **THEN** 选中该用户级条目时摘要 SHALL 说明覆盖状态及可用诊断

#### Scenario: 查看 Agent Skill 摘要
- **WHEN** `/agents` 列表包含分别使用缺省、空和非空 Skill allowlist 的 Agent
- **THEN** 对应选中项摘要 SHALL 可区分显示全部 enabled Skills、无 Skills 和已配置数量
- **THEN** 摘要 SHALL NOT 把暂时不可用的配置名称误报为当前 effective 数量

#### Scenario: 查看无效物理文件
- **WHEN** 用户级或项目级目录包含无法解析、引用无效模型或使用保留名称的 Agent 文件
- **THEN** 对应来源范围 SHALL 显示该物理项，并使用区别于生效 Agent 的异常状态
- **THEN** 选中该物理项时摘要 SHALL 显示来源路径与不包含正文或凭据的有界诊断
- **THEN** 总览 SHALL NOT 将该项显示为可执行 Agent

#### Scenario: active assistant turn 阻止管理命令
- **WHEN** primary assistant turn 仍处于 active 状态且用户尝试启动 `/agents`
- **THEN** command runtime SHALL 沿用普通管理命令的互斥规则，不打开可修改 Agent 文件的 surface

## ADDED Requirements

### Requirement: Agent 列表与选中项摘要使用响应式信息层级
`/agents` 的列表模式 SHALL 从同一 command surface 投影 Agent 列表、当前选中项摘要和范围统计。宽终端 SHALL 使用列表与摘要左右分栏；窄终端 SHALL 使用列表在上、摘要在下的堆叠布局。两种布局 SHALL 使用相同的 rows、selectedIndex 和摘要数据，并 SHALL 在终端 resize 后保持当前焦点、草稿和命令层级。所有布局 SHALL 遵守 footer 的 `maxLines` 与安全渲染宽度，不得写入终端最后一列或切换 alternate screen。

#### Scenario: 宽终端显示主从分栏
- **WHEN** `/agents` 列表运行在满足宽屏断点的终端中
- **THEN** 当前范围的 Agent 窗口 SHALL 显示在左栏
- **THEN** 当前选中项的身份、策略、权限、描述或诊断 SHALL 显示在右栏
- **THEN** 左右栏 SHALL 保持可辨识的间隔或分隔符，长文本 SHALL 在各自栏宽内安全裁剪

#### Scenario: 窄终端显示上下布局
- **WHEN** `/agents` 列表运行在低于宽屏断点的终端中
- **THEN** 系统 SHALL 在 Agent 窗口下方显示带有明确分隔标题的当前选中项摘要
- **THEN** 列表行 SHALL NOT 重新拼接 model、effort、工具、Skills、MCP 与 description 的完整长串
- **THEN** 当前选中行和至少包含名称、状态的核心摘要 SHALL 保持可见

#### Scenario: resize 保持选择
- **WHEN** 用户选中一个 Agent 后把终端从宽屏调整为窄屏或从窄屏调整为宽屏
- **THEN** renderer SHALL 切换分栏或堆叠投影
- **THEN** command session 的 activeTab、selectedIndex、编辑草稿和当前层级 SHALL 保持不变

#### Scenario: 高度不足时优先保留焦点
- **WHEN** footer 可用行数不足以同时展示完整列表窗口和全部摘要文本
- **THEN** surface SHALL 保留当前选中行与核心摘要
- **THEN** description、路径或附加诊断 SHALL 被安全裁剪或使用更多提示，而不是突破 `maxLines`
- **THEN** 用户 SHALL 仍可按 Enter 进入既有详情层级查看可用完整信息

### Requirement: Agent 状态与范围统计具有一致的可见语义
`/agents` SHALL 为生效、被覆盖、无效、保留和未配置等状态提供稳定的短文本标签，并 MAY 使用符号和主题颜色作为冗余提示，但 SHALL NOT 仅依赖颜色表达状态。列表 SHALL 显示当前范围的有界统计摘要；未知状态 SHALL 显示经过终端控制字符清理的原始状态文本，而不得被误报为已知状态。诊断行、Agent 行和动作行 SHALL 保持可辨识的视觉角色。

#### Scenario: 同时展示多种状态
- **WHEN** 当前范围同时包含 active、shadowed、invalid 或 reserved 条目
- **THEN** 每个条目 SHALL 显示可区分的短文本状态
- **THEN** 顶部统计 SHALL 区分正常条目与异常条目
- **THEN** 状态符号缺失或终端颜色不可用时，文本标签仍 SHALL 足以辨识状态

#### Scenario: 展示未知状态
- **WHEN** surface 收到 renderer 尚未显式映射的状态值
- **THEN** renderer SHALL 安全显示该状态的有界文本
- **THEN** renderer SHALL NOT 将其标记为生效、被覆盖或其他不相符的已知状态

#### Scenario: 选择动作行
- **WHEN** 用户在项目或用户列表中选中“新建 Agent”动作
- **THEN** 摘要区域 SHALL 展示该动作的 scope 与说明，或显示明确的动作提示
- **THEN** 摘要区域 SHALL NOT 继续展示先前选中 Agent 的策略

### Requirement: Agent 详情与表单按语义分区
`/agents` 的详情、自定义 Agent 表单和内置策略表单 SHALL 使用不参与焦点索引的可见分区标题组织字段和动作。适用页面 SHALL 按内容使用“身份”“运行策略”“能力与权限”“操作”等分区；保存、取消、配置和删除等动作 SHALL 与只读字段或策略字段分离，危险动作 SHALL 使用区别于普通动作的语气。分区 SHALL NOT 改变现有方向键、Enter、Esc、确认或字段编辑语义。

#### Scenario: 查看内置 Agent 详情分区
- **WHEN** 用户打开一个内置 Agent 的详情
- **THEN** description 与 capability SHALL 出现在身份或能力相关分区
- **THEN** policy、model、effort 与 Skills 来源 SHALL 出现在运行策略分区
- **THEN** 项目级和用户级策略配置 SHALL 出现在操作分区

#### Scenario: 编辑自定义 Agent 表单分区
- **WHEN** 用户创建或编辑自定义 Agent
- **THEN** name 与 description SHALL 归入身份分区
- **THEN** model 与 effort SHALL 归入运行策略分区
- **THEN** capability、tools、Skills、MCP 与 instructions SHALL 归入能力与权限分区
- **THEN** 保存和取消 SHALL 归入操作分区，且字段顺序与 controller 的可聚焦顺序保持确定

#### Scenario: 危险操作与普通操作区分
- **WHEN** 详情或策略表单同时提供普通保存、配置、取消和删除或移除 override 动作
- **THEN** 删除或移除 override SHALL 使用危险语气并保持其既有二次确认
- **THEN** 分区标题与危险语气 SHALL NOT 成为额外可聚焦行

#### Scenario: 分区窗口保持编辑焦点
- **WHEN** 表单因终端高度受限而只显示部分字段和分区标题
- **THEN** 当前选中或正在编辑的字段 SHALL 保持可见
- **THEN** 真实终端光标 SHALL 继续落在对应编辑值内
- **THEN** 分区标题占用的显示行 SHALL 计入 `maxLines` 预算

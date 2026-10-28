## MODIFIED Requirements

### Requirement: `/agents` 提供按来源组织的 Agent 管理入口
系统 SHALL 注册 `/agents` command，并使用独立 command session 与 `agents` footer surface 展示内部范围 ID 为 `overview`、`project`、`user` 和 `builtin` 的“总览”“项目”“用户”“内置”范围。总览 SHALL 投影下一 primary assistant run 候选的有效定义与关键诊断，包含被停用的胜出定义而非只展示可执行目录；项目与用户范围 SHALL 分别展示对应物理目录中的全部直接 Markdown 候选；内置范围 SHALL 展示固定内置定义及其生效模型与 Skill 策略。每个 Agent 列表条目 SHALL 优先显示名称、来源、有效状态、启用/停用状态与 capability；当前选中项的结构化摘要 SHALL 显示模型策略、effort 策略、工具数量、Skill 策略摘要、MCP 状态以及 description、来源路径或诊断中的可用信息，从而不要求把全部字段压缩在同一列表行中。

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

#### Scenario: 停用项仍可管理
- **WHEN** 用户全局停用 Explorer 或一个有效自定义 Agent 后重新打开总览
- **THEN** 该定义 SHALL 仍可选择并查看详情，且 SHALL 明确标记停用，而不是消失或标记为无效

### Requirement: 内置 Agent 仅开放模型策略
Built-in 范围 SHALL 保持 `explorer` 与 `worker` 的名称、description、prompt、capability、本地工具、MCP 可见性和执行策略只读。详情 SHALL 显示 effective 模型、effort 与 Skill 策略，并 SHALL 显示这些策略当前来自用户级 override、项目级 override 还是父策略继承；已声明但因引用失效而未生效的 override SHALL 显示为未生效，且 SHALL NOT 显示为当前策略。详情 SHALL 提供可聚焦的项目级策略配置和用户级策略配置选项，并 SHALL 在选项上标注该 scope 当前是生效、被更高优先级整体覆盖还是未配置。策略表单的模型策略字段 SHALL 只允许 model、effort 与 Skill allowlist，并 SHALL 在保存前说明当前生效来源以及本 scope 保存后是否立即生效。移除已有 override SHALL 使用可见选项并经过与删除相同的确认流程。除上述模型策略外，一级详情菜单 SHALL 直接提供一个“全局启用”开关及同层保存/取消；模型策略子表单 SHALL 独立保存，开关 SHALL NOT 改变内置安全字段。

#### Scenario: 配置 Explorer 项目模型与 Skills
- **WHEN** 用户在 Explorer 详情选择“配置项目级策略…”并完成 model、effort 与 Skill 表单
- **THEN** 系统 SHALL 只更新项目级内置 override settings，一级详情中未保存的开关 SHALL 保持草稿且不顺带提交
- **THEN** Explorer 的只读工具、MCP 禁用和固定 prompt SHALL 保持不变

#### Scenario: 为 Worker 禁止所有 Skills
- **WHEN** Worker 有效启用，且用户在 Worker 内置策略表单选择明确空 Skill allowlist并保存
- **THEN** 项目级或用户级 override SHALL 持久化空 Skill 序列
- **THEN** 下一 primary run 的 Worker SHALL 保留 `use_skill` 工具但拥有空 effective Skill catalog

#### Scenario: 尝试编辑内置安全字段
- **WHEN** 用户查看任一 Built-in Agent 详情
- **THEN** surface SHALL NOT 提供编辑 description、instructions、capability、tools 或 MCP 的选项

#### Scenario: 查看内置 Agent 的生效来源
- **WHEN** 用户打开存在合法项目级 override 的内置 Agent 详情
- **THEN** 详情 SHALL 显示项目级 override 生效及其 sidecar 路径
- **THEN** 由该 override 覆盖的 model、effort 或 Skill 值 SHALL 与父策略继承值可区分
- **THEN** 用户级策略配置选项 SHALL 标注其被项目级整体覆盖

#### Scenario: 已声明的 override 未生效
- **WHEN** 生效来源中的内置 override 引用了当前配置快照中不存在的 model profile
- **THEN** 详情 SHALL 显示该 override 已声明但未生效及其原因，且 SHALL NOT 把该来源显示为当前生效策略
- **THEN** model、effort 与 Skill 策略 SHALL 显示为完整继承父策略

#### Scenario: 策略表单提示本 scope 是否生效
- **WHEN** 用户级 override 生效时用户打开同一内置 Agent 的项目级策略表单
- **THEN** 策略表单 SHALL 显示当前生效来源，并说明保存本项目级策略后将整体覆盖该来源

#### Scenario: 显式保存完整继承的项目策略
- **WHEN** 用户级策略生效且项目未配置，用户在项目策略表单保留缺省值并明确保存
- **THEN** 系统 SHALL 写入继承父策略的完整项目 override，整体遮蔽用户策略，不得当作无变化跳过
- **THEN** 仅实际写入成功 SHALL 报告已保存；未修改定义的无写入返回 SHALL NOT 伪报已保存

#### Scenario: 无效来源不进入策略表单
- **WHEN** 用户尝试打开结构无效或无法安全读取的来源策略
- **THEN** 系统 SHALL 留在详情入口并报告有界错误，不提供无法修改的只读策略表单或保存成功反馈
- **THEN** 其他合法来源的管理及全局开关 SHALL 仍按各自有效性工作

### Requirement: Agent 管理写入报告冲突与生效时机
创建、更新、删除、override 写入及全局启停设置/移除 SHALL 通过受控 command port 返回结构化成功、校验失败、冲突或 I/O 错误。成功后 command SHALL 重新扫描管理视图，并提示变更只在下一次 primary assistant run 生效；系统 SHALL NOT修改当前 active 或已经冻结的 Subagent catalog。冲突或失败 SHALL 保留当前表单/详情和磁盘原内容。

#### Scenario: 外部修改导致更新冲突
- **WHEN** 用户打开 Agent 后目标文件在保存前被其他进程修改
- **THEN** 更新 SHALL 因内容指纹不匹配而失败，并提示用户重新加载
- **THEN** 系统 SHALL NOT覆盖外部修改，且 SHALL 保留当前草稿供用户查看

#### Scenario: 保存成功后下一轮生效
- **WHEN** 用户确认创建、保存、删除或显式保存启停设置且存储操作成功
- **THEN** surface SHALL 显示“将在下一次 assistant turn 生效”的反馈并刷新管理视图，保存开关或编辑子表单后 SHALL 留在同一 Agent 一级详情
- **THEN** 已经启动的 primary run 的 `run_subagent` schema 与定义 SHALL 保持其原冻结快照

#### Scenario: 创建目标已存在
- **WHEN** 确认创建时目标名称的文件已经存在
- **THEN** 存储 SHALL 返回冲突且 SHALL NOT覆盖现有文件
- **THEN** 创建表单 SHALL 保留用户草稿

### Requirement: Agent 状态与范围统计具有一致的可见语义
`/agents` SHALL 为生效、被覆盖、无效、保留和未配置等状态提供稳定的短文本标签，并 MAY 使用符号和主题颜色作为冗余提示，但 SHALL NOT 仅依赖颜色表达状态。启用/停用 SHALL 作为独立于定义有效性和覆盖状态的维度展示，不得用 `active` 代替启用。列表 SHALL 显示当前范围的有界统计摘要，区分启用且有效的候选、停用与异常数量，不将正常停用计为异常；候选数量 SHALL NOT 被称为当前可调用数量，主工具配置关闭 `run_subagent` 时 SHALL 额外提示“委派工具已关闭”。全局 settings 来源异常时，所有范围、详情和编辑表单 SHALL 将全局启停结果显示为不可用，不报告已启用或已停用的有效数量，改为展示异常说明与诊断数量；未知状态 SHALL 显示经过终端控制字符清理的原始状态文本，而不得被误报为已知状态。诊断行、Agent 行和动作行 SHALL 保持可辨识的视觉角色。

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

#### Scenario: 停用与被覆盖同时存在
- **WHEN** 用户级物理定义被项目级同名定义覆盖，且该名称全局停用
- **THEN** 来源列表 SHALL 同时表达被覆盖与停用，不得显示为可执行或无效

#### Scenario: 主委派工具关闭不虚报可调用
- **WHEN** 两个 Agent 启用且有效，但主工具配置禁用 `run_subagent`
- **THEN** 界面 SHALL 可统计两个启用有效候选，并 SHALL 额外说明委派工具已关闭，不得报告两个当前可调用 Agent

#### Scenario: 主工具配置异常不阻断管理
- **WHEN** 主工具配置 selector 无法读取或校验失败，而 Agent 定义与启停设置正常
- **THEN** `/agents` SHALL 保持可列举及管理，委派工具状态 SHALL 标为不可用而非猜测开启或关闭
- **THEN** 系统 SHALL 使用固定有界诊断，不回显异常中可能包含的配置内容

#### Scenario: 全局 settings 异常显示委派不可用
- **WHEN** 全局 settings 来源结构无效或无法安全读取
- **THEN** 总览、项目、用户、内置范围及详情/编辑表单 SHALL 保留可展示的定义与有界诊断，说明配置异常导致委派不可用，将全局启停结果标记为不可用，而不是默认启用或普通停用
- **THEN** 全局开关保存入口 SHALL 不可用，合法模型策略及定义管理 SHALL 按各自来源状态工作

### Requirement: 创建和删除必须经过显式确认
创建表单 SHALL 提供可聚焦的“创建 Agent…”选项，删除详情 SHALL 提供可聚焦的“删除 Agent…”选项。激活任一选项后系统 SHALL 打开仅包含“取消”和明确目标动作的两项确认视图，默认聚焦“取消”；上下键 SHALL 仅在这两项间移动，只有用户移动到目标动作并按 Enter 后，系统才 SHALL执行创建或删除。删除项提示 SHALL 优先显示目标绝对路径，仅在存在同名用户级定义时补充接替和启停后果，提示 SHALL 简洁呈现于删除动作说明中。

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
- **THEN** 确认视图 SHALL 提示删除后用户级定义将在后续 primary assistant run 成为胜出定义，只有该名称全局启用时才可执行；全局名称偏好 SHALL 不因删除而清理
- **THEN** 只有用户选中明确删除动作并按 Enter 才 SHALL 删除项目级文件

## ADDED Requirements

### Requirement: Agent 一级详情只提供一个全局开关

内置与合法自定义 Agent 一级详情 SHALL 仅提供一个“全局启用”二态 toggle，与策略/编辑入口同层，所有项目共享、缺省开启。策略与定义子表单 SHALL 独立管理各自字段。

Enter、Space 或左右键 SHALL 只改详情草稿，同层保存 SHALL 仅写全局变化值；Esc/取消 SHALL 丢弃未保存选择。有效状态草稿 SHALL 标记未保存；全局来源异常时开关 SHALL 只读。模型策略诊断 SHALL 独立展示，全局开关 SHALL 按全局配置状态工作。成功后 SHALL 留在同一详情并提示下一主运行生效。

往返策略/定义编辑子表单 SHALL 保留详情草稿，保存子表单 SHALL 不顺带提交开关。用户级策略保存/移除成功时 SHALL 只在原指纹一致时推进全局草稿指纹，项目策略保存 SHALL 不刷新全局旧指纹而掩盖外部冲突。仅改开关 SHALL 不重写 Markdown、创建空模型 override 或改项目文件。启停只使用一个原子写，失败 SHALL 不产生部分保存并保留草稿。

#### Scenario: 一级详情唯一全局开关
- **WHEN** 用户从列表进入任一合法 Agent
- **THEN** 一级详情 SHALL 显示“全局启用”及同层保存/取消，列表 SHALL 用状态表达启用/停用；策略与定义子表单 SHALL 保持各自字段与独立保存入口

#### Scenario: 保存与取消
- **WHEN** 用户切换开关后保存或取消
- **THEN** 保存 SHALL 只写全局 sidecar；取消 SHALL 不写任何文件
- **THEN** 未保存草稿 SHALL 在详情底部操作提示中标记，保存成功后该标记 SHALL 清除

#### Scenario: 子菜单往返不提交开关
- **WHEN** 用户修改开关后进入、保存或取消任一子表单
- **THEN** 返回详情 SHALL 保留开关草稿，不因子表单保存而提交

#### Scenario: 指纹保持正确
- **WHEN** 用户先保存全局策略再保存全局开关
- **THEN** 开关 SHALL 使用自身上次写入后的指纹，不自冲突
- **THEN** 项目策略保存 SHALL 不掩盖全局文件的外部修改

#### Scenario: 失败可以重试
- **WHEN** 全局开关保存冲突或 I/O 失败
- **THEN** 原文件 SHALL 不变，详情 SHALL 保留开关草稿与原指纹，没有部分保存状态

#### Scenario: 布局和焦点保持
- **WHEN** 用户在宽窄屏或高度受限详情操作全局开关或 resize
- **THEN** 焦点、草稿及同层保存/取消 SHALL 可访问，遵守行宽预算且不切换 alternate screen

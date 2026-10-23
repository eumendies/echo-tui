## Purpose
定义 `/config` 配置中心的外部行为，包括三 Tab 导航、常规设置读写、slash suggestion 可见窗口、reasoning summary 显隐和设置刷新语义。
## Requirements
### Requirement: Tab 配置中心
系统 SHALL 将纯 `/config` 命令投影为带“常规”“模型与 Provider”“工具”“沙箱”“外观”五个 Tab 的配置中心。配置中心 SHALL 使用现有 command runtime 和 footer command surface，不得写入 transcript、启动 agent loop、进入 tool approval flow 或切换 terminal alternate screen。纯 `/config` SHALL 默认打开“常规”Tab。

#### Scenario: 打开配置中心
- **WHEN** 用户在主 UI composer 中提交纯 `/config`
- **THEN** 系统 SHALL 清空 composer 并打开 active command session
- **THEN** 配置中心 SHALL 显示五个 Tab 并激活“常规”
- **THEN** 系统 SHALL NOT 追加 transcript record 或启动 agent loop

#### Scenario: 循环切换 Tab
- **WHEN** 配置中心处于活跃状态且用户按 Tab
- **THEN** 系统 SHALL 在五个 Tab 间单向循环切换
- **THEN** Tab strip SHALL 在常规页面和模型的 provider、header、model 子页面中保持可见

#### Scenario: 切换 Tab 保留现场
- **WHEN** 用户在某个 Tab 修改草稿、移动选择位置或进入子页面后切换到其他 Tab
- **THEN** 系统 SHALL 保留原 Tab 的草稿、选择位置、子页面和文本编辑 buffer
- **THEN** 用户返回该 Tab 时 SHALL 能继续原有编辑现场

#### Scenario: 配置读取错误按 Tab 隔离
- **WHEN** `~/.echo/config.json` 无法用于常规、模型或沙箱配置读取，但 `~/.echo/theme.json` 和内置主题可用
- **AND** 用户在配置中心切换到“外观”Tab
- **THEN** 系统 SHALL 允许用户查看和选择主题
- **THEN** `config.json` 错误 SHALL NOT 阻断外观 Tab

#### Scenario: 沙箱 Tab 读取错误隔离
- **WHEN** `~/.echo/config.json` 无法用于沙箱草稿读取
- **THEN** 沙箱 Tab SHALL 以错误态展示且不影响其他 Tab
- **THEN** 用户 SHALL 仍能切换到其他 Tab 继续操作

#### Scenario: 工具 Tab 与常规设置分工
- **WHEN** 用户在配置中心浏览常规和工具 Tab
- **THEN** 工具 Tab SHALL 提供主 Agent 工具的独立开关
- **THEN** 常规 Tab SHALL NOT 再显示文件编辑方式的二选一设置
- **THEN** 常规 Tab SHALL 继续管理现有工具审批和图片压缩等非工具可见性设置

#### Scenario: 工具 Tab 读取错误隔离
- **WHEN** 主 Agent 工具偏好字段结构非法，但其他配置域可读
- **THEN** 工具 Tab SHALL 显示错误，且用户 SHALL 能继续切换并使用其他可读 Tab

### Requirement: 常规设置草稿与持久化
“常规”Tab SHALL 管理自动压缩阈值、技能列表上下文占比上限、slash suggestion 最大同时可见条目数、reasoning summary 显示开关和启动更新检查开关。系统 SHALL 使用默认值 0.8、0.02、8、true（reasoning summary）和 true（启动更新检查）；压缩阈值有效范围 SHALL 为 0.5 至 0.95，技能列表上下文占比上限有效范围 SHALL 为 0.01 至 0.10，slash suggestion 上限有效范围 SHALL 为 1 至 20。运行时读取缺失、类型错误、非有限或越界字段时 SHALL 回退对应默认值。

#### Scenario: 读取有效常规设置
- **WHEN** `~/.echo/config.json` 包含有效的 `compaction.thresholdRatio`、`skills.catalogContextRatio`、`ui.slashSuggestionMaxVisible`、`ui.showReasoningSummary` 和 `updates.checkOnStartup`
- **THEN** “常规”Tab SHALL 以百分比、百分比、条目数和开关状态展示这些值
- **THEN** TUI 与 headless runtime SHALL 使用相同的归一化设置

#### Scenario: 缺失常规设置使用默认值
- **WHEN** `compaction`、`skills`、`ui` 或 `updates` 节点或其字段缺失
- **THEN** 系统 SHALL 使用 0.8 的自动压缩阈值、0.02 的技能列表上下文占比上限、8 条 slash suggestion 上限、开启的 reasoning summary 显示和开启的启动更新检查
- **THEN** 系统 SHALL NOT 因可选设置缺失阻断 TUI 或 headless assistant run

#### Scenario: 无效运行时设置回退默认值
- **WHEN** 任一常规设置字段类型错误、不是有限数值或超出有效范围
- **THEN** 系统 SHALL 对该字段单独使用默认值
- **THEN** 其他有效常规设置 SHALL 继续生效

#### Scenario: 调节技能列表上下文占比上限
- **WHEN** 用户在“常规”Tab 选中技能列表上下文占比上限并按 Left 或 Right
- **THEN** 草稿 SHALL 在 1% 至 10% 范围内按 1% 调整
- **THEN** 配置中心 SHALL 以百分比显示调整后的值
- **THEN** 系统 SHALL NOT 在显式保存前修改运行时设置或配置文件

#### Scenario: 切换启动更新检查开关
- **WHEN** 用户在“常规”Tab 选中启动更新检查行并按 Enter 或 Left/Right
- **THEN** 草稿 SHALL 在“开”与“关”之间切换
- **THEN** 系统 SHALL NOT 在显式保存前修改运行时设置或配置文件

#### Scenario: 保存常规设置
- **WHEN** 用户在“常规”Tab 调整设置并激活显式保存动作
- **THEN** 系统 SHALL 校验草稿并原子更新 `~/.echo/config.json`
- **THEN** 系统 SHALL 将压缩阈值写入 `compaction.thresholdRatio`
- **THEN** 系统 SHALL 将技能列表上下文占比上限写入 `skills.catalogContextRatio`
- **THEN** 系统 SHALL 将 slash suggestion 上限和 reasoning summary 开关写入 `ui` 节点
- **THEN** 系统 SHALL 将启动更新检查开关写入 `updates.checkOnStartup`

#### Scenario: 保存保留其他配置节点
- **WHEN** `~/.echo/config.json` 已包含 `llm`、`tools`、`mcp`、`hooks` 或未知根节点
- **AND** 用户保存常规设置
- **THEN** 系统 SHALL 保留所有非本 Tab 所有的配置节点和值
- **THEN** 系统 SHALL 使用同目录临时文件加 rename 替换目标文件

#### Scenario: 保存无效草稿
- **WHEN** 常规设置草稿包含越界压缩阈值、越界技能列表上下文占比上限或越界 slash suggestion 上限
- **THEN** 配置中心 SHALL 显示可理解错误
- **THEN** 系统 SHALL NOT 写入 `~/.echo/config.json`

### Requirement: 分域保存和统一草稿保护
“常规”、“模型与 Provider”、“工具”和“沙箱”Tab SHALL 分别提供显式保存动作，并只提交各自所有的配置字段；成功保存 SHALL 重置该 Tab 的 dirty fingerprint 且 SHALL NOT 自动关闭配置中心。“外观”主题选择 SHALL 立即持久化，不形成未保存主题草稿。配置中心在关闭顶层页面时 SHALL 检查所有已初始化 Tab 的未保存草稿。

#### Scenario: 保存一个 Tab 不提交另一个 Tab 草稿
- **WHEN** 常规和模型 Tab 都包含未保存修改，且用户只保存常规 Tab
- **THEN** 系统 SHALL 只持久化常规设置
- **THEN** 模型 Tab SHALL 继续保持未保存状态和原草稿

#### Scenario: 保存后保持配置中心打开
- **WHEN** 常规、模型、工具或沙箱 Tab 保存成功
- **THEN** 配置中心 SHALL 保持 active command session
- **THEN** 当前 Tab SHALL 显示成功反馈并把已保存草稿作为新的 dirty 比较基线

#### Scenario: 从其他 Tab 关闭时保护草稿
- **WHEN** 任一可保存 Tab 包含未保存修改，且用户在另一个 Tab 的顶层按 Esc 尝试关闭配置中心
- **THEN** 系统 SHALL 显示统一放弃确认并指出存在未保存修改的 Tab
- **THEN** 只有用户确认放弃后系统 SHALL 关闭配置中心且不写入这些草稿

#### Scenario: 模型子页面 Esc 先返回
- **WHEN** 用户在“模型与 Provider”Tab 的 provider、header 或 model 子页面按 Esc，且未处于文本编辑
- **THEN** 系统 SHALL 先返回该模型编辑器的上一级页面
- **THEN** 系统 SHALL 保留所有 Tab 草稿且不打开全局放弃确认

#### Scenario: 工具保存与其他草稿隔离
- **WHEN** 工具和常规 Tab 都存在未保存修改，且用户只保存工具 Tab
- **THEN** 系统 SHALL 只更新工具页拥有的主 Agent 禁用名单字段
- **THEN** 常规 Tab 草稿 SHALL 保持未保存，工具 Tab SHALL 更新 dirty 基线并显示下一轮生效反馈
- **THEN** 用户之后从任何 Tab 顶层关闭配置中心时 SHALL 仍得到未保存草稿保护

### Requirement: Slash suggestion 可见条目上限
系统 SHALL 使用归一化的 `ui.slashSuggestionMaxVisible` 限制 composer 中同时渲染的 slash suggestion 行数。该上限 SHALL 只影响可见窗口，不得截断匹配候选集合或改变方向键导航和 Tab 补全语义。实际可见数量 SHALL 同时遵守终端 footer 高度预算。

#### Scenario: 候选多于用户上限
- **WHEN** 当前 slash 前缀匹配的候选数量大于用户配置上限
- **THEN** footer SHALL 最多同时显示配置数量的候选行
- **THEN** 可见窗口 SHALL 包含当前选中候选或其附近窗口

#### Scenario: 终端高度比用户上限更小
- **WHEN** 用户配置上限大于当前 footer 可用于 suggestion 的行数
- **THEN** footer SHALL 按当前终端高度预算进一步减少可见候选
- **THEN** 所有行 SHALL 继续遵守 safe render width 和 footer 高度约束

#### Scenario: 浏览不可同时显示的候选
- **WHEN** 匹配候选数量大于当前可见窗口且用户按 Up 或 Down
- **THEN** 系统 SHALL 在完整候选集合中移动选择
- **THEN** 可见窗口 SHALL 滚动以继续包含当前选中候选

#### Scenario: 补全不受显示上限截断
- **WHEN** 当前选中候选不在最初显示的前 N 条中且用户按 Tab
- **THEN** 系统 SHALL 使用完整候选集合中的当前选中命令完成 composer 文本

### Requirement: Reasoning summary 可见性设置
系统 SHALL 将 `ui.showReasoningSummary` 作为 `reasoning_summary` transcript record 的纯显示偏好。关闭时 append render、destructive replay 和 final render SHALL 隐藏 reasoning summary；系统仍 SHALL 保存和恢复完整 record，并保持其非 provider-facing、非上下文压缩输入语义。

#### Scenario: 关闭后隐藏新增 reasoning summary
- **WHEN** `showReasoningSummary` 为 false 且 provider 返回 reasoning summary
- **THEN** 系统 SHALL 把 `reasoning_summary` record 追加到 transcript 和 session journal
- **THEN** 当前 transcript 可见输出 SHALL NOT 渲染该 summary block

#### Scenario: 关闭后恢复 session
- **WHEN** session 中包含历史 `reasoning_summary` records 且当前显示开关为 false
- **THEN** destructive replay 和 final render SHALL 跳过这些 summary block
- **THEN** records SHALL 继续保留在恢复后的完整 transcript 状态中

#### Scenario: 重新开启恢复历史 summary
- **WHEN** 用户把 reasoning summary 显示从 false 保存为 true
- **THEN** 系统 SHALL 执行完整可见快照重绘
- **THEN** 已保存的历史 `reasoning_summary` records SHALL 重新可见

#### Scenario: 显示偏好不改变模型语义
- **WHEN** 用户切换 reasoning summary 显示开关
- **THEN** 系统 SHALL NOT 改变模型 profile 的 `reasoning.summary` 请求配置
- **THEN** 系统 SHALL NOT 把 reasoning summary 加入 provider request、token 估算或压缩摘要输入

### Requirement: 常规设置即时刷新
TUI SHALL 在 app 创建时从实例级用户配置 snapshot 读取一次归一化常规设置并缓存到实例状态。配置中心保存或 `config.json` watcher 检测到设置变化时，系统 SHALL 从同一次共享配置刷新产生的新 snapshot 更新缓存，并根据变化类型执行必要重绘或清理已失效的 context usage；普通 render 热路径 SHALL NOT 同步读取配置文件。同一 watcher 通知 SHALL NOT 为刷新模型与常规设置分别重复读取 `config.json`。

#### Scenario: Slash 上限变化只重绘 footer
- **WHEN** slash suggestion 上限变化且 reasoning summary 可见性未变化
- **THEN** 系统 SHALL 使用新上限重绘 footer
- **THEN** 系统 SHALL NOT 为该变化清空 transcript 或追加 record

#### Scenario: Reasoning 可见性变化完整重绘
- **WHEN** reasoning summary 可见性发生变化
- **THEN** 系统 SHALL 执行 destructive replay 以重新投影现有 transcript
- **THEN** 重绘 SHALL 使用当前 theme、终端宽度和完整持久化 records

#### Scenario: 只有压缩阈值变化
- **WHEN** 只有自动压缩阈值发生变化
- **THEN** 系统 SHALL NOT 因该变化执行不必要的 transcript 重绘
- **THEN** 下一次 assistant run SHALL 使用新阈值

#### Scenario: 技能列表上下文占比上限变化
- **WHEN** 技能列表上下文占比上限发生变化
- **THEN** 当前 active assistant run SHALL 继续使用启动时的 catalog 投影
- **THEN** 下一次 assistant run SHALL 使用新比例和当前模型 context window 创建 catalog 投影
- **THEN** 系统 SHALL 清理旧的 context usage 快照
- **THEN** 系统 SHALL NOT 因该变化执行不必要的 transcript 重绘或追加 record

#### Scenario: watcher 同时更新模型和常规设置
- **WHEN** 一次配置文件变化同时修改模型配置和常规设置
- **THEN** TUI SHALL 通过一次用户配置刷新得到包含两个领域变化的新 snapshot
- **THEN** ModelContext 与 App settings cache SHALL 消费同一 revision 且 SHALL NOT 各自重新读取配置文件

### Requirement: 超限图片自动压缩设置
系统 SHALL 将 `tools.readFiles.autoCompressImages` 作为 File Picker／`@` mention 与内置 `read_files` 工具共用的超限图片自动压缩开关，并 SHALL 在 `/config` 的“常规”Tab 中提供可见、可编辑和可持久化的设置行。该设置 SHALL 为 boolean 且默认值 SHALL 为 `true`；运行时读取缺失或非 boolean 值时 SHALL 独立回退默认值而不阻断 TUI 或 headless assistant run。

#### Scenario: 常规页面展示图片压缩开关
- **WHEN** 用户打开 `/config` 的“常规”Tab
- **THEN** 页面 SHALL 显示“超限图片自动压缩”或等价且不会与上下文自动压缩阈值混淆的设置行
- **THEN** 设置值 SHALL 显示当前归一化的开启或关闭状态

#### Scenario: 缺失或非法配置使用默认开启
- **WHEN** `tools.readFiles.autoCompressImages` 缺失或不是 boolean
- **THEN** TUI mention 图片读取与下一轮创建的 `read_files` handler SHALL 使用开启状态
- **THEN** 系统 SHALL NOT 因该可选字段无效而丢弃其他有效配置

#### Scenario: 调整开关只修改草稿
- **WHEN** 用户选中超限图片自动压缩设置并按 Left、Right 或 Enter
- **THEN** 常规设置草稿 SHALL 在开启和关闭之间切换
- **THEN** 系统 SHALL NOT 在显式保存前改变当前配置文件、mention 读取策略或 active assistant run 的工具策略

#### Scenario: 保存图片压缩开关
- **WHEN** 用户调整超限图片自动压缩设置并激活“保存常规设置”
- **THEN** 系统 SHALL 将 boolean 值写入 `tools.readFiles.autoCompressImages`
- **THEN** 保存 SHALL 保留 `tools` 下的 `bash`、`fileEdit`、其他已知或未知字段及所有其他根配置节点
- **THEN** 成功保存 SHALL 更新常规 Tab 的 dirty fingerprint 和成功反馈

#### Scenario: 配置变化按入口生命周期生效
- **WHEN** 配置中心保存或 config watcher 检测到图片自动压缩开关变化
- **THEN** 后续 File Picker／`@` mention 提交 SHALL 使用刷新后的设置
- **THEN** 当前 active assistant run SHALL 继续使用创建工具 registry 时的设置
- **THEN** 下一次 assistant run SHALL 使用新设置创建 `read_files` handler
- **THEN** 系统 SHALL NOT 因该变化完整重绘 transcript、追加 record 或清空 context usage

### Requirement: 工具审批模式与审批模型设置
系统 SHALL 将 `tools.approval.mode` 作为独立于 interaction mode 的工具审批模式设置，并 SHALL 在 `/config` 的“常规”Tab 中提供可见、可编辑和可持久化的选择项。有效值 SHALL 为 `manual` 和 `auto`，默认值 SHALL 为 `manual`。仅当常规设置草稿的 mode 为 `auto` 时，页面 SHALL 显示审批模型选择行；审批模型 SHALL 使用 `tools.approval.modelProfileId` 引用当前已保存的 `llm.models[].id`。

#### Scenario: 常规页面始终显示审批模式
- **WHEN** 用户打开 `/config` 的“常规”Tab
- **THEN** 页面 SHALL 显示“工具审批模式”或等价设置行
- **THEN** 设置值 SHALL 显示当前归一化的 `manual` 或 `auto`
- **THEN** 该设置 SHALL 与“默认启动模式”的 normal/plan 设置显示为不同字段

#### Scenario: Manual 草稿隐藏审批模型
- **WHEN** 常规设置草稿中的工具审批模式为 `manual`
- **THEN** 页面 SHALL NOT 显示审批模型选择行
- **THEN** 系统 SHALL 保留已有 model profile id 草稿值，以便用户切回 auto 时继续选择

#### Scenario: Auto 草稿显示审批模型
- **WHEN** 用户把常规设置草稿中的工具审批模式切换为 `auto`
- **THEN** 页面 SHALL 在审批模式行之后显示审批模型选择行
- **THEN** 该行 SHALL 展示当前选中的 model profile，或在没有有效选择时显示明确的未配置状态

#### Scenario: 审批模型候选来自已配置 profiles
- **WHEN** auto 草稿显示审批模型选择行且 `llm.models` 中存在一个或多个有效 profile
- **THEN** 用户 SHALL 能在这些 profile 之间循环选择
- **THEN** 每个选项 SHALL 至少提供可区分的 profile id 或 model label
- **THEN** 系统 SHALL NOT 要求用户重新输入 provider、API key、base URL 或 API model 名

#### Scenario: 切换模式动态调整焦点
- **WHEN** 用户在常规页面把审批模式从 auto 切换为 manual，导致审批模型行消失
- **THEN** handler 与 renderer SHALL 使用相同的动态 row id 集合
- **THEN** 当前 selected index SHALL 被归一化到仍存在的合法设置行
- **THEN** footer SHALL NOT 因行索引错位选中或执行其他设置

#### Scenario: 调整设置只修改草稿
- **WHEN** 用户调整工具审批模式或审批模型
- **THEN** 系统 SHALL 只更新当前常规 Tab 草稿和 dirty 状态
- **THEN** 系统 SHALL NOT 在显式保存前改变当前 assistant turn、配置文件或运行时审批策略

#### Scenario: 保存 Manual 模式
- **WHEN** 用户选择 `manual` 并激活“保存常规设置”
- **THEN** 系统 SHALL 将 `manual` 写入 `tools.approval.mode`
- **THEN** 保存 SHALL 保留已有 `tools.approval.modelProfileId`、其他 tools 字段和其他根配置节点

#### Scenario: 保存有效 Auto 模式
- **WHEN** 用户选择 `auto`、选择一个当前已保存的有效 model profile，并激活“保存常规设置”
- **THEN** 系统 SHALL 将 `auto` 写入 `tools.approval.mode`
- **THEN** 系统 SHALL 将选中的 profile id 写入 `tools.approval.modelProfileId`
- **THEN** 保存 SHALL 保留 `llm`、其他 tools 字段和其他根配置节点

#### Scenario: Auto 模式缺少有效模型时拒绝保存
- **WHEN** 常规设置草稿为 `auto`，但 model profile id 缺失或不再存在于已保存的 `llm.models`
- **AND** 用户激活“保存常规设置”
- **THEN** 配置中心 SHALL 显示可理解的校验错误
- **THEN** 系统 SHALL NOT 写入常规设置草稿

#### Scenario: 缺失或非法运行时配置回退 Manual
- **WHEN** `tools.approval.mode` 缺失或不是 `manual`、`auto`
- **THEN** TUI SHALL 使用 `manual` 工具审批模式
- **THEN** 其他有效 App settings SHALL 继续生效

#### Scenario: 配置变化下一回合生效
- **WHEN** 配置中心保存或 config watcher 检测到工具审批模式或审批模型变化
- **THEN** 当前 active assistant turn SHALL 继续使用启动时的审批设置快照
- **THEN** 下一次 assistant turn SHALL 使用刷新后的审批模式和模型 profile
- **THEN** 系统 SHALL NOT 因该变化完整重绘 transcript 或追加 record

### Requirement: UI 鼠标交互设置
系统 SHALL 将 `ui.mouseInteractionEnabled` 作为 TUI 的“UI 鼠标交互”boolean 设置，并在 `/config` 的“常规”Tab 中提供可见、可编辑和可持久化的设置行。该设置控制终端鼠标报告以及 UI hover/点击能力，默认值 SHALL 为 `false`；缺失、非 boolean、不可读或非法配置 SHALL 独立回退为关闭而不得阻断 TUI 或 headless run。该设置 SHALL NOT 使用 footer 专属的配置字段或界面名称。

#### Scenario: 常规页面展示 UI 鼠标交互
- **WHEN** 用户打开 `/config` 的“常规”Tab
- **THEN** 页面 SHALL 显示名称为“UI 鼠标交互”的开关行
- **THEN** 该行 SHALL 展示当前归一化的开启或关闭状态

#### Scenario: 缺失或非法设置默认关闭
- **WHEN** `ui.mouseInteractionEnabled` 缺失、不是 boolean，或当前可选 App settings 无法读取
- **THEN** TUI SHALL 将 UI 鼠标交互归一化为关闭
- **THEN** 系统 SHALL 不因该字段阻断其他有效常规设置、TUI 或 headless run

#### Scenario: 调整开关只修改草稿
- **WHEN** 用户选中“UI 鼠标交互”并按 Enter、Left 或 Right
- **THEN** 常规设置草稿 SHALL 在开启和关闭之间切换
- **THEN** 系统 SHALL NOT 在显式保存前改变当前终端鼠标报告或运行时 hit region

#### Scenario: 保存 UI 鼠标交互设置
- **WHEN** 用户调整“UI 鼠标交互”并激活“保存常规设置”
- **THEN** 系统 SHALL 将 boolean 值写入 `ui.mouseInteractionEnabled`
- **THEN** 保存 SHALL 保留 `ui` 节点的其他字段、其他已知配置节点和未知根节点
- **THEN** 成功保存 SHALL 更新常规 Tab 的 dirty fingerprint 和成功反馈

### Requirement: UI 鼠标交互设置在当前 TUI 即时生效
TUI SHALL 在 app 创建、配置中心成功保存或 `config.json` watcher 安装新 App settings snapshot 后使用归一化的 `ui.mouseInteractionEnabled`。设置变化 SHALL 通过普通 footer 重绘即时更新鼠标交互投影；系统 SHALL NOT 为此 destructive replay transcript、追加 transcript record、改变 active assistant turn 或改变键盘输入语义。

#### Scenario: 开启设置后激活当前可操作 UI
- **WHEN** 当前 TUI 实例安装 `ui.mouseInteractionEnabled: true` 的新 App settings snapshot
- **AND** 当前可见 footer 存在既有可操作的 pointer consumer
- **THEN** 下一次 footer 重绘 SHALL 按终端鼠标交互规范启用该 consumer 的鼠标能力
- **THEN** 既有键盘焦点和业务 surface 状态 SHALL 保持不变

#### Scenario: 关闭设置时立即恢复普通终端鼠标行为
- **WHEN** 当前可见 footer 正在启用 UI 鼠标交互
- **AND** 配置中心保存或 watcher 将 `ui.mouseInteractionEnabled` 更新为 `false`
- **THEN** 下一次 footer 重绘 SHALL 移除可执行 hit region 并停用终端鼠标报告
- **THEN** 系统 SHALL 清理当前鼠标 frame 与未完成的坐标校准，且不得执行迟到鼠标事件的业务动作

### Requirement: 响应期间消息策略设置
系统 SHALL 在 `/config` 的“常规”Tab 提供“响应期间发送消息”设置，展示“排队”和“即时引导”两种选择，分别持久化为 `ui.activeTurnMessagePolicy` 的 `pending` 和 `steer`。默认值 SHALL 为 `pending`；字段缺失、类型错误或值不属于枚举时 SHALL 单独回退默认值，不阻断 TUI 或 headless 启动。界面 SHALL 说明即时引导不强制停止已启动工具。

#### Scenario: 旧配置保持排队
- **WHEN** 配置文件没有 `ui.activeTurnMessagePolicy`
- **THEN** 系统 SHALL 归一化为 `pending`
- **THEN** 常规页面 SHALL 显示“排队”，响应期普通提交 SHALL 保持现有 pending 行为

#### Scenario: 非法字段独立回退
- **WHEN** 消息策略字段为 boolean、null 或不支持的字符串
- **THEN** 系统 SHALL 对该字段使用 `pending`
- **THEN** 其他有效设置 SHALL 继续生效

#### Scenario: 调整选择只修改草稿
- **WHEN** 用户选中消息策略行并按 Left、Right 或 Enter
- **THEN** 草稿 SHALL 在“排队”和“即时引导”之间切换
- **THEN** 系统 SHALL NOT 在显式保存前修改配置文件或后续运行的默认策略

#### Scenario: 显式保存与配置保留
- **WHEN** 用户保存包含有效消息策略的常规草稿
- **THEN** 系统 SHALL 原子写入 `ui.activeTurnMessagePolicy` 并保留其他已知或未知配置字段
- **THEN** 系统 SHALL 更新 dirty fingerprint 和成功反馈，保持配置中心打开

#### Scenario: 无效草稿不能写入
- **WHEN** 常规草稿中的消息策略不是 `pending` 或 `steer`
- **AND** 用户请求保存
- **THEN** 系统 SHALL 显示可理解错误且不写入配置文件

### Requirement: 消息策略按 assistant turn 固定
交互式主 assistant turn SHALL 在启动时从同一配置 snapshot 捕获消息策略，提交控制器和运行中输入通道 SHALL 使用该固定值。保存或 watcher 刷新 SHALL 只改变后续 turn 的默认策略，不重新解释当前 turn 或已接收消息；render 热路径 SHALL NOT 读取配置文件。该设置 SHALL NOT 创建 headless stdin 监听或改变 BTW、子代理和 shell 的输入行为。

#### Scenario: 活动 turn 期间刷新策略
- **WHEN** 当前 turn 以 `pending` 启动且 watcher 将配置刷新为 `steer`
- **THEN** 当前 turn 中的后续普通提交 SHALL 仍使用 `pending`
- **THEN** 下一次主 assistant turn SHALL 使用 `steer`
- **THEN** 已排队的消息 SHALL NOT 被追溯注入当前运行

#### Scenario: 引导等待期间改回排队
- **WHEN** 当前 turn 使用 `steer` 且有引导消息等待工具收尾
- **AND** 默认配置变为 `pending`
- **THEN** 当前消息 SHALL 保持引导类型和原目标 turn
- **THEN** 后续新 turn SHALL 使用 `pending`

#### Scenario: headless 无运行中交互
- **WHEN** 用户配置为 `steer` 并执行 `--once`
- **THEN** headless SHALL 保持单次输入、无 stdin 等待与原审批策略
- **THEN** 系统 SHALL NOT 为即时引导创建 TUI 或运行中输入监听

### Requirement: 主 Agent 工具页草稿与持久化

“工具”Tab SHALL 展示明确标注作用范围的主 Agent 工具列表，包括真实工具名、右对齐的简短中文说明、启用偏好及当前可用性，不展开模型使用的完整工具 description，不显示顶部策略说明或底部选中工具详情。Bash SHALL 为不可关闭的必选项；`create_todos` 与 `complete_todo` SHALL 合并为一个 Todo 配置项联动切换，其他工具 SHALL 可独立切换，`apply_patch` 与 `edit_file` SHALL 分别占一项。工具页 SHALL 使用现有 command surface 与 footer 高度预算，提供完整列表导航、Space／Enter 切换及显式保存。草稿 SHALL 在保存前不影响运行时，并纳入跨 Tab 保留和顶层统一放弃保护。

#### Scenario: 打开工具页
- **WHEN** 用户在 `/config` 切换到工具 Tab
- **THEN** 页面 SHALL 显示“主 Agent 工具”或等价作用域标识
- **THEN** 页面 SHALL 分别展示 `apply_patch` 与 `edit_file`，并在 Bash 的短说明中标注其必选；工具选择不等于安全权限的边界 SHALL 保留在配置文档
- **THEN** 未配置工具选择时 SHALL 按空禁用名单 `[]` 创建草稿，两个编辑工具及其他可用工具默认开启，不读取旧文件编辑模式

#### Scenario: 紧凑分组与中文说明
- **WHEN** 用户浏览包含内置和 MCP 工具的工具页
- **THEN** 内置分组 SHALL 仅显示“内置工具”，且只有缺少定义的保留偏好存在时才单独显示“未识别工具”分组
- **THEN** 每行 SHALL 仅显示工具名、开关和右对齐中文短说明，已知但依赖不可用的资源工具 SHALL 保留在内置分组并标注暂不可用
- **THEN** 页面 SHALL NOT 显示顶部“工具选择非权限限制”说明或底部重复选中工具详情，释放的行预算 SHALL 用于工具列表

#### Scenario: 切换普通工具只修改草稿
- **WHEN** 用户在普通工具行按 Space 或 Enter
- **THEN** 草稿 SHALL 切换该工具的启用状态，其他工具偏好保持不变
- **THEN** 系统 SHALL NOT 在显式保存前写盘或改变运行中的工具集合

#### Scenario: Todo 只占一个联动配置项
- **WHEN** 用户浏览工具页并切换 Todo 项
- **THEN** 页面 SHALL 只展示一个 Todo 开关及“创建与完成任务”短说明，配置文档 SHALL 说明其关联 `create_todos` 和 `complete_todo`
- **THEN** 系统 SHALL 同时修改两个真实工具的草稿状态，不提供分别切换的入口
- **THEN** 保存前 SHALL 不写盘或改变当前运行，保存后 SHALL 使两个工具在下一次主运行同时启用或禁用

#### Scenario: 跨 Tab 保留工具草稿
- **WHEN** 用户修改工具草稿及选择位置后切换到其他 Tab，再返回工具 Tab
- **THEN** 系统 SHALL 恢复原有草稿与选择位置
- **THEN** 关闭配置中心 SHALL 继续保护未保存的工具草稿

#### Scenario: 终端高度不足仍能访问完整列表
- **WHEN** 内置与 MCP 工具数量超过 footer 可显示高度
- **THEN** 页面 SHALL 按已有列表机制滚动并保持焦点可见
- **THEN** 用户 SHALL 能访问全部候选工具和保存动作，且渲染不越过安全宽高预算

#### Scenario: 显式保存工具偏好
- **WHEN** 用户激活工具页保存且草稿有效
- **THEN** 系统 SHALL 基于最新配置根原子更新 `tools.mainAgent.disabledTools`
- **THEN** 保存 SHALL 保留其他 `tools` 字段、旧 `fileEdit` 节点、未知配置和当前离线工具的禁用偏好
- **THEN** 系统 SHALL 安装共享配置新 snapshot、重置本页 dirty 基线，并提示下一次运行生效而不关闭配置中心

#### Scenario: 只读取不迁移写盘
- **WHEN** 配置只包含旧文件编辑模式，且用户打开或离开工具页但未保存
- **THEN** 工具页 SHALL 忽略旧模式，按缺失名单默认 `[]` 展示两个编辑工具及其他可用工具开启
- **THEN** 系统 SHALL NOT 自动创建新字段或修改旧字段

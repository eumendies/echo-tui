## Purpose
定义 `/config` 配置中心的外部行为，包括三 Tab 导航、常规设置读写、slash suggestion 可见窗口、reasoning summary 显隐和设置刷新语义。
## Requirements
### Requirement: Tab 配置中心
系统 SHALL 将纯 `/config` 命令投影为带“常规”“模型与 Provider”“外观”三个 Tab 的配置中心。配置中心 SHALL 使用现有 command runtime 和 footer command surface，不得写入 transcript、启动 agent loop、进入 tool approval flow 或切换 terminal alternate screen。纯 `/config` SHALL 默认打开“常规”Tab。

#### Scenario: 打开配置中心
- **WHEN** 用户在主 UI composer 中提交纯 `/config`
- **THEN** 系统 SHALL 清空 composer 并打开 active command session
- **THEN** 配置中心 SHALL 显示三个 Tab 并激活“常规”
- **THEN** 系统 SHALL NOT 追加 transcript record 或启动 agent loop

#### Scenario: 循环切换 Tab
- **WHEN** 配置中心处于活跃状态且用户按 Tab
- **THEN** 系统 SHALL 在三个 Tab 间单向循环切换
- **THEN** Tab strip SHALL 在常规页面和模型的 provider、header、model 子页面中保持可见

#### Scenario: 切换 Tab 保留现场
- **WHEN** 用户在某个 Tab 修改草稿、移动选择位置或进入子页面后切换到其他 Tab
- **THEN** 系统 SHALL 保留原 Tab 的草稿、选择位置、子页面和文本编辑 buffer
- **THEN** 用户返回该 Tab 时 SHALL 能继续原有编辑现场

#### Scenario: 配置读取错误按 Tab 隔离
- **WHEN** `~/.echo/config.json` 无法用于常规或模型配置读取，但 `~/.echo/theme.json` 和内置主题可用
- **AND** 用户在配置中心切换到“外观”Tab
- **THEN** 系统 SHALL 允许用户查看和选择主题
- **THEN** `config.json` 错误 SHALL NOT 阻断外观 Tab

### Requirement: 常规设置草稿与持久化
“常规”Tab SHALL 管理自动压缩阈值、技能列表上下文占比上限、slash suggestion 最大同时可见条目数和 reasoning summary 显示开关。系统 SHALL 使用默认值 0.8、0.02、8 和 true；压缩阈值有效范围 SHALL 为 0.5 至 0.95，技能列表上下文占比上限有效范围 SHALL 为 0.01 至 0.10，slash suggestion 上限有效范围 SHALL 为 1 至 20。运行时读取缺失、类型错误、非有限或越界字段时 SHALL 回退对应默认值。

#### Scenario: 读取有效常规设置
- **WHEN** `~/.echo/config.json` 包含有效的 `compaction.thresholdRatio`、`skills.catalogContextRatio`、`ui.slashSuggestionMaxVisible` 和 `ui.showReasoningSummary`
- **THEN** “常规”Tab SHALL 以百分比、百分比、条目数和开关状态展示这些值
- **THEN** TUI 与 headless runtime SHALL 使用相同的归一化设置

#### Scenario: 缺失常规设置使用默认值
- **WHEN** `compaction`、`skills` 或 `ui` 节点或其字段缺失
- **THEN** 系统 SHALL 使用 0.8 的自动压缩阈值、0.02 的技能列表上下文占比上限、8 条 slash suggestion 上限和开启的 reasoning summary 显示
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

#### Scenario: 保存常规设置
- **WHEN** 用户在“常规”Tab 调整设置并激活显式保存动作
- **THEN** 系统 SHALL 校验草稿并原子更新 `~/.echo/config.json`
- **THEN** 系统 SHALL 将压缩阈值写入 `compaction.thresholdRatio`
- **THEN** 系统 SHALL 将技能列表上下文占比上限写入 `skills.catalogContextRatio`
- **THEN** 系统 SHALL 将 slash suggestion 上限和 reasoning summary 开关写入 `ui` 节点

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
“常规”和“模型与 Provider”Tab SHALL 分别提供显式保存动作，并只提交各自所有的配置字段；成功保存 SHALL 重置该 Tab 的 dirty fingerprint 且 SHALL NOT 自动关闭配置中心。“外观”主题选择 SHALL 立即持久化，不形成未保存主题草稿。配置中心在关闭顶层页面时 SHALL 检查所有已初始化 Tab 的未保存草稿。

#### Scenario: 保存一个 Tab 不提交另一个 Tab 草稿
- **WHEN** 常规和模型 Tab 都包含未保存修改，且用户只保存常规 Tab
- **THEN** 系统 SHALL 只持久化常规设置
- **THEN** 模型 Tab SHALL 继续保持未保存状态和原草稿

#### Scenario: 保存后保持配置中心打开
- **WHEN** 常规或模型 Tab 保存成功
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
TUI SHALL 在 app 创建时读取一次归一化常规设置并缓存到实例状态。配置中心保存或 `config.json` watcher 检测到设置变化时，系统 SHALL 刷新缓存并根据变化类型执行必要重绘或清理已失效的 context usage；普通 render 热路径 SHALL NOT 同步读取配置文件。

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

### Requirement: 文件编辑工具模式设置
系统 SHALL 将 `tools.fileEdit.mode` 作为 TUI 与 headless runtime 共用的文件编辑工具模式设置，并 SHALL 在 `/config` 的“常规”Tab 中提供可见、可编辑和可持久化的选择项。有效值 SHALL 为 `apply_patch` 和 `edit_file`，默认值 SHALL 为 `apply_patch`；运行时读取缺失或非法值时 SHALL 独立回退默认值而不阻断应用。

#### Scenario: 常规页面展示当前模式
- **WHEN** 用户打开 `/config` 的“常规”Tab
- **THEN** 页面 SHALL 显示“文件编辑工具”或等价设置行
- **THEN** 设置值 SHALL 显示当前归一化的 `apply_patch` 或 `edit_file`

#### Scenario: 调整模式只修改草稿
- **WHEN** 用户选中文件编辑工具设置并按 Left 或 Right
- **THEN** 草稿 SHALL 在 `apply_patch` 与 `edit_file` 之间切换
- **THEN** 系统 SHALL NOT 在显式保存前改变当前配置文件或运行时工具集合

#### Scenario: 保存文件编辑工具模式
- **WHEN** 用户调整文件编辑工具并激活“保存常规设置”
- **THEN** 系统 SHALL 将归一化值写入 `tools.fileEdit.mode`
- **THEN** 保存 SHALL 保留 `tools` 下的 `bash`、其他已知或未知字段及所有其他根配置节点
- **THEN** 成功保存 SHALL 更新常规 Tab 的 dirty fingerprint 和成功反馈

#### Scenario: 配置变化下一轮生效
- **WHEN** 配置中心保存或 config watcher 检测到文件编辑模式变化
- **THEN** 当前 active assistant run SHALL 继续使用启动时的文件编辑工具
- **THEN** 下一次 assistant run SHALL 使用新模式创建 tool definitions 和 executor registry
- **THEN** 系统 SHALL 清理受工具 schema 变化影响的旧 context usage 快照
- **THEN** 系统 SHALL NOT 因该变化重绘完整 transcript 或追加 record

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


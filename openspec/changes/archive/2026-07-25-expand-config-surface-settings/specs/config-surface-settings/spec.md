## ADDED Requirements

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
“常规”Tab SHALL 管理自动压缩阈值、slash suggestion 最大同时可见条目数和 reasoning summary 显示开关。系统 SHALL 使用默认值 0.8、8 和 true；压缩阈值有效范围 SHALL 为 0.5 至 0.95，slash suggestion 上限有效范围 SHALL 为 1 至 20。运行时读取缺失、类型错误、非有限或越界字段时 SHALL 回退对应默认值。

#### Scenario: 读取有效常规设置
- **WHEN** `~/.echo/config.json` 包含有效的 `compaction.thresholdRatio`、`ui.slashSuggestionMaxVisible` 和 `ui.showReasoningSummary`
- **THEN** “常规”Tab SHALL 以百分比、条目数和开关状态展示这些值
- **THEN** 运行时 SHALL 使用相同的归一化设置

#### Scenario: 缺失常规设置使用默认值
- **WHEN** `compaction` 或 `ui` 节点或其字段缺失
- **THEN** 系统 SHALL 使用 0.8 的自动压缩阈值、8 条 slash suggestion 上限和开启的 reasoning summary 显示
- **THEN** 系统 SHALL NOT 因可选设置缺失阻断 TUI 或 headless assistant run

#### Scenario: 无效运行时设置回退默认值
- **WHEN** 任一常规设置字段类型错误、不是有限数值或超出有效范围
- **THEN** 系统 SHALL 对该字段单独使用默认值
- **THEN** 其他有效常规设置 SHALL 继续生效

#### Scenario: 保存常规设置
- **WHEN** 用户在“常规”Tab 调整设置并激活显式保存动作
- **THEN** 系统 SHALL 校验草稿并原子更新 `~/.echo/config.json`
- **THEN** 系统 SHALL 将压缩阈值写入 `compaction.thresholdRatio`
- **THEN** 系统 SHALL 将 slash suggestion 上限和 reasoning summary 开关写入 `ui` 节点

#### Scenario: 保存保留其他配置节点
- **WHEN** `~/.echo/config.json` 已包含 `llm`、`tools`、`mcp`、`hooks` 或未知根节点
- **AND** 用户保存常规设置
- **THEN** 系统 SHALL 保留所有非本 Tab 所有的配置节点和值
- **THEN** 系统 SHALL 使用同目录临时文件加 rename 替换目标文件

#### Scenario: 保存无效草稿
- **WHEN** 常规设置草稿包含越界压缩阈值或越界 slash suggestion 上限
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
TUI SHALL 在 app 创建时读取一次归一化常规设置并缓存到实例状态。配置中心保存或 `config.json` watcher 检测到设置变化时，系统 SHALL 刷新缓存并根据变化类型执行必要重绘；普通 render 热路径 SHALL NOT 同步读取配置文件。

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


## MODIFIED Requirements

### Requirement: 常规设置草稿与持久化
“常规”Tab SHALL 管理自动压缩阈值、技能列表上下文占比上限、slash suggestion 最大同时可见条目数和 reasoning summary 显示开关。系统 SHALL 使用默认值 0.8、0.02、8 和 true；压缩阈值有效范围 SHALL 为 0.5 至 0.95，技能列表上下文占比上限有效范围 SHALL 为 0.01 至 0.10，slash suggestion 上限有效范围 SHALL 为 1 至 20。运行时读取缺失、类型错误、非有限或越界字段时 SHALL 回退对应默认值。

#### Scenario: 读取有效常规设置
- **WHEN** `~/.echo/config.json` 包含有效的 `compaction.thresholdRatio`、`skills.catalogContextRatio`、`ui.slashSuggestionMaxVisible` 和 `ui.showReasoningSummary`
- **THEN** “常规”Tab SHALL 以百分比、百分比、条目数和开关状态展示这些值
- **THEN** TUI 与 headless runtime SHALL 使用相同的归一化设置

#### Scenario: 缺失常规设置使用默认值
- **WHEN** `compaction`、`skills` 或 `ui` 节点或其字段缺失
- **THEN** 系统 SHALL 使用 0.8 的自动压缩阈值、0.02 的 技能列表上下文占比上限、8 条 slash suggestion 上限和开启的 reasoning summary 显示
- **THEN** 系统 SHALL NOT 因可选设置缺失阻断 TUI 或 headless assistant run

#### Scenario: 无效运行时设置回退默认值
- **WHEN** 任一常规设置字段类型错误、不是有限数值或超出有效范围
- **THEN** 系统 SHALL 对该字段单独使用默认值
- **THEN** 其他有效常规设置 SHALL 继续生效

#### Scenario: 调节 技能列表上下文占比上限
- **WHEN** 用户在“常规”Tab 选中 技能列表上下文占比上限并按 Left 或 Right
- **THEN** 草稿 SHALL 在 1% 至 10% 范围内按 1% 调整
- **THEN** 配置中心 SHALL 以百分比显示调整后的值
- **THEN** 系统 SHALL NOT 在显式保存前修改运行时设置或配置文件

#### Scenario: 保存常规设置
- **WHEN** 用户在“常规”Tab 调整设置并激活显式保存动作
- **THEN** 系统 SHALL 校验草稿并原子更新 `~/.echo/config.json`
- **THEN** 系统 SHALL 将压缩阈值写入 `compaction.thresholdRatio`
- **THEN** 系统 SHALL 将 技能列表上下文占比上限写入 `skills.catalogContextRatio`
- **THEN** 系统 SHALL 将 slash suggestion 上限和 reasoning summary 开关写入 `ui` 节点

#### Scenario: 保存保留其他配置节点
- **WHEN** `~/.echo/config.json` 已包含 `llm`、`tools`、`mcp`、`hooks` 或未知根节点
- **AND** 用户保存常规设置
- **THEN** 系统 SHALL 保留所有非本 Tab 所有的配置节点和值
- **THEN** 系统 SHALL 使用同目录临时文件加 rename 替换目标文件

#### Scenario: 保存无效草稿
- **WHEN** 常规设置草稿包含越界压缩阈值、越界 技能列表上下文占比上限或越界 slash suggestion 上限
- **THEN** 配置中心 SHALL 显示可理解错误
- **THEN** 系统 SHALL NOT 写入 `~/.echo/config.json`

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

## MODIFIED Requirements

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

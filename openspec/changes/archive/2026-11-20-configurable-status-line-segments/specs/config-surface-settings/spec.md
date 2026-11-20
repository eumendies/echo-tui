## MODIFIED Requirements

### Requirement: 常规设置草稿与持久化
“常规”Tab SHALL 管理自动压缩阈值、技能列表上下文占比上限、slash suggestion 最大同时可见条目数、reasoning summary 显示开关、状态栏显示项（6 个 status line segment 开关）和启动更新检查开关。系统 SHALL 使用默认值 0.8、0.02、8、true（reasoning summary）、6 项全部显示（状态栏显示项）和 true（启动更新检查）；压缩阈值有效范围 SHALL 为 0.5 至 0.95，技能列表上下文占比上限有效范围 SHALL 为 0.01 至 0.10，slash suggestion 上限有效范围 SHALL 为 1 至 20。运行时读取缺失、类型错误、非有限或越界字段时 SHALL 回退对应默认值；状态栏显示项的每个 segment 字段 SHALL 独立回退为 `true`。

#### Scenario: 读取有效常规设置
- **WHEN** `~/.echo/config.json` 包含有效的 `compaction.thresholdRatio`、`skills.catalogContextRatio`、`ui.slashSuggestionMaxVisible`、`ui.showReasoningSummary`、`ui.statusLine` 和 `updates.checkOnStartup`
- **THEN** “常规”Tab SHALL 以百分比、百分比、条目数、开关状态、状态栏显示项摘要和开关状态展示这些值
- **THEN** TUI 与 headless runtime SHALL 使用相同的归一化设置

#### Scenario: 缺失常规设置使用默认值
- **WHEN** `compaction`、`skills`、`ui` 或 `updates` 节点或其字段缺失
- **THEN** 系统 SHALL 使用 0.8 的自动压缩阈值、0.02 的技能列表上下文占比上限、8 条 slash suggestion 上限、开启的 reasoning summary 显示、6 项全部显示的状态栏显示项和开启的启动更新检查
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
- **THEN** 系统 SHALL 将 6 个状态栏 segment 开关写入 `ui.statusLine` 节点
- **THEN** 系统 SHALL 将启动更新检查开关写入 `updates.checkOnStartup`

#### Scenario: 保存保留其他配置节点
- **WHEN** `~/.echo/config.json` 已包含 `llm`、`tools`、`mcp`、`hooks` 或未知根节点
- **AND** 用户保存常规设置
- **THEN** 系统 SHALL 保留所有非本 Tab 所有的配置节点和值
- **THEN** 系统 SHALL 使用同目录临时文件加 rename 替换目标文件

#### Scenario: 保存无效草稿
- **WHEN** 常规设置草稿包含越界压缩阈值、越界技能列表上下文占比上限、越界 slash suggestion 上限或非布尔的状态栏 segment 开关
- **THEN** 配置中心 SHALL 显示可理解错误
- **THEN** 系统 SHALL NOT 写入 `~/.echo/config.json`

## ADDED Requirements

### Requirement: 状态栏显示项入口行
配置中心“常规”Tab SHALL 在 reasoning summary 显示开关行之后提供一行“状态栏显示项”，作为进入状态栏显示项子面板的唯一入口。该行值 SHALL 为以下三态之一的摘要：`6 项全开`、`N 项开启`、`全部隐藏`。

该行 SHALL 属于常规 Tab 草稿的一部分：其摘要 SHALL 反映当前草稿而非已保存配置，其存在 SHALL 使常规 Tab 的 dirty 判定覆盖 `ui.statusLine` 的变化。该行 SHALL NOT 拥有子面板之外的额外状态，也 SHALL NOT 在未进入子面板时就地切换任何 segment。

#### Scenario: 展示全部开启摘要
- **WHEN** 常规草稿中 6 个 segment 开关全部为 `true`
- **THEN** 该行 SHALL 显示 `6 项全开`

#### Scenario: 展示部分开启摘要
- **WHEN** 常规草稿中 2 个 segment 开关为 `false`
- **THEN** 该行 SHALL 显示 `4 项开启`

#### Scenario: 展示全部隐藏摘要
- **WHEN** 常规草稿中 6 个 segment 开关全部为 `false`
- **THEN** 该行 SHALL 显示 `全部隐藏`

#### Scenario: 摘要跟随草稿而非已保存值
- **WHEN** 用户在子面板关闭某个 segment 但尚未保存
- **THEN** 返回常规 Tab 后该行摘要 SHALL 立即反映草稿状态
- **THEN** 常规 Tab SHALL 被标记为存在未保存修改

### Requirement: 状态栏显示项子面板
在“状态栏显示项”行按 Enter SHALL 打开状态栏显示项子面板。该子面板 SHALL 复用配置中心 footer 与 Tab strip，SHALL NOT 追加 transcript record、SHALL NOT 启动 agent loop、SHALL NOT 进入 tool approval flow、SHALL NOT 切换 terminal alternate screen。

子面板的可操作行 SHALL 为固定顺序的 6 个开关行和 1 个“保存常规设置”行：模型、推理强度、会话标题、目录、上下文用量、全部工具已授权、保存常规设置。每行值 SHALL 显示 `开` 或 `关`。handler 与 renderer SHALL 共用同一份行集合投影，避免焦点与渲染错位。

Up 与 Down SHALL 在 7 行之间移动焦点并停在边界；Enter、Left 或 Right SHALL 切换当前开关行，且在保存行上 SHALL 执行保存。子面板 SHALL NOT 注册 footer hit region，也 SHALL NOT 提供鼠标点击或滚轮操作。

子面板 SHALL 直接读写常规 Tab 草稿，SHALL NOT 持有独立草稿副本。保存成功 SHALL 更新常规 Tab 的 dirty fingerprint 并把成功反馈留在该 Tab，SHALL NOT 自动关闭配置中心。footer 高度不足时 SHALL 优先保留当前焦点行，其次保留外框与 Tab strip。

#### Scenario: 打开子面板
- **WHEN** 用户在常规 Tab 选中“状态栏显示项”行并按 Enter
- **THEN** 系统 SHALL 打开状态栏显示项子面板并保持 Tab strip 可见
- **THEN** 焦点 SHALL 落在第一个开关行
- **THEN** 系统 SHALL NOT 追加 transcript record 或启动 agent loop

#### Scenario: 切换单个开关
- **WHEN** 子面板焦点位于“目录”行且用户按 Enter
- **THEN** 常规草稿中的 `dir` 开关 SHALL 在 `true` 与 `false` 间切换
- **THEN** 该行值显示 SHALL 立即变为 `关`
- **THEN** 系统 SHALL NOT 在保存前修改配置文件或当前运行的 status line

#### Scenario: 焦点只在可操作行之间移动
- **WHEN** 用户在子面板按 Up 或 Down
- **THEN** 焦点 SHALL 在 6 个开关行与保存行之间移动并停在边界
- **THEN** 系统 SHALL NOT 因这些按键改变任何开关值

#### Scenario: 子面板内保存
- **WHEN** 用户在子面板选中“保存常规设置”并按 Enter
- **THEN** 系统 SHALL 使用与常规 Tab 保存动作相同的校验与写入路径
- **THEN** 保存成功 SHALL 更新常规 Tab 的 dirty 基线并保持配置中心打开
- **THEN** 保存失败 SHALL 在子面板内显示可理解错误且不写入配置文件

#### Scenario: Esc 返回常规 Tab
- **WHEN** 用户在子面板按 Esc 或 Backspace
- **THEN** 系统 SHALL 返回常规 Tab 并保留草稿与未保存修改
- **THEN** 系统 SHALL NOT 关闭配置中心，也 SHALL NOT 丢弃草稿

#### Scenario: Tab 切页
- **WHEN** 用户在子面板按 Tab
- **THEN** 系统 SHALL 退出子面板并切换到下一个 Tab
- **THEN** 常规 Tab 草稿 SHALL 继续保留

#### Scenario: 未保存修改受统一放弃确认保护
- **WHEN** 用户从子面板返回常规 Tab、使常规 Tab 处于未保存状态并尝试关闭配置中心
- **THEN** 系统 SHALL 显示既有的统一放弃确认
- **THEN** 只有用户确认放弃后系统 SHALL 关闭配置中心且不写入状态栏显示项草稿

#### Scenario: 极小高度保留焦点
- **WHEN** footer 可用高度不足以容纳外框、Tab strip 与全部 7 行
- **THEN** 子面板 SHALL 保留包含当前焦点的行窗口
- **THEN** 配置行 SHALL 被省略而不是挤掉当前焦点行

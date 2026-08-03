# response-time-commands Specification

## Purpose
TBD - created by archiving change support-commands-during-response. Update Purpose after archive.
## Requirements
### Requirement: Slash command 显式声明响应期可用性
系统 SHALL 允许 slash command handler 显式声明其可在 active assistant turn 期间启动。未声明该能力的 handler SHALL 默认仅在普通空闲提交路径启动；系统 SHALL 在实际启动时强制检查该声明，而不得仅依赖可见 suggestion 作为边界。

#### Scenario: 未声明命令默认不可立即启动
- **WHEN** active assistant turn 正在 thinking、streaming、执行工具或等待 continuation
- **AND** 用户提交一个未声明响应期可用的 slash command
- **THEN** 系统 SHALL NOT 在当前 assistant turn 期间启动该 handler
- **THEN** 当前 assistant turn SHALL 继续运行

#### Scenario: 声明允许的命令立即启动
- **WHEN** active assistant turn 正在运行
- **AND** 用户提交一个已声明响应期可用的 slash command
- **THEN** command runtime SHALL 立即启动对应 handler
- **THEN** 系统 SHALL NOT 将该命令加入 pending message
- **THEN** 系统 SHALL NOT 中断当前 assistant turn

#### Scenario: 其他 busy 状态不借用响应期能力
- **WHEN** 系统处于 shell command、手动 compact 或 MCP bootstrap 状态且没有 active assistant turn
- **AND** 用户提交一个声明响应期可用的命令
- **THEN** 系统 SHALL 遵循该 busy 状态原有的提交阻止语义
- **THEN** 系统 SHALL NOT 仅因命令声明而启动 handler

### Requirement: 响应期间 suggestion 只展示允许命令
系统 SHALL 在 active assistant turn 期间继续提供 slash suggestions，但候选 SHALL 仅包含显式声明响应期可用的命令。空闲状态 SHALL 继续展示完整的内置命令和 enabled skill 候选；active command session 或其他高优先级输入 surface 接管期间 SHALL 隐藏 slash suggestions。

#### Scenario: 响应期间输入 slash 前缀
- **WHEN** active assistant turn 正在运行
- **AND** 用户在 composer 输入 `/` 或响应期命令前缀
- **THEN** suggestion SHALL 展示匹配且声明响应期可用的命令
- **THEN** suggestion SHALL NOT 展示其他命令、agent workflow 或 direct skill invocation

#### Scenario: 响应期间补全并执行命令
- **WHEN** 响应期 suggestion 正在显示
- **AND** 用户使用 Up、Down、Tab 或 Enter 选择并提交候选
- **THEN** suggestion SHALL 保持既有选择和补全语义
- **THEN** 提交后的允许命令 SHALL 立即启动而不进入 pending 单槽

#### Scenario: 空闲时保留完整候选
- **WHEN** 当前没有 active assistant turn 且没有高优先级输入 surface
- **AND** 用户输入 slash 前缀
- **THEN** suggestion SHALL 继续包含匹配的默认命令和 enabled skills

### Requirement: 响应期 command surface 与 assistant turn 并行
系统 SHALL 允许响应期命令打开、更新和关闭现有 command surface，同时让当前 assistant thinking、streaming、tool continuation 和 transcript 提交继续运行。Command surface SHALL 接管其活跃期间的输入，Esc SHALL 优先遵循 surface 的关闭或取消语义，而不得直接中断被遮挡的 assistant turn。

#### Scenario: 流式输出期间打开并交互 surface
- **WHEN** active assistant turn 正在 streaming
- **AND** 响应期命令打开 command surface
- **THEN** 用户 SHALL 能按该 surface 的既有按键语义进行选择、滚动、确认或关闭
- **THEN** provider stream 和 agent continuation SHALL 继续运行

#### Scenario: Esc 优先关闭 command surface
- **WHEN** command surface 在 active assistant turn 期间可见
- **AND** 用户按下 Esc
- **THEN** 系统 SHALL 将 Esc 交给当前 command session
- **THEN** 系统 SHALL NOT 因该按键中断后台 assistant turn

#### Scenario: 高优先级 agent 请求暂时覆盖 command surface
- **WHEN** 响应期 command surface 正在显示
- **AND** 当前 assistant turn 发起 tool approval 或 user question 请求
- **THEN** 对应高优先级 surface SHALL 接管显示和输入
- **THEN** 请求结束后仍活跃的 command surface SHALL 可重新显示

### Requirement: Surface 并存时 footer 重绘保持有界
系统 SHALL 在普通 command surface 与 assistant pending 状态并存时继续把两者作为同一 footer transient 区域渲染。每次更新 SHALL 清理上一帧已记录的完整 footer 高度，新的 footer 总行数 SHALL 不超过 `rows - 2`；空间不足时 pending 正文 MAY 暂时隐藏，但其最新状态 MUST 保留并在 surface 关闭后恢复投影。BTW command session SHALL 使用独立全视图投影：后台主 pending 只投影为有界 MAIN activity 摘要，后台主稳定 transcript SHALL 保存但不得 append 到 BTW 视图。

#### Scenario: 普通 Surface 打开期间持续收到 token
- **WHEN** 非 BTW command surface 正在显示且 provider 持续发送 streaming token
- **THEN** 系统 SHALL 更新内存中的最新 assistant draft
- **THEN** footer renderer SHALL 清除上一帧 transient footer 后再绘制当前 surface 帧
- **THEN** 系统 SHALL NOT 把 streaming draft 提交为 transcript record

#### Scenario: 普通 Surface 关闭后恢复最新 preview
- **WHEN** 非 BTW command surface 打开期间 assistant draft 已继续增长
- **AND** 用户关闭 command surface 时 assistant turn 仍在运行
- **THEN** 普通 composer footer SHALL 投影关闭时最新的 pending draft 或等价 activity 状态
- **THEN** footer SHALL NOT 恢复过期的旧 draft

#### Scenario: 普通 Surface 期间追加稳定 transcript
- **WHEN** 非 BTW command surface 打开期间 assistant turn 产生 reasoning、tool 或最终 assistant transcript record
- **THEN** renderer SHALL 清除当前 footer、追加稳定 transcript block 并重新绘制仍活跃的 surface
- **THEN** command surface SHALL NOT 被写入 transcript journal

#### Scenario: BTW 期间主稳定记录仅保存
- **WHEN** BTW command session 活跃且后台主 turn 产生稳定 transcript record
- **THEN** 系统 SHALL 更新并持久化主 transcript
- **THEN** renderer SHALL NOT append 该主 record 到 BTW 视图
- **THEN** BTW footer SHALL 继续满足有界高度约束

### Requirement: Command session 禁止静默覆盖
系统 SHALL 保持最多一个 active command session。已有 command session 时，command runtime SHALL NOT 启动另一个 handler 或用新 session 静默替换当前 session；queued slash command SHALL 等待当前 session 关闭后再按正常路由处理，普通 queued 用户消息 MAY 在 surface 打开期间自动开始下一轮 assistant turn。

#### Scenario: Queued command 等待已有 surface 关闭
- **WHEN** active assistant turn 结束时存在 queued slash command
- **AND** 当前已有 active command session
- **THEN** 系统 SHALL 保留 queued command 而不 claim 或启动
- **THEN** 当前 command surface SHALL 保持不变

#### Scenario: Surface 关闭后继续 queued command
- **WHEN** queued slash command 因 active command session 而等待
- **AND** 用户关闭当前 command session
- **THEN** 系统 SHALL 再次尝试通过正常 command 路由处理 queued command
- **THEN** queued command SHALL 至多启动一次

#### Scenario: 普通 queued 消息不被只读 surface 阻塞
- **WHEN** active assistant turn 结束时存在 queued 普通用户消息
- **AND** 当前响应期 command surface 仍然打开
- **THEN** 系统 SHALL 原子 claim 该普通消息并开始下一次 user turn
- **THEN** 当前 command session MAY 保持打开并继续接管输入

### Requirement: 首批开放命令保持保守边界
系统 SHALL 允许 `/help`、`/status`、`/context`、`/usage`、`/copy` 和 `/btw` 在 active assistant turn 期间立即启动。除 `/copy` 既有的成功 `local_notice` 和 `/btw` 的临时旁路状态外，以修改主 transcript/session、当前运行环境、interaction mode、模型配置或主 agent 提交语义为主要行为的其他既有命令 SHALL 保持响应期不可立即启动。

#### Scenario: 响应期只读与 BTW 命令可发现
- **WHEN** active assistant turn 期间用户输入 `/`
- **THEN** suggestion SHALL 能包含 `/help`、`/status`、`/context`、`/usage`、`/copy` 和 `/btw`

#### Scenario: BTW 响应期立即启动
- **WHEN** active assistant turn 正在 thinking、streaming、执行工具或等待 continuation
- **AND** 用户提交 `/btw` 或 `/btw <问题>`
- **THEN** command runtime SHALL 立即启动 BTW handler
- **THEN** 系统 SHALL NOT 把该命令加入主 pending message或中断后台 assistant turn

#### Scenario: 状态修改命令不进入响应期候选
- **WHEN** active assistant turn 期间用户输入 `/`
- **THEN** suggestion SHALL NOT 包含 `/clear`、`/compact`、`/undo`、`/fork`、`/resume`、`/mode`、`/model`、`/effort`、`/config`、`/mcp`、`/skills`、`/memory`、agent workflow 或 direct skill invocation


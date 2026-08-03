## MODIFIED Requirements

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


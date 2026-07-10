## ADDED Requirements

### Requirement: transcript 视觉标记
系统 SHALL 使用轻量符号和克制颜色区分 transcript 中的用户消息、assistant 消息和 pending assistant，而不是在 transcript 中显示 `user:` 或 `assistant:` 文本标签。

#### Scenario: 用户消息使用轻量前缀
- **WHEN** 用户消息被追加到 transcript
- **THEN** 该消息 SHALL 使用与 composer prompt 一致的 `>` 作为前缀，并使用覆盖整条消息行的灰色背景与 assistant 消息区分

#### Scenario: assistant 完成消息使用独立前缀
- **WHEN** assistant 消息完成并追加到 transcript
- **THEN** 该消息 SHALL 使用 `◆` 或等价符号作为前缀，并使用与用户消息不同的视觉样式

#### Scenario: transcript 不显示文字角色标签
- **WHEN** user 或 assistant 消息被渲染为 transcript block
- **THEN** transcript SHALL NOT 显示 `user:` 或 `assistant:` 作为消息前缀

### Requirement: 消息布局一致性
系统 SHALL 让 user transcript、assistant transcript 和 pending assistant preview 使用一致的紧凑消息布局。

#### Scenario: 标记和文本同一行开始
- **WHEN** 渲染 user、assistant 或 pending assistant 的首行内容
- **THEN** 消息前缀和首行文本 SHALL 出现在同一行

#### Scenario: 多行内容按文本列对齐
- **WHEN** 消息内容包含换行或发生自动 wrap
- **THEN** 后续行 SHALL 按首行文本起始列缩进，而不是重复角色标记

#### Scenario: assistant 完成时布局不跳变
- **WHEN** pending assistant streaming 完成并提交为正式 assistant transcript
- **THEN** 文本起始列、多行缩进和垂直位置 SHALL 保持一致，允许状态符号从 pending 样式变为完成样式

#### Scenario: user 与 assistant 之间保留呼吸空间
- **WHEN** 用户消息被追加后 assistant pending preview 或正式 assistant transcript 被渲染
- **THEN** user 消息和 assistant 区域之间 SHALL 至少保留一行空白间隔

#### Scenario: composer 与上方内容之间显示分割线
- **WHEN** footer 被渲染
- **THEN** composer 上方 SHALL 显示一条弱强调分割线，用于区分 transcript 或 pending preview 与输入区

### Requirement: assistant thinking spinner
系统 SHALL 在 assistant thinking 阶段显示 spinner 动画，并在 thinking 结束后停止该动画。

#### Scenario: thinking 阶段显示 spinner
- **WHEN** 用户提交消息且 assistant 处于 thinking delay
- **THEN** footer pending preview SHALL 显示会周期变化的点阵或星形 spinner frame

#### Scenario: spinner 不改变消息布局
- **WHEN** spinner frame 更新
- **THEN** pending preview SHALL 只更新状态符号或状态片段，不改变消息文本起始列

#### Scenario: streaming 开始后停止 spinner
- **WHEN** assistant 开始逐字 streaming 用户原始输入
- **THEN** spinner timer SHALL 停止，并且 pending preview SHALL 切换为 streaming 内容布局

#### Scenario: 退出时清理 spinner
- **WHEN** 用户在 thinking 或 streaming 期间退出应用
- **THEN** 应用 SHALL 清理 spinner timer 并恢复终端状态

### Requirement: banner 和 hint 视觉层级
系统 SHALL 以低噪音方式呈现启动 banner 和 footer hint，使它们提供上下文但不抢占 transcript 和 composer 的视觉焦点。

#### Scenario: banner 显示 session 信息
- **WHEN** 应用启动
- **THEN** banner SHALL 显示 `echo_tui`、cwd、Node 版本、TTY 尺寸和运行模式等 session 信息

#### Scenario: banner 装饰保持克制
- **WHEN** banner 被渲染
- **THEN** banner SHALL 使用简洁 session 文本，不在底部追加会与 footer divider 重叠的整行分隔线，也不使用重装饰卡片或大面积边框

#### Scenario: hint 保持一行弱强调
- **WHEN** footer 被渲染
- **THEN** hint SHALL 保持固定 1 行，并使用 dim 或等价弱强调样式

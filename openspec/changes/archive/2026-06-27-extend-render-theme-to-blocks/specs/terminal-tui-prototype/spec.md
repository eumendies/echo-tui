## MODIFIED Requirements

### Requirement: transcript 视觉标记
系统 SHALL 使用轻量符号和克制 theme token 区分 transcript 中的用户消息、assistant 消息、本地 error 消息、本地中断提示和 pending assistant，而不是在 transcript 中显示 `user:`、`assistant:` 或 `error:` 文本标签。用户消息 SHALL 使用 quote-style 粗竖条前缀和覆盖整条消息行的背景；用户消息的整行背景 SHALL 在渲染投影阶段按当前终端宽度计算。assistant 消息内容 SHALL 支持 Markdown-aware terminal projection，包括 table-aware projection；role 视觉标记 SHALL 继续由 transcript renderer 控制，颜色 SHALL 来自当前 render theme。

#### Scenario: 用户消息使用粗竖条前缀
- **WHEN** 用户消息被追加到 transcript
- **THEN** 该消息 SHALL 使用 `▌` 或等价粗竖条作为前缀
- **THEN** 该前缀 SHALL 使用当前 render theme 的 user prefix 或等价 token 显示
- **THEN** 该消息 SHALL 使用覆盖整条消息行的 theme 背景与 assistant 消息区分
- **THEN** 用户消息块的上下 padding 行 SHALL 同样显示该粗竖条前缀并使用相同 theme 背景

#### Scenario: 用户消息 resize 后背景覆盖当前宽度
- **WHEN** 用户消息已经追加到 transcript 且终端随后变窄或变宽
- **THEN** 用户消息 SHALL 基于当前终端宽度重新渲染，背景 SHALL 覆盖重新 wrap 后每一行的当前渲染宽度
- **THEN** 重新渲染后的用户消息内容行和 padding 行 SHALL 继续显示粗竖条前缀
- **THEN** 重绘 SHALL 使用当前进程 render theme，而不是保存时的旧 ANSI 输出

#### Scenario: assistant 完成消息使用独立前缀
- **WHEN** assistant 消息完成并追加到 transcript
- **THEN** 该消息 SHALL 使用 `◆` 或等价符号作为前缀，并使用与用户消息不同的 theme 样式
- **THEN** 该消息内容 SHALL 按 Markdown-aware terminal projection 显示

#### Scenario: assistant table 消息保持 role 前缀
- **WHEN** assistant 消息包含 Markdown table 并被追加到 transcript
- **THEN** 该消息 SHALL 使用 `◆` 或等价符号作为首条可见行前缀
- **THEN** table continuation lines SHALL 与 assistant block 的视觉缩进保持一致
- **THEN** table 结构色 SHALL 使用当前 render theme 的 Markdown table token

#### Scenario: error 消息使用独立可见投影
- **WHEN** 本地 error record 被追加或恢复到 transcript
- **THEN** 该消息 SHALL 使用区别于 user 和 assistant 的 theme 样式
- **THEN** 该消息 SHALL NOT 显示为 `assistant` 回复

#### Scenario: 本地中断提示使用独立可见投影
- **WHEN** 本地中断提示 record 被追加或恢复到 transcript
- **THEN** 该消息 SHALL 使用区别于 user、assistant 和 error 的克制 theme 样式
- **THEN** 该消息 SHALL NOT 显示为 assistant 回复或 error 反馈

#### Scenario: transcript 不显示文字角色标签
- **WHEN** user、assistant 或 error 消息被渲染为 transcript block
- **THEN** transcript SHALL NOT 显示 `user:`、`assistant:` 或 `error:` 作为消息前缀

### Requirement: banner 和 status line 视觉层级
系统 SHALL 以低噪音方式呈现启动 banner 和 footer status line，使它们提供上下文但不抢占 transcript 和 composer 的视觉焦点。banner 和 status line 的颜色 SHALL 来自当前 render theme。

#### Scenario: banner 显示 session 信息
- **WHEN** 应用启动
- **THEN** banner SHALL 显示 `echo_tui`、cwd、Node 版本、TTY 尺寸和运行模式等 session 信息
- **THEN** banner 标题、边框、分割线和弱化元信息 SHALL 使用当前 render theme token

#### Scenario: banner 装饰保持克制
- **WHEN** banner 被渲染
- **THEN** banner SHALL 使用简洁 session 文本，不在底部追加会与 transcript/composer spacer 重叠的整行装饰线，也不使用重装饰卡片或大面积边框
- **THEN** theme override SHALL NOT 改变 banner 的布局层级或输出信息集合

#### Scenario: status line 保持一行弱强调
- **WHEN** footer 被渲染
- **THEN** status line SHALL 保持固定 1 行，并使用 theme token 表达弱强调样式

### Requirement: 上下文压缩提示块
系统 SHALL 在一次上下文压缩发生后，于 transcript 中插入一个克制的可见提示块，告知用户较早历史已被压缩为摘要。提示块 SHALL 区别于 user、assistant 和 error 消息样式。resume 渲染 SHALL 只渲染完整 `records[]`，SHALL NOT 把压缩摘要文本作为 transcript 内容显示。

#### Scenario: 压缩后显示提示块
- **WHEN** 一次上下文压缩完成
- **THEN** 系统 SHALL 在 transcript 中显示一个提示块，说明较早历史已被压缩为摘要
- **THEN** 该提示块 SHALL 使用区别于 user、assistant 和 error 的克制 theme 样式

#### Scenario: resume 不显示压缩摘要内容
- **WHEN** 用户恢复一个已发生压缩的 session
- **THEN** 系统 SHALL 按现有方式渲染完整 `records[]`
- **THEN** 系统 SHALL NOT 把压缩摘要文本作为 transcript 消息显示出来

### Requirement: reasoning summary 可见渲染
系统 SHALL 为 `reasoning_summary` transcript record 提供区别于 user、assistant、error 和 tool result 的低强调可见投影。该投影 SHALL 根据当前 terminal width 和当前 render theme 重新计算，且 SHALL NOT 改变 transcript record 的原始文本。

#### Scenario: 渲染 reasoning summary
- **WHEN** transcript records 包含 `reasoning_summary` record
- **THEN** renderer SHALL 生成低强调的 reasoning summary 消息块
- **THEN** 该消息块 SHALL 使用区别于 assistant final answer 的前缀或 theme 样式
- **THEN** 渲染 SHALL NOT 把该 record 当作 Markdown assistant final message 处理

#### Scenario: resize 后重新投影 reasoning summary
- **WHEN** 当前 transcript records 包含 `reasoning_summary` record，且 terminal columns 变化触发 app snapshot 重绘
- **THEN** reasoning summary SHALL 按新的 terminal width 重新计算可见投影
- **THEN** 重绘 SHALL 使用当前进程 render theme
- **THEN** 重绘 SHALL NOT 删除、隐藏或改写该 summary record

## ADDED Requirements

### Requirement: render theme 覆盖历史区和 pending preview
系统 SHALL 在 transcript append、streaming pending preview、tool call preview、shell output preview、destructive resize replay 和 final render 中复用同一个当前进程 render theme。theme SHALL 只影响可见投影，不改变 transcript、pending state 或 tool result 原始数据。

#### Scenario: transcript append 使用当前 theme
- **WHEN** 新 transcript record 被追加并渲染
- **THEN** app renderer SHALL 使用当前 render state 中的 theme 渲染该 record
- **THEN** footer 清理和重绘 SHALL 继续使用同一 theme

#### Scenario: destructive replay 使用当前 theme
- **WHEN** terminal resize 触发 destructive replay
- **THEN** banner、transcript lines 和 footer SHALL 使用同一份当前 render theme 重新投影
- **THEN** replay SHALL NOT 使用旧 ANSI 输出或持久化样式

#### Scenario: pending preview 使用当前 theme
- **WHEN** assistant streaming、tool call preview 或 shell output preview 被渲染
- **THEN** pending preview 的前缀、弱化文本、shell 输出样式和 summary 行 SHALL 使用当前 render theme 中对应 token
- **THEN** pending preview 高度预算、tail collapse 和 markdown projection 语义 SHALL 保持不变

### Requirement: tool block 可配置视觉与固定事实色
系统 SHALL 让 tool call/result 的普通 chrome 视觉使用当前 render theme，同时保持文件修改事实语义色稳定。tool call 符号、成功/失败状态、普通 result 输出和弱化文本 MAY 使用 theme token；apply_patch added/removed 行背景 SHALL 使用代码内固定红绿语义色。

#### Scenario: 通用 tool block 使用 theme
- **WHEN** tool_call 或 tool_result record 渲染为 transcript block
- **THEN** tool call 前缀、成功/失败状态和普通 result 输出 SHALL 使用当前 render theme 中对应 tool token
- **THEN** 渲染 SHALL NOT 改写 tool record text、display metadata 或 toolCallId

#### Scenario: apply_patch 增删背景固定
- **WHEN** apply_patch tool result 包含 added 或 removed 行
- **THEN** added 行 SHALL 使用固定新增语义背景
- **THEN** removed 行 SHALL 使用固定删除语义背景
- **THEN** theme override SHALL NOT 改变这些 added/removed 行背景

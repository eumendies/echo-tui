## ADDED Requirements

### Requirement: transcript 内容记录与重绘快照分离
系统 SHALL 将 transcript 的内容记录与 ANSI 渲染结果分离：已提交消息内容只追加记录，渲染层可以根据当前终端尺寸重新生成当前 app snapshot 的可见输出。

#### Scenario: 用户提交只追加内容记录
- **WHEN** 用户使用 Enter 提交 composer 内容
- **THEN** 应用 SHALL 追加一个 user transcript record，并且不修改更早的 transcript record 内容

#### Scenario: assistant 完成只追加内容记录
- **WHEN** mock assistant 完成响应流式输出
- **THEN** 应用 SHALL 追加一个 assistant transcript record，内容为完成后的 assistant 输出

#### Scenario: shrink recovery 从当前状态重建快照
- **WHEN** 终端宽度变化
- **THEN** 应用 SHALL 基于已有 transcript records、当前 terminal size 和 footer state 重新生成当前 app snapshot 的渲染输出

### Requirement: 列宽变化的 destructive resize recovery
系统 SHALL 在终端列宽变化时允许 destructive recovery：清可见屏幕、清 scrollback、回到左上角，并从当前状态完整重绘 app snapshot。

#### Scenario: 列宽变化时触发 destructive recovery
- **WHEN** 最新 terminal columns 不等于上一次 render 时记录的 columns
- **THEN** 应用 SHALL 进入 destructive recovery，而不是继续依赖旧输出物理行数估算来局部擦除

#### Scenario: destructive recovery 清 screen 与 scrollback
- **WHEN** terminal columns 发生变化并触发 destructive recovery
- **THEN** 应用 SHALL 重置滚动区域与文本样式，清可见屏幕，清 scrollback，并把光标移动到左上角后再开始重绘

#### Scenario: destructive recovery 重绘完整快照
- **WHEN** terminal columns 发生变化并触发 destructive recovery
- **THEN** 新的可见屏幕 SHALL 包含 banner、transcript projection、pending preview、footer divider、composer 和 hint 的完整当前快照

#### Scenario: destructive recovery 后光标回到 composer 逻辑位置
- **WHEN** 用户在输入、thinking 或 streaming 期间触发 terminal columns 变化
- **THEN** destructive recovery 完成后可见光标 SHALL 回到 composer 当前逻辑光标位置

### Requirement: 终端 resize 渲染稳定性
系统 SHALL 在终端尺寸变化后保持布局稳定，并按当前宽度重新计算 transcript、pending preview、footer divider、composer 和 hint。

#### Scenario: resize 后分割线保持单行
- **WHEN** 终端宽度变窄或变宽并触发重绘
- **THEN** composer 上方的 footer divider SHALL 按当前终端宽度重新计算并保持 1 行显示，不得因为写满最后一列产生额外分割线行

#### Scenario: resize 后清理旧高度
- **WHEN** resize 前后的 transcript projection、pending preview、divider、composer 或 hint 总行数不同
- **THEN** renderer SHALL 选择合适的重绘方式：普通 redraw 或 destructive recovery，并保证新的可见布局正确

#### Scenario: 列宽变化后不残留旧输出
- **WHEN** 长消息或宽背景行在列宽变化后被终端重新折成不同的物理行数
- **THEN** destructive recovery 后的当前 screen SHALL NOT 残留重复 banner、重复 transcript、旧宽度灰底或多条 divider

#### Scenario: resize 后光标回到 composer 逻辑位置
- **WHEN** 用户在输入中 resize 终端
- **THEN** 重绘后可见光标 SHALL 回到 composer 当前逻辑光标位置

#### Scenario: streaming 中 resize 保持 pending 布局
- **WHEN** assistant thinking 或 streaming 期间发生 resize
- **THEN** pending preview、footer divider、composer 和 hint SHALL 按新宽度整体重绘，并保持相对顺序不变

### Requirement: shrink recovery 后的屏幕快照自洽
系统 SHALL 在 destructive recovery 后呈现一份自洽的当前屏幕快照，而不是只重绘 footer 或局部区域。

#### Scenario: 启动时显示 banner
- **WHEN** 应用进入交互模式
- **THEN** 应用 SHALL 在已有 terminal 输出之后显示一次启动 banner

#### Scenario: shrink recovery 后当前屏幕包含 banner
- **WHEN** destructive recovery 完成
- **THEN** 当前屏幕中的 app snapshot SHALL 包含启动 banner 提供的 session 上下文

## MODIFIED Requirements

### Requirement: 当前终端执行
系统 SHALL 在当前终端中运行，不切换到 alternate screen。系统在启动时仍应追加到已有终端内容之后，但在列宽变化的 destructive recovery 中 MAY 清可见屏幕和 scrollback。

#### Scenario: 应用启动在已有输出之后
- **WHEN** 应用启动
- **THEN** 应用 SHALL 在已有 terminal scrollback 之后追加 banner 和 UI，而不是在启动时清空屏幕

#### Scenario: 不使用 alternate screen
- **WHEN** 应用运行
- **THEN** 应用 SHALL NOT 输出进入或离开 alternate screen 的 ANSI 序列

#### Scenario: 列宽变化时允许清 screen 和 scrollback
- **WHEN** terminal columns 变化触发 destructive recovery
- **THEN** 应用 MAY 清当前 visible screen 和 scrollback，以保证后续完整重绘的布局稳定性

### Requirement: transcript 视觉标记
系统 SHALL 使用轻量符号和克制颜色区分 transcript 中的用户消息、assistant 消息和 pending assistant，而不是在 transcript 中显示 `user:` 或 `assistant:` 文本标签。用户消息的整行背景 SHALL 在渲染投影阶段按当前终端宽度计算。

#### Scenario: 用户消息使用轻量前缀
- **WHEN** 用户消息被追加到 transcript
- **THEN** 该消息 SHALL 使用与 composer prompt 一致的 `>` 作为前缀，并使用覆盖当前渲染行宽度的灰色背景与 assistant 消息区分

#### Scenario: 用户消息 resize 后背景覆盖当前宽度
- **WHEN** 用户消息已经追加到 transcript 且终端随后变窄或变宽
- **THEN** 用户消息 SHALL 基于当前终端宽度重新渲染，灰色背景 SHALL 覆盖重新 wrap 后每一行的当前渲染宽度

#### Scenario: assistant 完成消息使用独立前缀
- **WHEN** assistant 消息完成并追加到 transcript
- **THEN** 该消息 SHALL 使用 `◆` 或等价符号作为前缀，并使用与用户消息不同的视觉样式

#### Scenario: transcript 不显示文字角色标签
- **WHEN** user 或 assistant 消息被渲染为 transcript block
- **THEN** transcript SHALL NOT 显示 `user:` 或 `assistant:` 作为消息前缀

### Requirement: append-only transcript
系统 SHALL 把已提交的用户消息和已完成的 assistant 消息作为 append-only transcript content records 处理，同时允许渲染层重算这些 records 在当前 app snapshot 中的可见投影。

#### Scenario: 用户提交追加 transcript record
- **WHEN** 用户使用 Enter 提交 composer 内容
- **THEN** 应用 SHALL 向 transcript records 追加一个用户消息记录，并且不修改更早的 transcript record 内容

#### Scenario: assistant 完成后追加 transcript record
- **WHEN** mock assistant 完成响应流式输出
- **THEN** 应用 SHALL 追加一个 assistant 消息记录，内容为完成后的 assistant 输出

#### Scenario: 历史 transcript 内容不被修改
- **WHEN** footer 在输入、streaming 或 resize 期间重绘
- **THEN** 已提交的 transcript record 内容 SHALL 保持不变，但其在当前 app snapshot 中的可见渲染 SHALL 可以按当前宽度重新计算

#### Scenario: destructive recovery 不改变消息事实内容
- **WHEN** terminal columns 变化触发 destructive recovery
- **THEN** 应用 MAY 清 screen 和 scrollback 并重绘消息，但 SHALL NOT 改写已提交 transcript record 的事实内容

### Requirement: 消息布局一致性
系统 SHALL 让 user transcript、assistant transcript 和 pending assistant preview 使用一致的紧凑消息布局，并根据当前终端宽度计算 wrap、缩进和背景覆盖宽度。

#### Scenario: 标记和文本同一行开始
- **WHEN** 渲染 user、assistant 或 pending assistant 的首行内容
- **THEN** 消息前缀和首行文本 SHALL 出现在同一行

#### Scenario: 多行内容按文本列对齐
- **WHEN** 消息内容包含换行或发生自动 wrap
- **THEN** 后续行 SHALL 按首行文本起始列缩进，而不是重复角色标记

#### Scenario: 中文宽字符 wrap 后缩进正确
- **WHEN** 中文长文本因终端宽度发生 wrap
- **THEN** wrap 后的后续行 SHALL 保持与文本列对齐，不得因为直接使用 `string.length` 计算列宽而错位

#### Scenario: assistant 完成时布局不跳变
- **WHEN** pending assistant streaming 完成并提交为正式 assistant transcript
- **THEN** 文本起始列、多行缩进和垂直位置 SHALL 保持一致，允许状态符号从 pending 样式变为完成样式

#### Scenario: user 与 assistant 之间保留呼吸空间
- **WHEN** 用户消息被追加后 assistant pending preview 或正式 assistant transcript 被渲染
- **THEN** user 消息和 assistant 区域之间 SHALL 至少保留一行空白间隔

#### Scenario: composer 与上方内容之间显示分割线
- **WHEN** footer 被渲染
- **THEN** composer 上方 SHALL 显示一条弱强调分割线，用于区分 transcript 或 pending preview 与输入区

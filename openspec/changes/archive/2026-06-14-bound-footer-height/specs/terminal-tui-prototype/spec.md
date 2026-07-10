## ADDED Requirements

### Requirement: footer 临时区域高度受限
系统 SHALL 在每次生成 footer layout 时遵守全局高度上限。当 terminal rows 已知时，footer layout 的总行数 SHALL 不超过 `rows - 2`，为屏幕顶部保留两行安全空间，避免 footer 内容进入 scrollback 后导致局部清理不完整。

#### Scenario: 长 footer 不超过终端高度预算
- **WHEN** render state 包含长 pending preview、working line、divider 和 command surface
- **AND** terminal rows 为 12
- **THEN** footer layout SHALL 最多包含 10 行
- **THEN** footer renderer 后续 SHALL 能通过局部 clear 清理上一帧 footer 可见内容

#### Scenario: 未知 rows 使用稳定默认预算
- **WHEN** render state 未提供 terminal rows
- **THEN** footer layout SHALL 使用稳定默认终端行数计算高度预算
- **THEN** footer layout SHALL 仍避免因无界 pending 或 command surface 生成无限高度

#### Scenario: 极小 rows 不产生非法布局
- **WHEN** terminal rows 小于或等于 2
- **THEN** footer layout SHALL 至少返回一个可渲染行或等价安全布局
- **THEN** cursor row SHALL 位于返回的 layout lines 范围内

### Requirement: composer 高度窗口化
普通 composer footer SHALL 设置独立最大可见高度，不能因为 terminal rows 足够大而占满 `rows - 2` 的全局 footer 预算。普通 composer footer 在输入超过自身最大高度或可用高度不足以显示完整输入时，只显示包含当前光标行的可见窗口。被挤出的 composer 行 SHALL 不显示省略提示；renderer SHALL 重新计算裁剪后的 cursor row 和 cursor column。

#### Scenario: 多行 composer 顶部被挤出
- **WHEN** composer 文本包含超过可用高度的多行内容
- **AND** 光标位于最后一行
- **THEN** footer SHALL 显示 composer 的尾部可见窗口
- **THEN** footer SHALL NOT 显示 `...` 或 `…` 表示被隐藏的 composer 行
- **THEN** footer layout SHALL 将 cursor row 指向可见窗口中的光标行

#### Scenario: 光标上移后保持光标附近可见
- **WHEN** composer 文本包含超过可用高度的多行内容
- **AND** 光标移动到中间某一行
- **THEN** footer SHALL 显示包含该光标行的 composer 窗口
- **THEN** footer layout SHALL 将 cursor row 和 cursor column 指向裁剪后的可见光标位置

#### Scenario: 大终端中 composer 仍受自身高度上限约束
- **WHEN** terminal rows 足够大且 composer 文本包含很多行
- **THEN** 普通 composer SHALL 最多显示自身高度上限内的行数
- **THEN** 普通 composer SHALL NOT 占满 `rows - 2` 的全部 footer 高度预算

### Requirement: pending preview 高度受限
所有 pending preview SHALL 接受 footer 剩余高度预算。streaming pending 和 tool call pending 都 SHALL 在预算内渲染，不得因长文本、长 bash command 或长 tool arguments 绕过 footer 全局高度限制。

#### Scenario: 长 streaming pending 受限
- **WHEN** assistant streaming pending 文本渲染后超过 footer 剩余预算
- **THEN** footer SHALL 只显示预算内的 streaming preview 行
- **THEN** footer SHALL 显示摘要或尾部内容以表达输出被裁剪

#### Scenario: 长 tool call pending 受限
- **WHEN** tool call pending 包含很长的 `run_bash_command` command 或很长的 arguments 文本
- **THEN** footer SHALL 只显示预算内的 tool call preview 行
- **THEN** footer layout 的总行数 SHALL 仍不超过 `rows - 2`

### Requirement: slash suggestion 高度窗口化
slash suggestion 列表 SHALL 在 footer 高度预算内渲染。当候选数量超过可见预算时，renderer SHALL 显示包含当前 selectedIndex 的候选窗口，而不是渲染全部候选。

#### Scenario: slash 候选过多时窗口化
- **WHEN** composer 输入 `/` 且 slash command 与 enabled skill 候选数量超过可见预算
- **THEN** footer SHALL 只显示候选窗口
- **THEN** 当前 selectedIndex 对应候选 SHALL 保持可见
- **THEN** footer SHALL 显示 `↑ N more`、`↓ N more` 或等价提示，告知用户窗口外仍有隐藏候选
- **THEN** footer layout 的总行数 SHALL 仍不超过 `rows - 2`

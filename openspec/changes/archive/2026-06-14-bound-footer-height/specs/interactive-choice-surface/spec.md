## ADDED Requirements

### Requirement: choice surface 高度受限
choice surface SHALL 在调用方提供的高度预算内渲染。高度不足时，choice surface SHALL 优先保留标题、全部选项、当前选中项、内联输入光标和操作提示；当高度足以容纳所有 option 行时，message SHALL 让位给全部 options。message 与非选中 options MAY 被裁剪或窗口化，但最终 layout SHALL 保持可交互。message 被裁剪时，surface SHALL 显示 `truncated`、省略号或等价提示，避免用户误以为 preview 完整显示。

#### Scenario: 长 message 被裁剪
- **WHEN** choice surface 的 message 文本换行后超过可用高度预算
- **THEN** choice surface SHALL 裁剪 message 到预算内
- **THEN** choice surface SHALL 显示被裁剪的可见提示
- **THEN** choice surface SHALL 继续显示选项区域和操作提示
- **THEN** footer layout 的 cursor row SHALL 位于可见行范围内

#### Scenario: 长 message 下优先显示全部选项
- **WHEN** choice surface 的 message 文本很长且 options 数量大于一个
- **AND** 当前高度预算足以容纳所有 option 行
- **THEN** choice surface SHALL 显示全部 options
- **THEN** choice surface SHALL 裁剪 message 为全部 options 让出空间

#### Scenario: options 过多时围绕选中项窗口化
- **WHEN** choice surface 的 options 数量超过可用高度预算
- **AND** selectedIndex 指向中间或末尾选项
- **THEN** choice surface SHALL 显示包含 selectedIndex 的 option 窗口
- **THEN** choice surface SHALL 保持可见 options 的原始相对顺序
- **THEN** choice surface SHALL NOT 为了窗口化而重新排序 allow、deny 或 inline input 选项
- **THEN** 非 choice 的普通单行候选 surface 在窗口化时 SHALL 显示 `↑ N more`、`↓ N more` 或等价提示；choice surface MAY 省略该提示以优先保留安全选项

#### Scenario: 内联输入光标保持可见
- **WHEN** choice surface 当前选中带 inline input 的 option
- **AND** choice surface 因高度限制发生窗口化
- **THEN** 该 inline input option SHALL 保持可见
- **THEN** footer layout SHALL 将 showCursor 设置为 true
- **THEN** footer layout SHALL 将 cursor row 和 cursor column 指向裁剪后可见的输入位置

### Requirement: choice surface 宽度与高度裁剪不破坏边框
choice surface SHALL 在内容被裁剪或 options 被窗口化后仍保持边框、内容行和底部提示的宽度一致。裁剪 SHALL NOT 让右边框错位或产生写满终端最后一列的自动换行。

#### Scenario: 裁剪后边框保持对齐
- **WHEN** choice surface 的 message 或 options 被高度预算裁剪
- **THEN** 可见 choice surface 行 SHALL 继续遵守 safe render width
- **THEN** 可见 choice surface 的左右边框 SHALL 保持对齐
- **THEN** footer SHALL NOT 因裁剪后的 choice surface 写满最后一列而产生额外物理行

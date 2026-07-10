## ADDED Requirements

### Requirement: choice surface 渲染内联文本输入项
choice surface SHALL 能渲染带内联文本输入能力的 option。该 option SHALL 保持普通 option 的编号、选中态和边框布局，并 SHALL 在 label 后呈现输入区域。

#### Scenario: 输入项保留编号和选中态
- **WHEN** choice surface 渲染支持内联文本输入的 option
- **THEN** 该 option SHALL 与其他 option 一样显示序号
- **THEN** 当前选中该 option 时 SHALL 继续使用 choice surface 的选中高亮样式

#### Scenario: 输入项显示 cursor
- **WHEN** choice surface 当前选中支持内联文本输入的 option
- **THEN** footer layout SHALL 将 `showCursor` 设置为 true
- **THEN** footer layout SHALL 将 cursor row 和 cursor column 指向该 option 输入文本的当前位置

#### Scenario: 输入项宽度参与面板宽度计算
- **WHEN** choice surface 包含支持内联文本输入的 option
- **THEN** choice box 宽度计算 SHALL 考虑该 option 的 label、placeholder 和当前输入文本
- **THEN** TUI SHALL 避免输入内容破坏右边框对齐

## MODIFIED Requirements

### Requirement: choice surface 视觉层级
choice surface SHALL 使用比普通 select command surface 更显眼的 card 布局呈现选择。choice card SHALL 支持可配置的正文 section 标题、正文文本样式和选项 section 标题，以便 tool approval 和用户问题复用同一套视觉结构。choice card 的颜色、焦点条、active 背景和 marker SHALL 遵循共享 footer command surface UI 语言；当前选中项 SHALL 使用 `▌` 焦点条、active 背景和 cyan 高亮文本。choice card MAY 继续使用 `●/○` 作为自身选项 marker，但普通 select 不因本要求被强制添加 `●/○`。

#### Scenario: choice surface 使用显眼容器
- **WHEN** choice surface 被渲染
- **THEN** TUI SHALL 使用边框或等价视觉容器区分 choice surface 与普通 footer 内容
- **THEN** TUI SHALL 在容器内为正文和选项区域保留可见分区
- **THEN** choice card SHALL 使用共享 footer cyan palette 表达边框、标题、分区线和焦点元素

#### Scenario: 选中项突出显示
- **WHEN** choice surface 存在当前选中项
- **THEN** TUI SHALL 使用 `▌` 焦点条、强调色、背景或等价高亮方式突出当前选中项 label
- **THEN** choice card MAY 使用 `●` marker 表达当前选中项
- **THEN** 未选中项 SHALL 不使用同等级高亮，且 MAY 使用 `○` marker 表达非选中项

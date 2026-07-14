## MODIFIED Requirements

### Requirement: choice surface 视觉层级
choice surface SHALL 使用比普通 select command surface 更显眼的 card 布局呈现选择。choice card SHALL 支持可配置的正文 section 标题、正文文本样式和选项 section 标题，以便 tool approval 和用户问题复用同一套视觉结构。choice card 的颜色、焦点条、active 背景和 marker SHALL 遵循共享 footer command surface UI 语言；当前键盘焦点项 SHALL 使用 `▌` 焦点条、active 背景和 cyan 高亮文本。choice card MAY 继续使用 `●/○` 作为自身选项 marker；在多选模式中 marker SHALL 表达对应 option 的 checked 状态。在调用方提供单选 option 的显式 selected 状态时，单选 marker SHALL 表达 selected 状态并独立于键盘焦点；未提供显式 selected 状态的既有单选调用方 SHALL 保持焦点项为当前单选答案的呈现行为。

#### Scenario: choice surface 使用显眼容器
- **WHEN** choice surface 被渲染
- **THEN** TUI SHALL 使用边框或等价视觉容器区分 choice surface 与普通 footer 内容
- **THEN** TUI SHALL 在容器内为正文和选项区域保留可见分区
- **THEN** choice card SHALL 使用共享 footer cyan palette 表达边框、标题、分区线和焦点元素

#### Scenario: 焦点项突出显示
- **WHEN** choice surface 存在当前键盘焦点项
- **THEN** TUI SHALL 使用 `▌` 焦点条、强调色、背景或等价高亮方式突出当前焦点项 label
- **THEN** 未获得键盘焦点的项 SHALL 不使用同等级高亮

#### Scenario: 兼容单选 marker 表达当前焦点答案
- **WHEN** choice surface 处于单选模式或未显式声明选择模式
- **AND** 调用方未提供 option 的显式 selected 状态
- **AND** choice surface 存在当前键盘焦点项
- **THEN** choice card MAY 使用 `●` marker 表达当前焦点项
- **THEN** 非焦点项 MAY 使用 `○` marker 表达未选中项

#### Scenario: 单选 marker 与焦点独立
- **WHEN** choice surface 的单选 option 提供显式 selected 状态
- **AND** 已选 option 与当前键盘焦点不是同一项
- **THEN** 已选 option SHALL 使用 `●` 或等价 marker 表达已选择
- **THEN** 当前键盘焦点项 SHALL 使用焦点条和 active 背景表达可操作位置
- **THEN** 当前键盘焦点移动 SHALL NOT 单独改变任何 option 的 selected marker

#### Scenario: 多选 marker 表达 checked 状态
- **WHEN** choice surface 处于多选模式
- **THEN** checked option SHALL 使用 `●` 或等价 marker 表达已勾选
- **THEN** unchecked option SHALL 使用 `○` 或等价 marker 表达未勾选
- **THEN** 当前键盘焦点 SHALL 独立于 checked 状态显示

## ADDED Requirements

### Requirement: choice surface 可选 tab 导航条
choice surface SHALL 支持调用方提供可选 tab 导航元数据。存在 tab 时，choice card SHALL 显示全部 tab、当前激活 tab 和调用方提供的完成或未完成状态；没有 tab 元数据的既有 choice surface SHALL 保持原有 card 布局和交互语义。

#### Scenario: 渲染 tab 导航条
- **WHEN** choice surface 提供两个或以上 tab
- **THEN** choice card SHALL 在其可见内容中显示 tab 导航条
- **THEN** TUI SHALL 明确表达当前激活的 tab
- **THEN** TUI SHALL 表达调用方提供的已完成、未完成或提交 tab 状态

#### Scenario: 不影响既有 choice surface
- **WHEN** choice surface 未提供 tab 元数据
- **THEN** TUI SHALL 不显示 tab 导航条
- **THEN** choice card SHALL 继续遵守既有标题、正文、选项、焦点和提示渲染规则

#### Scenario: 高度受限时保留 tab 上下文
- **WHEN** 带 tab 的 choice surface 因高度预算发生裁剪
- **THEN** TUI SHALL 优先保留当前激活 tab 的可识别信息
- **THEN** 当前焦点 option 或内联输入光标 SHALL 继续位于可见行范围内

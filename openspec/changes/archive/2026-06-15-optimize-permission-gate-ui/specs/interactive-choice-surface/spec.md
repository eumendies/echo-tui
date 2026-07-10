## MODIFIED Requirements

### Requirement: 通用 choice surface
系统 SHALL 提供通用 choice surface，用于呈现需要用户显式选择的高优先级交互。choice surface SHALL 不绑定到 slash command、tool approval 或特定工具名称，并 SHALL 能被 tool approval 与用户问题选择场景复用。choice surface SHALL 使用统一 card 投影，并通过通用 UI 字段表达标题、正文 section、正文样式、选项 section、选项、当前选中项和输入提示。

#### Scenario: 渲染通用 choice card
- **WHEN** 当前 render state 包含 choice surface
- **THEN** TUI SHALL 渲染 choice card 而不是 composer 或普通 select command surface
- **THEN** choice card SHALL 显示标题、选项和输入提示

#### Scenario: choice card 不绑定 tool approval
- **WHEN** 非 tool approval 的调用方需要向用户呈现一个选择问题
- **THEN** 系统 SHALL 能使用相同 choice card 表达标题、问题正文、选项、当前选中项和输入提示

### Requirement: choice surface 视觉层级
choice surface SHALL 使用比普通 select command surface 更显眼的 card 布局呈现选择。choice card SHALL 支持可配置的正文 section 标题、正文文本样式和选项 section 标题，以便 tool approval 和用户问题复用同一套视觉结构。

#### Scenario: choice surface 使用显眼容器
- **WHEN** choice surface 被渲染
- **THEN** TUI SHALL 使用边框或等价视觉容器区分 choice surface 与普通 footer 内容
- **THEN** TUI SHALL 在容器内为正文和选项区域保留可见分区

#### Scenario: 选中项突出显示
- **WHEN** choice surface 存在当前选中项
- **THEN** TUI SHALL 使用强调色、焦点条、背景或等价高亮方式突出当前选中项 label
- **THEN** 未选中项 SHALL 不使用同等级高亮

### Requirement: choice surface 支持逐题用户问题
choice surface SHALL 能被 `ask_user_questions` 复用来逐题显示用户问题。问题文本 SHALL 作为 choice card 的正文 section 显示，选项 SHALL 使用现有 option label 和 description 呈现规则。

#### Scenario: 显示 ask_user_questions 当前题
- **WHEN** `ask_user_questions` 请求正在等待用户回答某一道题
- **THEN** choice surface SHALL 显示当前题的问题文本
- **THEN** choice surface SHALL 显示当前题的选项
- **THEN** 如果 option 包含 description，description SHALL 继续显示在 label 下一行并使用弱化样式

#### Scenario: 多题显示进度
- **WHEN** `ask_user_questions` 请求包含多道问题
- **THEN** choice surface SHALL 显示当前题序号和总题数，或以等价方式让用户知道当前正在回答哪一道题

#### Scenario: 用户问题输入提示
- **WHEN** choice surface 用于 `ask_user_questions`
- **THEN** 输入提示 SHALL 说明 Enter 确认、Up/Down 选择、Esc 取消

### Requirement: choice surface 渲染内联文本输入项
choice surface SHALL 能渲染带内联文本输入能力的 option。该 option SHALL 保持普通 option 的 marker、选中态和边框布局，并 SHALL 在 label 后呈现输入区域。

#### Scenario: 输入项保留 marker 和选中态
- **WHEN** choice surface 渲染支持内联文本输入的 option
- **THEN** 该 option SHALL 与其他 option 一样显示 marker
- **THEN** 当前选中该 option 时 SHALL 继续使用 choice card 的选中高亮样式

#### Scenario: 输入项显示 cursor
- **WHEN** choice surface 当前选中支持内联文本输入的 option
- **THEN** footer layout SHALL 将 `showCursor` 设置为 true
- **THEN** footer layout SHALL 将 cursor row 和 cursor column 指向该 option 输入文本的当前位置

#### Scenario: 输入项宽度参与面板宽度计算
- **WHEN** choice surface 包含支持内联文本输入的 option
- **THEN** choice box 宽度计算 SHALL 考虑该 option 的 label、placeholder 和当前输入文本
- **THEN** TUI SHALL 避免输入内容破坏右边框对齐

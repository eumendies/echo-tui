# interactive-choice-surface Specification

## Purpose
定义通用 choice surface 的可见布局、选项描述呈现方式、输入提示和复用边界，用于 tool approval 和后续用户问题选择等需要显式选择的高优先级交互。
## Requirements
### Requirement: 通用 choice surface
系统 SHALL 提供通用 choice surface，用于呈现需要用户显式选择的高优先级交互。choice surface SHALL 不绑定到 slash command、tool approval 或特定工具名称，并 SHALL 能被 tool approval 与用户问题选择场景复用。choice surface SHALL 使用统一 card 投影，并通过通用 UI 字段表达标题、正文 section、正文样式、选项 section、选项、当前键盘焦点和输入提示。choice surface MAY 支持单选或多选模式；多选模式下，option 级 checked 状态 SHALL 表达该选项是否已被勾选。

#### Scenario: 渲染通用 choice card
- **WHEN** 当前 render state 包含 choice surface
- **THEN** TUI SHALL 渲染 choice card 而不是 composer 或普通 select command surface
- **THEN** choice card SHALL 显示标题、选项和输入提示

#### Scenario: choice card 不绑定 tool approval
- **WHEN** 非 tool approval 的调用方需要向用户呈现一个选择问题
- **THEN** 系统 SHALL 能使用相同 choice card 表达标题、问题正文、选项、当前键盘焦点和输入提示

#### Scenario: choice card 表达多选状态
- **WHEN** 调用方以多选模式提供 choice surface
- **THEN** 系统 SHALL 能通过 option 级 checked 状态表达每个 option 是否已被勾选
- **THEN** 系统 SHALL 继续通过当前键盘焦点表达用户正在操作的 option

### Requirement: choice surface 视觉层级
choice surface SHALL 使用比普通 select command surface 更显眼的 card 布局呈现选择。choice card SHALL 支持可配置的正文 section 标题、正文文本样式和选项 section 标题，以便 tool approval 和用户问题复用同一套视觉结构。choice card 的颜色、焦点条、active 背景和 marker SHALL 遵循共享 footer command surface UI 语言；当前键盘焦点项 SHALL 使用 `▌` 焦点条、active 背景和 cyan 高亮文本。choice card MAY 继续使用 `●/○` 作为自身选项 marker；在单选模式中 marker SHALL 表达当前焦点项是否为当前单选答案，在多选模式中 marker SHALL 表达对应 option 的 checked 状态。

#### Scenario: choice surface 使用显眼容器
- **WHEN** choice surface 被渲染
- **THEN** TUI SHALL 使用边框或等价视觉容器区分 choice surface 与普通 footer 内容
- **THEN** TUI SHALL 在容器内为正文和选项区域保留可见分区
- **THEN** choice card SHALL 使用共享 footer cyan palette 表达边框、标题、分区线和焦点元素

#### Scenario: 焦点项突出显示
- **WHEN** choice surface 存在当前键盘焦点项
- **THEN** TUI SHALL 使用 `▌` 焦点条、强调色、背景或等价高亮方式突出当前焦点项 label
- **THEN** 未获得键盘焦点的项 SHALL 不使用同等级高亮

#### Scenario: 单选 marker 表达当前焦点答案
- **WHEN** choice surface 处于单选模式或未显式声明选择模式
- **AND** choice surface 存在当前键盘焦点项
- **THEN** choice card MAY 使用 `●` marker 表达当前焦点项
- **THEN** 非焦点项 MAY 使用 `○` marker 表达未选中项

#### Scenario: 多选 marker 表达 checked 状态
- **WHEN** choice surface 处于多选模式
- **THEN** checked option SHALL 使用 `●` 或等价 marker 表达已勾选
- **THEN** unchecked option SHALL 使用 `○` 或等价 marker 表达未勾选
- **THEN** 当前键盘焦点 SHALL 独立于 checked 状态显示

### Requirement: choice option 描述换行显示
choice surface 的 option description SHALL 作为次级辅助信息显示在对应 label 之后的下一行，并 SHALL 使用灰色或弱化样式。description SHALL NOT 与 label 拼接在同一行。

#### Scenario: 选项带描述
- **WHEN** choice surface 的某个 option 同时包含 label 和 description
- **THEN** TUI SHALL 在一行显示该 option 的 label
- **THEN** TUI SHALL 在 label 后的下一行显示该 option 的 description
- **THEN** description SHALL 使用灰色或弱化样式
- **THEN** description SHALL NOT 以 `label — description` 形式和 label 显示在同一行

#### Scenario: 选项不带描述
- **WHEN** choice surface 的某个 option 没有 description
- **THEN** TUI SHALL 只显示该 option 的 label
- **THEN** TUI SHALL NOT 为该 option 生成空的 description 行

### Requirement: choice option 顺序保持调用方语义
choice surface SHALL 按调用方提供的 option 顺序渲染选项。renderer SHALL NOT 基于 label、description、inline input 或选项类型重新排序 option，以便 tool approval 等调用方表达安全相关的选项分组。

#### Scenario: 保留 tool approval allow 分组顺序
- **WHEN** tool approval 以 choice surface 提供 `Allow once`、会话级 allow、`Allow all tools for this session`、`Deny` 和 `Tell model what to do` 选项
- **THEN** TUI SHALL 按调用方提供的顺序渲染这些选项
- **THEN** 所有 allow 选项 SHALL 在视觉上连续显示

#### Scenario: inline input 不改变选项顺序
- **WHEN** choice surface 的最后一个 option 包含 inline input
- **THEN** renderer SHALL 保持该 option 的原始位置
- **THEN** renderer SHALL NOT 为了显示输入框而把该 option 移到其他选项之前

### Requirement: choice surface 终端约束
choice surface SHALL 遵循现有 TUI 终端约束，使用当前 footer 渲染机制、ANSI 控制序列和 raw mode 输入处理，不依赖 alternate screen 或第三方 TUI 库。

#### Scenario: 不使用 alternate screen
- **WHEN** choice surface 被打开、更新或关闭
- **THEN** 系统 SHALL NOT 输出进入或离开 alternate screen 的 ANSI 序列

#### Scenario: 不引入第三方 TUI 库
- **WHEN** choice surface 被实现
- **THEN** 项目 SHALL 继续使用现有 ANSI 渲染与输入处理机制
- **THEN** 项目 SHALL NOT 为 choice surface 引入第三方 TUI framework

### Requirement: choice surface 高度受限
choice surface SHALL 在调用方提供的高度预算内渲染。高度不足时，choice surface SHALL 优先保留标题、全部选项、当前键盘焦点项、内联输入光标和操作提示；当高度足以容纳所有 option 行时，message SHALL 让位给全部 options。message 与非焦点 options MAY 被裁剪或窗口化，但最终 layout SHALL 保持可交互。message 被裁剪时，surface SHALL 显示 `truncated`、省略号或等价提示，避免用户误以为 preview 完整显示。

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

#### Scenario: options 过多时围绕焦点项窗口化
- **WHEN** choice surface 的 options 数量超过可用高度预算
- **AND** focusedIndex 指向中间或末尾选项
- **THEN** choice surface SHALL 显示包含 focusedIndex 的 option 窗口
- **THEN** choice surface SHALL 保持可见 options 的原始相对顺序
- **THEN** choice surface SHALL NOT 为了窗口化而重新排序 allow、deny 或 inline input 选项
- **THEN** 非 choice 的普通单行候选 surface 在窗口化时 SHALL 显示 `↑ N more`、`↓ N more` 或等价提示；choice surface MAY 省略该提示以优先保留安全选项

#### Scenario: 内联输入光标保持可见
- **WHEN** choice surface 当前键盘焦点位于带 inline input 的 option
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
choice surface SHALL 能渲染带内联文本输入能力的 option。该 option SHALL 保持普通 option 的 marker、焦点态和边框布局，并 SHALL 在 label 后呈现输入区域。

#### Scenario: 输入项保留 marker 和焦点态
- **WHEN** choice surface 渲染支持内联文本输入的 option
- **THEN** 该 option SHALL 与其他 option 一样显示 marker
- **THEN** 当前键盘焦点位于该 option 时 SHALL 继续使用 choice card 的焦点高亮样式

#### Scenario: 输入项显示 cursor
- **WHEN** choice surface 当前键盘焦点位于支持内联文本输入的 option
- **THEN** footer layout SHALL 将 `showCursor` 设置为 true
- **THEN** footer layout SHALL 将 cursor row 和 cursor column 指向该 option 输入文本的当前位置

#### Scenario: 输入项宽度参与面板宽度计算
- **WHEN** choice surface 包含支持内联文本输入的 option
- **THEN** choice box 宽度计算 SHALL 考虑该 option 的 label、placeholder 和当前输入文本
- **THEN** TUI SHALL 避免输入内容破坏右边框对齐


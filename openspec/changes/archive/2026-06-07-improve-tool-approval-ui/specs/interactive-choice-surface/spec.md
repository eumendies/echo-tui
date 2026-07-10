## ADDED Requirements

### Requirement: 通用 choice surface
系统 SHALL 提供通用 choice surface，用于呈现需要用户显式选择的高优先级交互。choice surface SHALL 不绑定到 slash command、tool approval 或特定工具名称，并 SHALL 能被 tool approval 与后续用户问题选择场景复用。

#### Scenario: 渲染通用 choice surface
- **WHEN** 当前 render state 包含 choice surface
- **THEN** TUI SHALL 渲染 choice surface 而不是 composer 或普通 select command surface
- **THEN** choice surface SHALL 显示标题、选项和输入提示

#### Scenario: choice surface 不绑定 tool approval
- **WHEN** 非 tool approval 的调用方需要向用户呈现一个选择问题
- **THEN** 系统 SHALL 能使用相同 choice surface 表达标题、选项、当前选中项和输入提示

### Requirement: choice surface 视觉层级
choice surface SHALL 使用比普通 select command surface 更显眼的布局呈现选择，但 SHALL 优先突出选项本身，避免使用冗长正文压过选项。

#### Scenario: choice surface 使用显眼容器
- **WHEN** choice surface 被渲染
- **THEN** TUI SHALL 使用边框或等价视觉容器区分 choice surface 与普通 footer 内容
- **THEN** TUI SHALL 在容器内为选项区域保留可见留白

#### Scenario: 选中项突出显示
- **WHEN** choice surface 存在当前选中项
- **THEN** TUI SHALL 使用反色、强调色或等价高亮方式突出当前选中项 label
- **THEN** 未选中项 SHALL 不使用同等级高亮

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

### Requirement: choice surface 终端约束
choice surface SHALL 遵循现有 TUI 终端约束，使用当前 footer 渲染机制、ANSI 控制序列和 raw mode 输入处理，不依赖 alternate screen 或第三方 TUI 库。

#### Scenario: 不使用 alternate screen
- **WHEN** choice surface 被打开、更新或关闭
- **THEN** 系统 SHALL NOT 输出进入或离开 alternate screen 的 ANSI 序列

#### Scenario: 不引入第三方 TUI 库
- **WHEN** choice surface 被实现
- **THEN** 项目 SHALL 继续使用现有 ANSI 渲染与输入处理机制
- **THEN** 项目 SHALL NOT 为 choice surface 引入第三方 TUI framework

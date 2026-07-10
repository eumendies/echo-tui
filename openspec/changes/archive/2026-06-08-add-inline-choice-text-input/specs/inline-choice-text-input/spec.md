## ADDED Requirements

### Requirement: choice option 内联文本输入
系统 SHALL 支持将 choice surface 中的某个 option 标记为内联文本输入项。该输入项 SHALL 在同一个 choice box 中显示 label、placeholder 或用户输入文本，并 SHALL 不打开独立输入阶段或独立 surface。

#### Scenario: 选中内联输入项时显示 placeholder
- **WHEN** choice surface 当前选中支持内联文本输入的 option
- **AND** 该输入项当前文本为空
- **THEN** TUI SHALL 在该 option 行显示灰色 placeholder
- **THEN** TUI SHALL 在该 option 行显示终端光标

#### Scenario: 用户开始输入后隐藏 placeholder
- **WHEN** choice surface 当前选中支持内联文本输入的 option
- **AND** 用户输入任意文本字符
- **THEN** TUI SHALL 将文本写入该输入项的编辑状态
- **THEN** TUI SHALL 显示用户输入文本而不是 placeholder

#### Scenario: 非选中输入项不显示光标
- **WHEN** choice surface 包含支持内联文本输入的 option
- **AND** 当前选中项不是该输入 option
- **THEN** TUI SHALL NOT 在该输入 option 上显示终端光标

### Requirement: 内联输入复用 composer 编辑语义
系统 SHALL 使用现有 composer 编辑操作处理 choice surface 内联文本输入，确保基础文本编辑行为与主输入框一致。

#### Scenario: 编辑内联输入文本
- **WHEN** 内联文本输入 option 被选中
- **AND** 用户触发文本插入、Backspace、Delete、左右移动、Home 或 End 输入事件
- **THEN** 系统 SHALL 使用现有 composer 编辑操作更新该输入项文本和 cursor
- **THEN** TUI SHALL 在同一个 choice surface 中重绘更新后的文本和 cursor

#### Scenario: 上下移动离开输入项
- **WHEN** 内联文本输入 option 被选中
- **AND** 用户按 Up 或 Down
- **THEN** 系统 SHALL 切换当前选中 option
- **THEN** 系统 SHALL 保留内联输入项已输入的文本

### Requirement: 内联输入提交约束
系统 SHALL 只在内联输入文本非空时提交该输入 option。空文本 SHALL 保持当前请求继续等待用户输入或选择其他 option。

#### Scenario: 空文本不能提交
- **WHEN** 内联文本输入 option 被选中
- **AND** 该输入项文本为空
- **AND** 用户按 Enter
- **THEN** 系统 SHALL NOT 完成当前请求
- **THEN** TUI SHALL 保持当前 choice surface 可继续编辑

#### Scenario: 非空文本可以提交
- **WHEN** 内联文本输入 option 被选中
- **AND** 该输入项文本非空
- **AND** 用户按 Enter
- **THEN** 系统 SHALL 完成当前请求并使用该文本构造对应结果

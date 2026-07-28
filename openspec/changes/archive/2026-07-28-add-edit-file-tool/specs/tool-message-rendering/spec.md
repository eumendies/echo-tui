## ADDED Requirements

### Requirement: 共享文件编辑 diff-style projection
系统 SHALL 将现有 `apply_patch` diff-style result renderer 泛化为 `apply_patch` 与 `edit_file` 共用的文件编辑投影。两种工具的成功结果在具有合法持久化 display metadata 时 SHALL 使用相同的按文件标题、增删统计、单列定位 gutter、上下文折叠、红绿背景、长行换行、修改区块公平预算和 safe render width 语义。该投影 SHALL 只改变 TUI 可见输出，不得改变 transcript、tool result、provider continuation 或 session 持久化事实。

#### Scenario: edit_file 调用使用路径摘要
- **WHEN** footer pending preview、孤立 call 或完成 call/result pair 包含参数合法的 `edit_file` 调用
- **THEN** 调用行 SHALL 显示 `edit_file(<path>)` 或等价路径摘要
- **THEN** 调用行 SHALL NOT 显示完整 `old_string`、`new_string` 或原始 arguments JSON
- **THEN** 完成调用前缀 SHALL 按相邻 result 的成功或失败状态着色

#### Scenario: edit_file 成功结果使用共享 diff renderer
- **WHEN** `edit_file` result 标记成功且包含合法文件编辑 display metadata
- **THEN** result area SHALL 显示文件路径和 added/removed 逻辑行统计
- **THEN** context、removed、added 和 omitted rows SHALL 使用与 `apply_patch` 相同的 gutter、背景、折叠和换行语义
- **THEN** result area SHALL NOT 同时显示冗余 provider-facing 成功文本

#### Scenario: 行内替换显示完整行变化
- **WHEN** `edit_file` 只替换一行中的部分字符串
- **THEN** renderer SHALL 显示修改前完整逻辑行为 removed row
- **THEN** renderer SHALL 显示修改后完整逻辑行为 added row
- **THEN** renderer SHALL NOT 把孤立的 old/new 子串伪装成完整文件行

#### Scenario: 多个远距离替换保留修改区块
- **WHEN** `edit_file` metadata 包含同一文件中的多个相离修改区块
- **THEN** renderer SHALL 保留每个修改区块至少一个实际 changed row
- **THEN** renderer SHALL 优先折叠区块之间的 unchanged context，而不是把整个首尾区间显示为一次大替换

#### Scenario: edit_file 失败或 metadata 非法时安全降级
- **WHEN** `edit_file` result 失败、没有 display metadata 或 metadata 校验失败
- **THEN** renderer SHALL 显示有界失败文本或降级到通用 tool result renderer
- **THEN** renderer SHALL NOT 读取目标文件、重新执行替换、抛出异常或中断 transcript rendering

#### Scenario: 历史 apply_patch metadata 保持兼容
- **WHEN** `/resume` 加载包含既有 `apply_patch` display metadata 的 session
- **THEN** 共享 renderer SHALL 继续渲染原文件分组、行位置、上下文和增删样式
- **THEN** 系统 SHALL NOT 要求重写或迁移旧 transcript records


## MODIFIED Requirements

### Requirement: composer @ 文件选择器临时界面
系统 SHALL 将 `@` 文件选择器作为 composer 编辑态的 transient footer surface 接入现有 TUI 输入和渲染机制。该 surface SHALL 在 user question、tool approval 等更高优先级交互之后处理输入，并 SHALL 在 slash suggestion 和普通 composer 编辑之前处理输入。文件选择器 SHALL 支持目录级懒加载，使大目录下打开 `@` 时仍能显示直接子文件和子目录，而不是因为完整目录树扫描过大而显示空白。

#### Scenario: 文件选择器使用现有 footer 渲染机制
- **WHEN** `@` 文件选择器打开、更新或关闭
- **THEN** TUI SHALL 使用现有 footer 局部重绘机制渲染该 surface
- **THEN** TUI SHALL NOT 切换到 alternate screen
- **THEN** TUI SHALL NOT 引入第三方 TUI framework

#### Scenario: 大目录下打开文件选择器
- **WHEN** 用户在包含大量后代文件的 cwd 中输入 `@`
- **THEN** file picker surface SHALL 显示该 cwd 可读取的直接子文件和子目录
- **THEN** file picker surface SHALL NOT 因完整目录树扫描输出过大而显示为空白列表
- **THEN** footer SHALL 保持可重绘且不写入 transcript 历史区域

#### Scenario: 文件选择器输入优先级
- **WHEN** file picker surface 已打开
- **AND** 用户输入方向键、普通字符、Backspace、Space、Enter 或 Esc
- **THEN** file picker SHALL 优先于 slash suggestion 和普通 composer edit 消费这些事件
- **THEN** 事件 SHALL NOT 同时触发 mode 切换、历史浏览或普通提交

#### Scenario: 高优先级交互阻止文件选择器触发
- **WHEN** user question、tool approval、command session 或诊断 surface 已经处于 active 状态
- **AND** 用户输入 `@`
- **THEN** 已有 active surface SHALL 按其自身规则处理该输入
- **THEN** 系统 SHALL NOT 额外打开 file picker surface

#### Scenario: resize 后文件选择器保持可重绘
- **WHEN** file picker surface 可见且终端宽度变化
- **THEN** destructive recovery 或 footer redraw SHALL 基于当前 file picker 状态重新生成可见布局
- **THEN** 重绘后 SHALL 保留当前目录、query、焦点、preview 滚动位置和已选文件集合

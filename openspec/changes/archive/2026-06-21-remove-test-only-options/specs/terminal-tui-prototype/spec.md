## ADDED Requirements

### Requirement: TUI 行为不依赖测试专用 app options
系统 SHALL 在删除 app 装配入口测试专用 options 后保持当前终端 TUI 外部行为不变，包括启动、输入处理、footer 渲染、slash command、MCP 初始化状态、assistant response lifecycle 和退出清理。

#### Scenario: CLI 启动行为保持不变
- **WHEN** 用户通过 CLI 启动 TUI
- **THEN** 系统 SHALL 仍在当前终端启动并显示 banner、composer 和 status line
- **THEN** 用户 SHALL 不需要提供任何测试专用 app options

#### Scenario: 输入和渲染行为保持不变
- **WHEN** 用户输入文本、触发 slash command、提交消息或 resize 终端
- **THEN** 系统 SHALL 按既有 TUI 行为处理输入和重绘
- **THEN** 删除测试专用 app options SHALL NOT 改变用户可见交互语义

#### Scenario: 退出清理行为保持不变
- **WHEN** 用户触发退出
- **THEN** 系统 SHALL 仍停止运行中任务、关闭 MCP manager、清理 footer、恢复 terminal 状态并退出进程


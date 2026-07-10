## ADDED Requirements

### Requirement: 工具授权 select 面板
系统 SHALL 在 `apply_patch` 工具执行前展示工具授权 select 面板。该面板 SHALL 作为 agent turn 内部 modal 出现，使用 select 选项表达用户决策；第一版 SHALL 至少提供 `Allow once` 和 `Deny` 两个选项。

#### Scenario: 显示 apply_patch 授权面板
- **WHEN** agent 请求执行 `apply_patch` 且需要用户授权
- **THEN** TUI SHALL 在 footer 区域显示工具授权 select 面板
- **THEN** 面板 SHALL 告知用户模型请求执行 `apply_patch`
- **THEN** 面板 SHALL 显示 `Allow once` 和 `Deny` 选项

#### Scenario: Enter 选择当前授权选项
- **WHEN** 工具授权 select 面板处于活跃状态
- **AND** 用户按下 Enter
- **THEN** 系统 SHALL 选择当前高亮的授权选项
- **THEN** 系统 SHALL 关闭工具授权面板并恢复 agent tool call 流程

#### Scenario: Esc 拒绝工具执行
- **WHEN** 工具授权 select 面板处于活跃状态
- **AND** 用户按下 Esc
- **THEN** 系统 SHALL 将本次授权请求视为拒绝执行
- **THEN** 系统 SHALL 关闭工具授权面板并恢复 agent tool call 流程

#### Scenario: 授权面板支持选择移动
- **WHEN** 工具授权 select 面板处于活跃状态
- **AND** 用户按下 Up 或 Down
- **THEN** 系统 SHALL 在授权选项之间移动当前选择
- **THEN** 系统 SHALL 重绘 footer 以反映新的高亮选项

#### Scenario: 工具授权 modal 优先消费输入
- **WHEN** 工具授权 select 面板处于活跃状态
- **THEN** 输入事件 SHALL 优先交给工具授权 modal 处理
- **THEN** 输入事件 SHALL NOT 被 slash command runtime、slash suggestion 或主 composer 编辑逻辑消费

#### Scenario: 工具授权期间保持 response lock
- **WHEN** 工具授权 select 面板处于活跃状态
- **THEN** 系统 SHALL 保持当前 assistant response lock
- **THEN** 用户 SHALL NOT 能提交第二个普通 user message


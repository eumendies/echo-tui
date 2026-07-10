## ADDED Requirements

### Requirement: Esc 输入分发优先级
TUI SHALL 在处理 Esc 输入时先交给当前活跃的高优先级 surface 或本地运行态；仅当没有此类 surface 消费该 Esc 时，才将 Esc 作为当前 active assistant turn 的中断请求。该优先级 SHALL 覆盖 user question、tool approval、file picker、command surface 和 shell mode 本地命令。

#### Scenario: user question surface 首次消费 Esc
- **WHEN** `ask_user_questions` choice surface 正在显示
- **AND** 用户按下 Esc
- **THEN** TUI SHALL 先把该 Esc 交给 user question surface
- **THEN** TUI SHALL NOT 同时把该 Esc 作为 assistant turn interrupt 处理

#### Scenario: command surface 首次消费 Esc
- **WHEN** slash command、help、model、effort、skills、confirm 或等价 command surface 正在显示
- **AND** 用户按下 Esc
- **THEN** TUI SHALL 先把该 Esc 交给 command surface
- **THEN** TUI SHALL NOT 同时把该 Esc 作为 assistant turn interrupt 处理

#### Scenario: 无 surface 时 Esc 中断 active assistant turn
- **WHEN** assistant turn 仍然 active 且 response lock 被占用
- **AND** 没有 user question、tool approval、file picker、command surface 或正在运行的 shell command
- **AND** 用户按下 Esc
- **THEN** TUI SHALL 请求中断当前 assistant turn

#### Scenario: surface 关闭后二次 Esc 中断 loop
- **WHEN** 一个高优先级 surface 已因第一次 Esc 关闭
- **AND** assistant turn 仍然 active 且 response lock 被占用
- **AND** 用户再次按下 Esc
- **THEN** TUI SHALL 将第二次 Esc 作为当前 assistant turn interrupt 处理

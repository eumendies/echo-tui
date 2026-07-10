## ADDED Requirements

### Requirement: Shell command Esc 优先于 assistant loop interrupt
系统 SHALL 保持 shell mode 本地命令的 Esc 中断语义独立于 assistant agent loop interrupt。当 shell mode 本地命令正在运行时，Esc SHALL 优先请求中断该 shell command；当没有正在运行的 shell command 且存在 active assistant turn 时，Esc 才 MAY 作为 assistant loop interrupt 处理。

#### Scenario: 运行中 shell command 消费 Esc
- **WHEN** shell mode 本地命令正在运行
- **AND** 用户按下 Esc
- **THEN** 系统 SHALL 请求中断正在运行的 shell 命令
- **THEN** 系统 SHALL NOT 因同一次 Esc 请求中断 assistant agent loop

#### Scenario: 无 shell command 时 Esc 可中断 assistant loop
- **WHEN** 当前没有运行中的 shell mode 本地命令
- **AND** assistant turn 仍然 active 且没有更高优先级 surface
- **AND** 用户按下 Esc
- **THEN** 系统 MAY 将该 Esc 作为 assistant agent loop interrupt 处理

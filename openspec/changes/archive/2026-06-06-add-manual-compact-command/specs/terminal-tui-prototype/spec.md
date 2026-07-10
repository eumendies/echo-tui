## ADDED Requirements

### Requirement: slash compact 手动压缩命令
系统 SHALL 支持一个本地 slash 命令：当用户提交纯 `/compact` 时，应用 SHALL 弹出 confirm command surface 请求确认；用户确认后 SHALL 手动触发一次上下文压缩。该命令 SHALL 复用统一 slash 命令运行时、command session 与 confirm surface（与 `/clear` 同构）。该命令 SHALL NOT 把 `/compact` 写入 transcript、input history 或 agent 生命周期。手动压缩 SHALL 以强制模式执行（绕过阈值），但仍遵守边界吸附。

#### Scenario: 纯 /compact 打开确认框
- **WHEN** assistant 不处于 thinking 或 streaming，且用户提交内容精确等于 `/compact`
- **THEN** 系统 SHALL 进入 `/compact` command session 并显示 confirm command surface
- **THEN** 系统 SHALL NOT 把 `/compact` 写入 transcript 或 input history

#### Scenario: 非纯 /compact 输入回退为普通消息
- **WHEN** 用户提交内容以 `/compact` 开头但还带有其他字符
- **THEN** 系统 SHALL 将该内容视为普通 user message 提交，而不是进入确认框

#### Scenario: response 进行中阻止 /compact
- **WHEN** assistant 正在 thinking 或 streaming，且用户提交纯 `/compact`
- **THEN** 系统 SHALL NOT 进入 `/compact` command session
- **THEN** 系统 SHALL NOT 触发压缩

#### Scenario: 确认后执行手动压缩
- **WHEN** `/compact` confirm surface 活跃且用户按下 Enter
- **THEN** 系统 SHALL 关闭 command session 并恢复普通输入界面
- **THEN** 系统 SHALL 以强制模式触发一次上下文压缩
- **THEN** 压缩期间 SHALL 复用 responding 锁与 working spinner，阻止并发提交

#### Scenario: 取消确认不压缩
- **WHEN** `/compact` confirm surface 活跃且用户按下 Esc
- **THEN** 系统 SHALL 关闭 command session 并恢复普通输入界面
- **THEN** 系统 SHALL NOT 触发压缩

### Requirement: 手动压缩结果反馈
系统 SHALL 在手动压缩结束后给出可见反馈。压缩成功时 SHALL 落盘新压缩状态并追加压缩提示块（复用既有 compaction_notice）。当无有效边界（活跃区间不足以压缩）时 SHALL 追加一条"无需压缩"提示，而非静默结束。压缩失败时 SHALL 追加一条 `error` role transcript record（复用既有失败反馈），并释放 responding 锁。

#### Scenario: 手动压缩成功
- **WHEN** 手动压缩得到有效边界并成功生成摘要
- **THEN** 系统 SHALL 落盘新的压缩状态并追加 compaction_notice 提示块
- **THEN** 系统 SHALL 释放 responding 锁

#### Scenario: 无可压缩内容
- **WHEN** 手动压缩因无有效边界而未发生
- **THEN** 系统 SHALL 追加一条说明"当前无需压缩"的提示
- **THEN** 系统 SHALL NOT 追加错误反馈

#### Scenario: 手动压缩失败
- **WHEN** 手动压缩过程中摘要请求失败
- **THEN** 系统 SHALL 追加一条 `error` role transcript record 说明压缩失败
- **THEN** 系统 SHALL 释放 responding 锁
- **THEN** 系统 SHALL NOT 重试

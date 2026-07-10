# undo-command Specification

## Purpose
TBD - created by archiving change add-undo-command. Update Purpose after archive.
## Requirements
### Requirement: /undo 命令回退上一轮 assistant loop
系统 SHALL 提供 `/undo` slash command，用于回退当前 session change history 栈顶的 assistant loop。一次可回退 loop SHALL 从该轮 user transcript record 追加前开始，到该轮 assistant 完成、失败或被中断后结束。回退 SHALL 同时恢复受控文件修改和 transcript/compaction 状态，且 SHALL NOT 依赖 Git 仓库、Git commit、Git index 或外部版本控制命令。

#### Scenario: 没有可回退 loop
- **WHEN** 用户提交 `/undo` 且当前 session change history 内不存在 ready change checkpoint
- **THEN** 系统 SHALL 显示可理解的不可回退说明
- **THEN** 系统 SHALL NOT 修改文件系统或 transcript records

#### Scenario: 展示 undo 确认
- **WHEN** 用户提交 `/undo` 且存在 ready change checkpoint
- **THEN** 系统 SHALL 打开确认型 command surface
- **THEN** surface SHALL 以“回退这轮对话与文件变更”作为第一行提示
- **THEN** surface SHALL 以“回退 X 个文件修改，删除 Y 个新增文件。”展示受影响文件数量
- **THEN** surface SHALL NOT 以 transcript records 数量作为主要提示文案
- **THEN** surface SHALL 以“注意：会覆盖期间的手动修改”提示风险
- **THEN** 用户 SHALL 能通过 Enter 确认或 Esc 取消

#### Scenario: 取消 undo
- **WHEN** `/undo` 确认面板处于活跃状态且用户按 Esc
- **THEN** 系统 SHALL 关闭该 command session
- **THEN** 系统 SHALL 保留 change checkpoint
- **THEN** 系统 SHALL NOT 修改文件系统或 transcript records

#### Scenario: 成功回退上一轮 loop
- **WHEN** 用户确认 `/undo` 且 checkpoint 处于 ready 状态
- **THEN** 系统 SHALL 恢复该 checkpoint 记录的文件 snapshot 状态
- **THEN** 系统 SHALL 将 transcript records 截断到该 loop 开始前
- **THEN** 系统 SHALL 恢复该 loop 开始前的 compaction 状态
- **THEN** 系统 SHALL 标记该 checkpoint 已使用，使同一轮修改不能被重复 undo
- **THEN** 系统 SHALL 重绘当前 app snapshot

#### Scenario: 连续回退多个 ready loop
- **GIVEN** 当前 session change history 内存在多个 ready change checkpoint
- **WHEN** 用户确认一次 `/undo`
- **THEN** 系统 SHALL 只回退栈顶最近一轮 checkpoint
- **THEN** 系统 SHALL 保留更早的 ready checkpoint
- **WHEN** 用户再次提交并确认 `/undo`
- **THEN** 系统 SHALL 回退新的栈顶 checkpoint

#### Scenario: undo 不追加 transcript 成功记录
- **WHEN** `/undo` 成功完成
- **THEN** 系统 SHALL NOT 为 undo 成功追加 user、assistant、tool、local_notice 或 error transcript record
- **THEN** 当前 transcript SHALL 等价于被回退 loop 开始前的 transcript 状态

### Requirement: 受控文件修改 change history
系统 SHALL 在 assistant loop 开始时创建 change checkpoint，并 SHALL 在受控文件编辑工具写入文件前记录目标文件的 snapshot 状态，在单个文件写入成功后立即将该文件标记为 `created` 或 `updated`。第一版受控文件编辑工具 SHALL 至少包含 `apply_patch`。change history SHALL 随当前 transcript session 持久化，并 SHALL 按 assistant loop 顺序形成可连续回退的栈。

#### Scenario: 记录更新已有文件
- **WHEN** assistant loop 中 `apply_patch` 成功更新已有 UTF-8 文本文件
- **THEN** change checkpoint SHALL 记录该文件的绝对路径、snapshot content 和 `updated` 状态
- **THEN** `/undo` 成功时 SHALL 将该文件恢复为 snapshot content

#### Scenario: 记录新增文件
- **WHEN** assistant loop 中 `apply_patch` 成功新增 UTF-8 文本文件
- **THEN** change checkpoint SHALL 记录该文件在 loop 前不存在和 `created` 状态
- **THEN** `/undo` 成功时 SHALL 删除该新增文件

#### Scenario: 同一 loop 多次修改同一文件
- **WHEN** 同一 assistant loop 中受控文件工具多次修改同一文件
- **THEN** change checkpoint SHALL 保留该文件第一次修改前的 snapshot 状态
- **THEN** change checkpoint SHALL 在任意一次成功写入后保持 `created` 或 `updated` 状态

#### Scenario: snapshot-only entry 不参与 undo
- **WHEN** 受控文件工具记录了文件 snapshot 状态但没有成功写入该文件
- **THEN** change checkpoint SHALL 保留该文件的 `pending` 状态
- **THEN** `/undo` 摘要 SHALL NOT 计入该文件
- **THEN** `/undo` 执行时 SHALL NOT 恢复该文件

#### Scenario: 解析校验模拟失败不产生 change entry
- **WHEN** `apply_patch` 解析、校验或模拟失败
- **THEN** 该失败调用 SHALL NOT 记录为可回退文件修改

#### Scenario: 写盘阶段失败保留已成功写入文件
- **WHEN** `apply_patch` 写盘阶段部分文件已经写入成功
- **AND** 后续文件写入失败
- **THEN** change checkpoint SHALL 保留已成功写入文件的 `created` 或 `updated` 状态
- **THEN** change checkpoint SHALL 保留未成功写入文件的 `pending` 状态
- **THEN** 系统 SHALL NOT 将该 change checkpoint 标记为 invalid
- **THEN** `/undo` SHALL 只恢复已成功写入的文件并回退 transcript

#### Scenario: change history 随 session 恢复
- **WHEN** 用户退出并重新启动 TUI
- **AND** 用户通过 `/resume` 加载包含 change history 的 transcript session
- **THEN** 系统 SHALL 从 transcript session 中恢复旧 change checkpoint
- **THEN** `/undo` SHALL 可以回退上一进程中的受控文件修改

### Requirement: 不可追踪写入保护和确认恢复
包含不可追踪写入型 shell 命令的 assistant loop SHALL 使 change checkpoint 失效。对于 ready checkpoint 中由受控文件工具记录的文件，用户确认 `/undo` 后系统 SHALL 恢复 checkpoint 的 snapshot 状态，即使这些文件在 loop 结束后又被手动修改。

#### Scenario: 写入型 bash 使 undo 不可用
- **WHEN** assistant loop 执行了无法声明文件修改集合的写入型 `run_bash_command`
- **THEN** 系统 SHALL 将本轮 change checkpoint 标记为 invalid
- **THEN** 系统 SHALL 丢弃该 invalid checkpoint 之前的 checkpoint
- **WHEN** 用户随后提交 `/undo`
- **THEN** 系统 SHALL 说明本轮包含不可追踪写入命令，无法安全回退
- **THEN** 系统 SHALL NOT 修改文件系统或 transcript records

#### Scenario: invalid checkpoint 作为多轮 undo 边界
- **GIVEN** 当前 session change history 内存在一个 invalid checkpoint
- **AND** 该 invalid checkpoint 之后又产生了 ready checkpoint
- **WHEN** 用户连续确认 `/undo` 回退完 invalid checkpoint 之后的 ready checkpoint
- **THEN** 下一次 `/undo` SHALL 显示 invalid checkpoint 的不可回退说明
- **THEN** 系统 SHALL NOT 继续回退 invalid checkpoint 之前的 loop

#### Scenario: 只读 bash 不影响 undo 可用性
- **WHEN** assistant loop 只执行只读 inspection bash 命令且其他文件修改均来自受控文件工具
- **THEN** 只读 bash SHALL NOT 单独使 change checkpoint 失效
- **THEN** `/undo` MAY 继续回退该 loop 中受控文件工具产生的修改

#### Scenario: loop 后手动修改受控文件
- **WHEN** ready checkpoint 中某个受影响文件在 loop 结束后又被用户或外部进程修改
- **AND** 用户确认 `/undo`
- **THEN** 系统 SHALL 将该文件恢复为 checkpoint 记录的 snapshot 状态
- **THEN** 系统 SHALL 同步截断 transcript records
- **THEN** 系统 SHALL NOT 因当前文件状态不同于 loop 结束状态而拒绝 undo

#### Scenario: 文件恢复写入失败
- **WHEN** `/undo` 恢复文件过程中发生文件系统错误
- **THEN** 系统 SHALL 报告失败
- **THEN** 系统 SHALL NOT 截断 transcript records
- **THEN** 系统 SHALL 保留 checkpoint 供用户处理问题后重试或取消

### Requirement: transcript 与 compaction 一致回退
系统 SHALL 为 change checkpoint 记录 loop 开始前的 transcript record 边界和 compaction 状态。成功 `/undo` SHALL 使用该边界截断当前 records，并恢复 compaction 状态；若文件恢复不能安全完成，系统 SHALL NOT 回退 transcript。

#### Scenario: 回退包含多个 tool call 的 loop
- **WHEN** 上一轮 assistant loop 追加了 reasoning summary、assistant segment、多个 tool_call/tool_result 和最终 assistant record
- **AND** 用户确认 `/undo`
- **THEN** 系统 SHALL 删除该 loop 开始后的全部 transcript records
- **THEN** 系统 SHALL NOT 留下孤立 tool_call 或 tool_result record

#### Scenario: 回退发生过 compaction 的 loop
- **WHEN** 上一轮 assistant loop 中触发了 context compaction
- **AND** 用户确认 `/undo`
- **THEN** 系统 SHALL 移除该轮 compaction notice record
- **THEN** 系统 SHALL 恢复 loop 开始前的 compaction state
- **THEN** 后续 provider request SHALL 使用恢复后的 records 和 compaction 语义

#### Scenario: 回退被中断的 loop
- **WHEN** 上一轮 assistant loop 被用户中断且该轮存在 ready change checkpoint
- **AND** 用户确认 `/undo`
- **THEN** 系统 SHALL 删除该轮 partial assistant record 和 interruption notice
- **THEN** 系统 SHALL 恢复受控文件修改

### Requirement: /undo 命令集成和显示语义
系统 SHALL 将 `/undo` 注册为默认 slash command，并 SHALL 通过 `CommandHost` 暴露受控 undo 能力。`/undo` SHALL 使用现有 command runtime 和 command surfaces；它 SHALL NOT 直接访问完整 `AppContext`、renderer、terminal 或 Git 命令。

#### Scenario: 默认 slash suggestions 包含 undo
- **WHEN** 系统创建默认 slash command descriptors
- **THEN** descriptors SHALL 包含 `/undo` 及其中文说明

#### Scenario: undo 通过 CommandHost 执行
- **WHEN** `/undo` command handler 需要读取 undo 状态或执行回退
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 undo 领域能力访问
- **THEN** handler SHALL NOT 直接操作 `AppContext` 内部字段、transcript store、renderer 或 terminal controller

#### Scenario: undo 不触发 assistant turn
- **WHEN** 用户提交纯 `/undo`
- **THEN** 系统 SHALL 将其作为本地 slash command 处理
- **THEN** 系统 SHALL NOT 追加 user transcript record
- **THEN** 系统 SHALL NOT 启动 agent loop 或 tool execution continuation

#### Scenario: undo 完成后重绘
- **WHEN** `/undo` 成功或失败并关闭 command surface
- **THEN** 系统 SHALL 以当前 transcript records、pending 状态和 composer 状态重绘 app
- **THEN** 已被回退 loop 的 transcript projection SHALL 不再可见

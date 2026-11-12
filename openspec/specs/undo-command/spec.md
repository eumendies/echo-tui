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
系统 SHALL 在 assistant loop 开始时创建 change checkpoint，并 SHALL 在受控文件编辑工具写入、创建或删除文件前记录目标文件的 snapshot 状态，在单个文件写入、创建或删除成功后立即将该文件标记为 `created` 或 `updated`。删除已有文件 SHALL 使用 `updated` 或等价可恢复状态记录原始 snapshot。第一版受控文件编辑工具 SHALL 至少包含 `apply_patch`。change history SHALL 随当前 transcript session 持久化，并 SHALL 按 assistant loop 顺序形成可连续回退的栈。单个 `apply_patch` 对同一解析后路径执行多次操作时，change history SHALL 仅根据该路径的最终实际写盘状态记录一次该路径的调用前 snapshot。

#### Scenario: 记录更新已有文件
- **WHEN** assistant loop 中 `apply_patch` 成功更新已有 UTF-8 文本文件
- **THEN** change checkpoint SHALL 记录该文件的绝对路径、snapshot content 和 `updated` 状态
- **THEN** `/undo` 成功时 SHALL 将该文件恢复为 snapshot content

#### Scenario: 记录新增文件
- **WHEN** assistant loop 中 `apply_patch` 成功新增 UTF-8 文本文件
- **THEN** change checkpoint SHALL 记录该文件在 loop 前不存在和 `created` 状态
- **THEN** `/undo` 成功时 SHALL 删除该新增文件

#### Scenario: 记录删除已有文件
- **WHEN** assistant loop 中 `apply_patch` 成功删除已有 UTF-8 文本文件
- **THEN** change checkpoint SHALL 记录该文件的绝对路径、snapshot content 和 `updated` 或等价可恢复状态
- **THEN** `/undo` 成功时 SHALL 重新创建该文件并恢复为 snapshot content

#### Scenario: 单个 patch 删除后重建已有文件
- **WHEN** 一次成功的 `apply_patch` 先删除已有文件再重建同一解析后路径
- **THEN** change checkpoint SHALL 仅记录一次该文件删除前的 snapshot，并将其标记为 `updated`
- **THEN** `/undo` 成功时 SHALL 恢复删除前的原始文件内容

#### Scenario: 同一 loop 多次修改同一文件
- **WHEN** 同一 assistant loop 中受控文件工具多次修改同一文件
- **THEN** change checkpoint SHALL 保留该文件第一次修改前的 snapshot 状态
- **THEN** change checkpoint SHALL 在任意一次成功写入、创建或删除后保持 `created` 或 `updated` 状态

#### Scenario: snapshot-only entry 不参与 undo
- **WHEN** 受控文件工具记录了文件 snapshot 状态但没有成功写入、创建或删除该文件
- **THEN** change checkpoint SHALL 保留该文件的 `pending` 状态
- **THEN** `/undo` 摘要 SHALL NOT 计入该文件
- **THEN** `/undo` 执行时 SHALL NOT 恢复该文件

#### Scenario: 解析校验模拟失败不产生 change entry
- **WHEN** `apply_patch` 解析、校验或模拟失败
- **THEN** 该失败调用 SHALL NOT 记录为可回退文件修改

#### Scenario: 写盘阶段失败保留已成功写入文件
- **WHEN** `apply_patch` 写盘阶段部分文件已经写入、创建或删除成功
- **AND** 后续文件写入、创建或删除失败
- **THEN** change checkpoint SHALL 保留已成功写入、创建或删除文件的 `created` 或 `updated` 状态
- **THEN** change checkpoint SHALL 保留未成功写入、创建或删除文件的 `pending` 状态
- **THEN** 系统 SHALL NOT 将该 change checkpoint 标记为 invalid
- **THEN** `/undo` SHALL 只恢复已成功写入、创建或删除的文件并回退 transcript

#### Scenario: change history 随 session 恢复
- **WHEN** 用户退出并重新启动 TUI
- **AND** 用户通过 `/resume` 加载包含 change history 的 transcript session
- **THEN** 系统 SHALL 从 transcript session 中恢复旧 change checkpoint
- **THEN** `/undo` SHALL 可以回退上一进程中的受控文件修改

### Requirement: 不可追踪写入保护和确认恢复
包含不可追踪写入型 shell 命令的 assistant loop SHALL 使 change checkpoint 失效；可能写入工作区的后台任务从成功启动到收尾期间 SHALL 阻止 /undo，并使所有与其运行重叠的 assistant loop checkpoint 失效，任务结束 SHALL NOT 重新启用这些 checkpoint；但当命令实际在生效 `read-only` 沙箱内执行时，工作区写入已被内核边界排除，系统 SHALL NOT 因该命令使 checkpoint 失效。对于 ready checkpoint 中由受控文件工具记录的文件，用户确认 `/undo` 后系统 SHALL 恢复 checkpoint 的 snapshot 状态，即使这些文件在 loop 结束后又被手动修改。

#### Scenario: 写入型 bash 使 undo 不可用
- **WHEN** assistant loop 执行了无法声明文件修改集合的写入型 `run_bash_command`，且该命令未在生效 `read-only` 沙箱内执行
- **THEN** 系统 SHALL 将本轮 change checkpoint 标记为 invalid
- **THEN** 系统 SHALL 丢弃该 invalid checkpoint 之前的 checkpoint
- **WHEN** 用户随后提交 `/undo`
- **THEN** 系统 SHALL 说明本轮包含不可追踪写入命令，无法安全回退
- **THEN** 系统 SHALL NOT 修改文件系统或 transcript records

#### Scenario: 生效只读沙箱内执行不使 undo 失效
- **WHEN** assistant loop 在生效 `read-only` 沙箱内执行了无法声明文件修改集合的 bash 命令，例如 `jq . package.json` 或 `node -e "..."`
- **THEN** 系统 SHALL NOT 使本轮 change checkpoint 失效
- **THEN** `/undo` MAY 继续回退该 loop 中受控文件工具产生的修改

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

#### Scenario: 后台写任务跨轮运行
- **WHEN** 一个不受生效 read-only 沙箱保护且不被既有只读规则认可的后台命令仍在运行或停止收尾
- **THEN** 系统 SHALL 拒绝 /undo 并显示后台任务仍可能修改文件的说明
- **AND** 每个与该任务运行重叠的 assistant loop checkpoint SHALL 标记为 invalid 并遵守既有历史失效边界

#### Scenario: 两轮之间没有 recording checkpoint
- **WHEN** 后台可能写任务尚未确认结束，当前没有 recording checkpoint，用户请求 undo 摘要或确认回退
- **THEN** 摘要入口和实际执行入口 SHALL 各自查询当前管理器的活动写任务保护并拒绝回退
- **AND** 系统 SHALL NOT 依赖 invalidate 一个非 recording checkpoint 阻止 undo
- **AND** 下一轮创建 checkpoint 后 SHALL 立即应用该保护，即使任务随后在该轮结束也保持该 checkpoint 失效

#### Scenario: 确认期间保护状态发生变化
- **WHEN** undo 确认面板打开后到实际恢复文件前活动任务状态发生变化
- **THEN** 执行入口 SHALL 重新验证管理器的写任务保护
- **AND** 未确认结束的可能写任务，包括 cleanup_timeout 的任务，SHALL 阻止文件恢复和 transcript 截断

#### Scenario: 后台写任务结束后开始新轮
- **WHEN** 最后一个可能写入的后台任务已经收尾，随后开始新的 assistant loop
- **THEN** 新 loop SHALL 恢复正常受控修改记录与 undo 判定
- **AND** 之前已经 invalid 的 checkpoint SHALL 保持失效

#### Scenario: 只读后台任务不使 checkpoint 失效
- **WHEN** 后台命令实际受生效 read-only 沙箱保护或符合既有只读命令规则
- **THEN** 系统 SHALL NOT 仅因后台执行使 checkpoint 失效或阻止 /undo
- **AND** 成功 undo 会移除该任务启动记录时 SHALL 先停止其仍运行的任务，再完成 transcript 截断

#### Scenario: 从待截断记录定位只读任务
- **WHEN** 一个 ready checkpoint 的 undo 将移除其 transcriptStartIndex 到当前尾部的记录
- **THEN** 系统 SHALL 从该区间 tool_result.details 的合法任务引用定位当前实例持有的运行中只读任务
- **AND** 系统 SHALL 等待这些任务停止后重新验证 session、checkpoint ID 和写任务保护，再恢复文件并截断记录
- **AND** 系统 SHALL NOT 要求为 ChangeCheckpoint 新增冗余 task ID 列表

#### Scenario: 只读任务清理失败
- **WHEN** undo 所需的只读后台任务清理失败或不能确认停止
- **THEN** 系统 SHALL 返回可理解的失败说明，不恢复文件或截断 transcript
- **AND** 若任务已停止但后续文件恢复失败，任务 SHALL 保持真实停止状态，记录与 checkpoint SHALL 保留供重试

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

### Requirement: edit_file change checkpoint 集成
成功的 `edit_file` 写入 SHALL 作为受控文件修改进入当前 assistant loop 的 change checkpoint，并 SHALL 使用现有 session 持久化、连续回退、snapshot-only 过滤和 transcript/compaction 一致回退语义。失败且未写盘的 `edit_file` 调用 SHALL NOT 形成可回退文件修改。

#### Scenario: edit_file 更新可回退
- **WHEN** assistant loop 中 `edit_file` 成功更新已有 UTF-8 文本文件
- **THEN** change checkpoint SHALL 记录该文件第一次修改前的绝对路径、snapshot content 和 `updated` 状态
- **THEN** 用户成功执行 `/undo` 时 SHALL 恢复 snapshot content

#### Scenario: 同一 loop 与 apply_patch 共同修改
- **WHEN** 同一 assistant loop 中 `edit_file` 与其他受控文件工具先后修改同一解析后路径
- **THEN** change checkpoint SHALL 只保留该路径第一次修改前的 snapshot
- **THEN** checkpoint SHALL 在任意成功写入后保持 `updated` 或原有 `created` 状态

#### Scenario: edit_file 校验失败不计入 undo
- **WHEN** `edit_file` 因参数、目标、匹配数量或 post-image 校验失败且没有写盘
- **THEN** `/undo` 摘要 SHALL NOT 将该调用计为文件修改
- **THEN** `/undo` 执行 SHALL NOT 因该失败调用恢复目标文件

#### Scenario: edit_file history 随 session 恢复
- **WHEN** session 保存了包含 `edit_file` 更新的 ready checkpoint
- **AND** 用户在新进程中通过 `/resume` 加载该 session
- **THEN** `/undo` SHALL 可以回退该 `edit_file` 文件修改及对应 assistant loop transcript


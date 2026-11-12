## MODIFIED Requirements

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


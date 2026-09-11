## MODIFIED Requirements

### Requirement: records 与会话状态的增量操作
系统 SHALL 使用 `append_records`、`truncate_records`、`set_change_history`、`set_compaction`、`set_todo_state` 和 `set_goal_state` 操作分别记录 transcript records 及四类会话状态。某项状态未发生变化时，系统 SHALL NOT 因其他 record 或状态提交而重复写入该项状态。

#### Scenario: 普通 record 追加不复制无关状态
- **WHEN** app 追加普通 transcript record
- **AND** changeHistory、compaction、todoState 和 goalState 自上次持久化后均未变化
- **THEN** journal SHALL 追加只包含 `append_records` 的操作
- **THEN** 系统 SHALL NOT 重写此前 journal 内容或写入完整 session 对象

#### Scenario: todo 更新不复制其他状态
- **WHEN** 当前 session 的 todoState 发生变化
- **AND** changeHistory、compaction 和 goalState 未发生变化
- **THEN** journal SHALL 追加 `set_todo_state` 操作
- **THEN** 该操作 SHALL NOT 包含 changeHistory、compaction 或 goalState 的副本

#### Scenario: compaction 更新不复制其他状态
- **WHEN** 当前 session 的 compaction 发生变化
- **AND** todoState、goalState 和 changeHistory 未发生变化
- **THEN** journal SHALL 追加 `set_compaction` 操作
- **THEN** 该操作 SHALL NOT 包含 todoState、goalState 或 changeHistory 的副本

#### Scenario: goal 更新不复制其他状态
- **WHEN** 当前 session 的 goalState 发生变化
- **AND** changeHistory、compaction 和 todoState 未发生变化
- **THEN** journal SHALL 追加 `set_goal_state` 操作
- **THEN** 该操作 SHALL NOT 包含 changeHistory、compaction 或 todoState 的副本

### Requirement: journal replay 与恢复容错
系统 SHALL 按 journal 文件顺序 replay 有效操作以恢复当前 records、todoState、goalState、compaction、changeHistory 和 updatedAt。`truncate_records` SHALL 作用于 replay 时当前 records 数组；每个 `set_*` SHALL 覆盖对应的当前状态。

#### Scenario: 截断后追加 records
- **WHEN** journal 依次包含 records A、B、C 的追加操作、`truncate_records(1)` 和 records D 的追加操作
- **THEN** 加载 session 后的 records SHALL 为 A 和 D
- **THEN** 被截断的 B 和 C SHALL NOT 出现在当前 provider 或 TUI transcript 中

#### Scenario: 最后一行写入中断
- **WHEN** journal 的最后一个非空行不是合法 JSON 或不符合操作结构
- **THEN** 系统 SHALL 忽略该最后一行并从此前有效操作恢复 session
- **THEN** 系统 SHALL 在恢复该 session 时原子移除无效尾部，使后续操作从最后有效 seq 继续追加
- **THEN** 系统 SHALL NOT 因该尾行失败而丢弃此前有效 records 或状态

#### Scenario: 有效最后一行缺少换行
- **WHEN** journal 的最后一个操作完整有效但缺少行尾换行
- **THEN** 系统 SHALL 在恢复该 session 时补全可安全续写的 journal 结尾
- **THEN** 后续追加 SHALL NOT 与既有操作拼接为同一物理行

#### Scenario: 中间 journal 损坏
- **WHEN** `session_start` 无效、某个非最后操作无效、出现未知操作或 seq 不连续
- **THEN** 系统 SHALL 将该 session 视为不可恢复
- **THEN** `/resume` SHALL NOT 列出该 session

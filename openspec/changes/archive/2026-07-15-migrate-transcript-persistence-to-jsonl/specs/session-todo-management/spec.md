## MODIFIED Requirements

### Requirement: 会话级 todo 状态持久化
系统 SHALL 为每个 transcript session 维护结构化 `todoState`。`todoState` SHALL 通过 session JSONL journal 中独立的 `set_todo_state` 操作保存和加载，不得作为普通 transcript record 保存，也不得参与 context compaction 边界计算。

#### Scenario: 保存包含 todoState 的 session
- **WHEN** 当前 session 存在未完成 todo
- **AND** app 持久化当前 todoState
- **THEN** session JSONL journal SHALL 追加独立的 `set_todo_state` 操作
- **AND** 该操作 SHALL 包含当前 todo items 和更新时间
- **AND** 该操作 SHALL NOT 因 todoState 更新而包含 compaction 或 change history 的副本

#### Scenario: 恢复 session todoState
- **WHEN** 用户通过 `/resume` 加载包含 `set_todo_state` 操作的 session journal
- **THEN** app SHALL 恢复该 session 的最后一个有效 todo 状态
- **AND** 下一次 provider 请求 SHALL 能看到恢复后的未完成 todo

#### Scenario: journal 没有 todo 状态操作
- **WHEN** app 加载有效 session journal 且其中不存在 `set_todo_state` 操作
- **THEN** app SHALL 使用空 todo 状态
- **AND** 加载 SHALL NOT 失败

#### Scenario: 清空 transcript 同步清空 todoState
- **WHEN** 用户执行清空当前会话的操作
- **THEN** app SHALL 清空当前 transcript records
- **AND** app SHALL 清空当前 `todoState`

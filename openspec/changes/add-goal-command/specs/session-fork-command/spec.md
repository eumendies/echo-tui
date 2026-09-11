## MODIFIED Requirements

### Requirement: 分叉 session 保存自包含会话快照
系统 SHALL 在新 session 的独立 JSONL journal 中保存分叉时的全部当前 transcript records、compaction、todo state、goal state 和 change history。新 session SHALL 能在不读取源 journal 的情况下 replay 出与分叉时等价的会话状态。

#### Scenario: 复制完整会话状态
- **GIVEN** 当前 session 包含 transcript records、有效 compaction、todo state、goal state 和 change history
- **WHEN** `/fork` 成功
- **THEN** 新 session replay 后的 records SHALL 与分叉时当前 records 等价
- **THEN** 新 session 的 compaction、todo state、goal state 和 change history SHALL 与分叉时当前状态等价
- **THEN** 新 session SHALL 使用自身 journal 作为后续持久化目标

#### Scenario: 分叉继承 goal 状态
- **GIVEN** 当前 session 存在 goal（`active` 或 `paused`，含轮次计数与最近评估）
- **WHEN** `/fork` 成功
- **THEN** 新 session 的 goal 状态 SHALL 与分叉时当前状态等价
- **THEN** 两个分支 SHALL 各自独立演进 goal 状态，任一分支的目标变更或推进 SHALL NOT 影响另一分支

#### Scenario: 新旧分支独立追加
- **GIVEN** session A 已成功分叉为当前 session B
- **WHEN** 用户在 B 中继续提交消息并产生新的 transcript records
- **THEN** 新 records SHALL 只追加到 B 的 journal
- **THEN** 通过 `/resume` 恢复 A 时 SHALL NOT 出现 B 分叉后新增的 records

#### Scenario: 源会话后续变化不影响分叉
- **GIVEN** session A 已成功分叉出 session B
- **WHEN** 用户以后恢复 A 并追加或截断 A 的 records
- **THEN** B replay 后的分叉基线和既有后续 records SHALL 保持不变
- **THEN** B 的恢复 SHALL NOT 依赖读取 A 的 journal

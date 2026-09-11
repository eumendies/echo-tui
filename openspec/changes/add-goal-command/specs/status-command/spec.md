## ADDED Requirements

### Requirement: status surface 展示 goal 摘要
status surface SHALL 在快照生成时存在 goal 的情况下展示 goal 摘要行，包含状态（`active`/`paused`）、条件摘要与轮次进度（N/M）；不存在 goal 时 SHALL NOT 展示 goal 区域。goal 摘要 SHALL 为本地只读信息，SHALL NOT 触发额外模型请求，也 SHALL NOT 修改 goal 状态或追加 transcript record。

#### Scenario: 展示 active goal 摘要
- **WHEN** 用户提交 `/status` 且当前存在 `active` goal
- **THEN** surface SHALL 展示 goal 摘要行
- **AND** 摘要行 SHALL 包含条件摘要、active 状态与 `N/M` 轮次进度

#### Scenario: 展示 paused goal 摘要
- **WHEN** 用户提交 `/status` 且当前存在 `paused` goal
- **THEN** surface SHALL 以可与 active 区分的形式展示暂停状态
- **AND** 摘要行 SHALL 包含条件摘要与轮次进度

#### Scenario: 无 goal 时隐藏
- **WHEN** 用户提交 `/status` 且当前不存在 goal
- **THEN** surface SHALL NOT 展示 goal 区域

#### Scenario: 摘要保持只读语义
- **WHEN** status surface 展示 goal 摘要
- **THEN** 系统 SHALL NOT 因展示而请求模型、修改 goal 状态或追加 transcript record
- **AND** 条件摘要的截断 SHALL NOT 修改 GoalState 中保存的完整条件

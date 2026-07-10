## ADDED Requirements

### Requirement: AppContext 持有 transient context usage
AppContext SHALL 持有最近一次真实 provider context usage 作为当前进程内 transient state。该状态 SHALL 参与 render state 派生，但 SHALL NOT 写入 transcript、persisted session、input history 或用户配置。

#### Scenario: 设置 context usage
- **WHEN** app 层收到 agent callback 上报的真实 context usage
- **THEN** AppContext SHALL 保存 used tokens、context window 和 usage source
- **THEN** 后续 render state SHALL 能把该 usage 传递给 status line

#### Scenario: context usage 不持久化
- **WHEN** transcript records 被保存到 session
- **THEN** context usage SHALL NOT 被写入 transcript record
- **THEN** context usage SHALL NOT 被写入 persisted session 的 compaction metadata 或其他字段

#### Scenario: 模型切换清空旧 usage
- **WHEN** 用户通过 `/model` 成功切换当前模型 profile
- **THEN** AppContext SHALL 清空已有 context usage
- **THEN** status line SHALL 在下一次真实 provider usage 到达前不显示旧模型的 context usage

#### Scenario: 清空 transcript 清空 usage
- **WHEN** 用户通过 `/clear` 清空当前 transcript
- **THEN** AppContext SHALL 清空已有 context usage

#### Scenario: 恢复 session 清空 usage
- **WHEN** 用户通过 `/resume` 恢复历史 transcript session
- **THEN** AppContext SHALL 清空已有 context usage
- **THEN** 恢复后的 status line SHALL NOT 显示恢复前进程内的旧 usage

#### Scenario: 新 turn 之前保留最近真实 usage
- **WHEN** 用户开始新的普通 assistant turn
- **AND** 新 provider usage 尚未返回
- **THEN** AppContext MAY 保留并显示上一轮最近一次真实 usage
- **THEN** 一旦新 provider usage 返回，AppContext SHALL 更新为新的 usage

## ADDED Requirements

### Requirement: 删除 session 时清理 model settings sidecar
系统 SHALL 在历史 session 的 JSONL journal 删除成功后，尽力移除同 cwd、同 session id 的 model/effort settings sidecar。sidecar 缺失 SHALL 被视为已满足清理；sidecar 清理失败 SHALL NOT 复活已删除 session、阻塞其从 `/resume` 或 `/reference` 枚举中消失，或影响当前 session 的 model/effort 状态。

#### Scenario: 删除具有 settings 的历史 session
- **WHEN** 用户确认删除一个具有有效 model/effort settings sidecar 的历史 session
- **THEN** 系统 SHALL 在 journal 删除成功后移除该 sidecar
- **THEN** 系统 SHALL 保持其他 session 的 settings sidecar 不变

#### Scenario: 删除没有 settings 的历史 session
- **WHEN** 用户确认删除一个不存在 settings sidecar 的历史 session
- **THEN** 系统 SHALL 仍将 journal 删除视为成功
- **THEN** 系统 SHALL NOT 为清理动作创建新的 sidecar

#### Scenario: sidecar 清理失败
- **WHEN** 历史 session journal 已删除但对应 settings sidecar 无法移除
- **THEN** 系统 SHALL 保持该 session 不可恢复且不出现在候选列表
- **THEN** 系统 SHALL 不改变当前 session 的 model、effort 或其 settings sidecar

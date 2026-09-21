## ADDED Requirements

### Requirement: 按当前 cwd 受控删除持久化 session
系统 SHALL 提供仅供应用层调用的持久化 session 删除操作。该操作 SHALL 只接受当前 cwd 中、由 session 列表选出的 session id，且 SHALL 在删除前验证目标不是当前正在使用的 session、对应 `.jsonl` journal 存在并属于该 cwd；操作 SHALL NOT 根据用户输入的任意路径删除文件。成功删除的提交点 SHALL 是目标 JSONL journal 被移除，此后正式加载和 session 枚举 SHALL 不再将其视为可恢复 session。

#### Scenario: 成功删除一个历史 journal
- **WHEN** 应用层请求删除当前 cwd 中存在的非当前 session
- **THEN** 系统 SHALL 移除该 session 对应的 `.jsonl` journal
- **THEN** 后续 `loadSession` SHALL 不再加载该 session，`/resume` 和 `/reference` 枚举 SHALL 不再返回该 session

#### Scenario: 目标不存在或不属于当前 cwd
- **WHEN** 应用层请求删除不存在的 session、其他 cwd 的 session 或不满足受控 session id 约束的目标
- **THEN** 系统 SHALL 返回不成功的受控结果
- **THEN** 系统 SHALL NOT 删除任何 journal、index 条目或其他 session 文件

#### Scenario: 目标是当前 session
- **WHEN** 应用层请求删除当前 app 仍持有写入 reference 的 session
- **THEN** 系统 SHALL 返回当前 session 受保护的结果
- **THEN** 系统 SHALL 保持该 journal、当前 transcript 和后续写入能力不变

### Requirement: 删除后 session index 与 journal 集合保持可重建一致
系统 SHALL 在成功移除 session journal 后从当前项目的轻量 session index 移除对应摘要，并使用既有临时文件与原子替换方式提交 index。若 journal 已删除但 index 写入失败，系统 SHALL 将 journal 删除视为已提交的事实；后续枚举 SHALL 排除该孤立 index 条目，并在能够写入时重建或修复 index。

#### Scenario: 删除成功时更新 index
- **WHEN** 一个历史 session journal 被成功删除且 index 可写
- **THEN** 新 index SHALL 不包含该 session 的摘要
- **THEN** index 更新 SHALL NOT 重写或删除其他有效 journal

#### Scenario: 删除后 index 更新失败
- **WHEN** 一个历史 session journal 已被成功删除但 index 的原子更新失败
- **THEN** 系统 SHALL NOT 将已删除 journal 视为仍可恢复
- **THEN** 下一次 session 枚举 SHALL 从真实 `.jsonl` 集合排除该孤立条目，并在可写时修复 index

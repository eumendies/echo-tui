## MODIFIED Requirements

### Requirement: Memory tool semantic and result projection
系统 SHALL 为仅操作 agent memory 的 `add_memory`、`read_memory`、`update_memory` 和 `remove_memory` 提供专属终端投影。调用投影 SHALL 分别使用 `Remembering`、`Recalling`、`Revising` 和 `Forgetting` 或等价动作摘要，并根据 catalog/item 目标展示有意义的 content 或 catalog 上下文。正常投影 SHALL NOT 显示完整 arguments JSON、item id、时间戳、enabled、scope 或内部 JSON 字段名。Footer pending preview、孤立 transcript call 和完成 pair 中的 call SHALL 使用一致摘要规则。

#### Scenario: Memory call 使用 agent memory 语义摘要
- **WHEN** memory tool call 包含可识别的 catalog/item 或 content 参数
- **THEN** renderer SHALL 显示对应的 Remembering、Recalling、Revising 或 Forgetting 摘要
- **THEN** item add 或 update SHALL 显示 bounded content preview；catalog update SHALL 显示旧名称及存在时的 rename 方向
- **THEN** item 与 catalog remove SHALL 使用不同摘要；renderer SHALL NOT 为恢复被删内容而显示 item id 或搜索其他 transcript records
- **THEN** renderer SHALL NOT 依赖 `type` 参数区分 user 与 agent memory

#### Scenario: Pending memory call 使用同一摘要
- **WHEN** footer pending preview 或孤立 transcript call 包含任一 memory tool
- **THEN** renderer SHALL 使用与完成 pair 相同的动作摘要
- **THEN** renderer SHALL NOT 短暂展示 raw arguments JSON

#### Scenario: 成对 memory mutation 成功时隐藏 result body
- **WHEN** 成功的 `add_memory`、`update_memory` 或 `remove_memory` call 与同 call id result 相邻
- **THEN** renderer SHALL 只显示语义化调用摘要
- **THEN** renderer SHALL NOT 显示成功 result JSON、id、时间戳或存储快照

#### Scenario: 成对 memory read 展示内容列表或失败诊断
- **WHEN** 成功 `read_memory` result 包含 agent memories
- **THEN** renderer SHALL 使用一致的分点列表展示每个非空 content
- **THEN** renderer SHALL NOT 显示 catalog description、item id、enabled、createdAt、updatedAt 或 result JSON 结构
- **WHEN** 成功结果的 memories 为空
- **THEN** renderer SHALL 显示空状态
- **WHEN** memory call/result 失败
- **THEN** renderer SHALL 显示带失败状态的调用摘要和受既有预算限制的失败文本

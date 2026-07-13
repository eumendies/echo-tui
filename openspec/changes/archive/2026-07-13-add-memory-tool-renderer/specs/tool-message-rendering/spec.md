## ADDED Requirements

### Requirement: Memory tool call semantic projection
系统 SHALL 为 `add_memory`、`read_memory`、`update_memory` 和 `remove_memory` 的 tool call 提供专属终端投影。投影 SHALL 分别使用 `Remembering`、`Recalling`、`Revising` 和 `Forgetting` 或等价的记忆动作摘要，并 SHALL 根据 user/agent、catalog/item 目标显示有意义的 content 或 catalog 上下文。正常投影 SHALL NOT 显示完整 arguments JSON、item id、时间戳、enabled、scope 或内部 JSON 字段名。Footer pending preview、孤立 transcript call 和完成 pair 中的 call SHALL 使用一致的摘要规则。

#### Scenario: Add memory 使用 Remembering 摘要
- **WHEN** `add_memory` call 包含 user memory content
- **THEN** renderer SHALL 显示 `Remembering · <content-preview>` 或等价摘要
- **WHEN** `add_memory` call 包含 agent catalog 和 content
- **THEN** renderer SHALL 显示 `Remembering in <catalog> · <content-preview>` 或等价摘要
- **THEN** renderer SHALL NOT 显示原始 arguments JSON

#### Scenario: Read memory 使用 Recalling 摘要
- **WHEN** `read_memory` call 的 type 为 user
- **THEN** renderer SHALL 显示 `Recalling user memories` 或等价摘要
- **WHEN** `read_memory` call 的 type 为 agent 且包含 catalog
- **THEN** renderer SHALL 显示 `Recalling · <catalog>` 或等价摘要

#### Scenario: Update memory 使用 Revising 摘要
- **WHEN** `update_memory` call 更新 user 或 agent item
- **THEN** renderer SHALL 使用 `Revising` 摘要并显示新 content 的 bounded preview
- **WHEN** `update_memory` call 更新 agent catalog
- **THEN** renderer SHALL 显示 catalog 名称，并在存在新名称时表达 rename 方向
- **THEN** renderer SHALL NOT 显示 item id 或完整 arguments JSON

#### Scenario: Remove memory 使用 Forgetting 摘要
- **WHEN** `remove_memory` call 删除 user item
- **THEN** renderer SHALL 显示 `Forgetting user memory` 或等价摘要
- **WHEN** `remove_memory` call 删除 agent item 或 catalog
- **THEN** renderer SHALL 使用 `Forgetting` 摘要区分 catalog 删除与 catalog 内 item 删除
- **THEN** renderer SHALL NOT 为恢复被删内容而展示 item id 或搜索其他 transcript records

#### Scenario: Pending preview 复用 memory 摘要
- **WHEN** footer pending preview 显示任一 memory tool call
- **THEN** preview SHALL 使用与 transcript call 相同的动作摘要
- **THEN** preview SHALL NOT 短暂展示 raw arguments JSON

### Requirement: Memory tool pair-aware result projection
系统 SHALL 为相邻且 `toolCallId` 匹配的 memory call/result 提供 pair-aware 投影。成功的 `add_memory`、`update_memory` 和 `remove_memory` SHALL 只显示调用摘要并隐藏成功 result body；失败 mutation SHALL 在调用摘要后显示 bounded failure text。成功的 `read_memory` SHALL 在调用摘要后以分点列表展示 memory contents，失败读取 SHALL 显示 bounded failure text。

#### Scenario: 成功 mutation 只显示 call
- **WHEN** `add_memory`、`update_memory` 或 `remove_memory` call 与 `ok: true` result 成对渲染
- **THEN** renderer SHALL 只显示语义化调用摘要
- **THEN** renderer SHALL NOT 显示成功 result JSON、id、时间戳或存储快照

#### Scenario: 失败 mutation 显示诊断
- **WHEN** memory mutation call 与 `ok: false` result 成对渲染
- **THEN** renderer SHALL 显示带失败状态的调用摘要
- **THEN** renderer SHALL 显示受现有 tool result 预算限制的失败文本

#### Scenario: Agent read result 展示 item 列表
- **WHEN** 成功 `read_memory` result 包含 agent catalog memories
- **THEN** renderer SHALL 以 `•` 或等价列表 marker 展示每个非空 memory content
- **THEN** renderer SHALL NOT 显示 catalog description、item id、enabled、createdAt、updatedAt 或 result JSON 结构

#### Scenario: User read result 展示无状态列表
- **WHEN** 成功 `read_memory` result 包含 user memories
- **THEN** renderer SHALL 以与 agent memories 一致的分点列表展示每个非空 content
- **THEN** renderer SHALL NOT 根据 enabled 使用 on/off 文案、不同 marker 或其他启停状态提示
- **THEN** renderer SHALL NOT 显示 item id、createdAt、updatedAt 或 result JSON 结构

#### Scenario: Read result 为空
- **WHEN** 成功 `read_memory` result 包含空 memories 数组
- **THEN** renderer SHALL 显示 `No memories found.` 或等价空状态
- **THEN** renderer SHALL NOT 显示空数组 JSON

#### Scenario: Read memory 失败显示诊断
- **WHEN** `read_memory` call 与 `ok: false` result 成对渲染
- **THEN** renderer SHALL 显示 Recalling 调用摘要和 bounded failure text
- **THEN** renderer SHALL NOT 将失败结果误投影为空 memory 列表

### Requirement: Memory renderer safety and record preservation
Memory 专属 renderer SHALL 只改变终端可见投影，不得改变 transcript record、tool result、provider continuation、session 持久化或 compaction 输入。无法解析 call/result JSON 时 SHALL 使用不含 raw JSON 的 memory 安全摘要，而不是回退到会展开内部 payload 的通用 renderer。所有可见行 SHALL 遵守现有 safe render width 和 tool result 总行数预算。

#### Scenario: Malformed call 使用安全摘要
- **WHEN** memory tool call 的 argumentsText 不是可解析的预期 JSON object
- **THEN** renderer SHALL 根据 tool name 显示通用 Remembering、Recalling、Revising 或 Forgetting 摘要
- **THEN** renderer SHALL NOT 显示 malformed argumentsText 或抛出异常

#### Scenario: Malformed success result 不展示 raw JSON
- **WHEN** memory tool 的 `ok: true` result 无法解析为预期 payload
- **THEN** renderer SHALL 隐藏 mutation result 或显示安全完成摘要，read result SHALL 显示安全 unavailable 状态
- **THEN** renderer SHALL NOT 回退展示 raw result text

#### Scenario: 长内容和窄终端受限展示
- **WHEN** memory content、catalog 名称或 memory 列表超过可用宽度或显示预算
- **THEN** renderer SHALL 按 safe render width 换行并按预算截断
- **THEN** 超出结果预算时 SHALL 显示既有 tool output truncation 提示
- **THEN** 每个可见行的显示宽度 SHALL 不超过当前 safe render width

#### Scenario: 原始 memory tool 记录保持不变
- **WHEN** memory call 或 result 被专属 renderer 投影
- **THEN** 原始 `toolName`、`argumentsText`、`text`、`ok` 和 `toolCallId` SHALL 保持不变
- **THEN** provider continuation SHALL 接收原始 tool result JSON 而不是渲染后的动作摘要或列表

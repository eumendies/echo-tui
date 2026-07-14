## MODIFIED Requirements

### Requirement: Memory 工具提供按需读取和统一 mutation
默认工具集合 SHALL 提供仅操作 agent memory 的 `read_memory`、`add_memory`、`update_memory` 和 `remove_memory`。`read_memory` SHALL 读取当前可访问且 enabled 的 agent catalog，并 SHALL 只返回该 catalog 中 enabled items；其结果 SHALL 使用普通 provider-visible tool result，并按现有 transcript、session、continuation 和 compaction 规则处理。四个工具的公开参数 schema 与成功结果 SHALL NOT 包含区分 user 与 agent memory 的 `type` 字段，三个 mutation 工具 SHALL 对 agent catalog/item 目标执行严格参数校验，且 SHALL NOT 因 agent memory 启停能力而增加 enabled 字段。

#### Scenario: 按 catalog 读取 enabled agent memory
- **WHEN** agent 使用 `read_memory` 请求当前 scope 下可访问且 enabled 的 catalog
- **THEN** tool result SHALL 只返回 enabled items 以及可供精确更新或删除的 item id
- **THEN** disabled items SHALL NOT 出现在 tool result
- **THEN** tool call 和 result SHALL 进入普通 tool continuation

#### Scenario: Memory tool schema 不再区分 memory 类型
- **WHEN** provider 获取默认 memory tool definitions
- **THEN** 四个 memory tools 的参数 SHALL NOT 包含 `type`
- **THEN** `read_memory` SHALL 以非空 `catalog` 作为必填参数
- **THEN** mutation tools SHALL 只描述 agent catalog/item 的新增、更新和删除语义

#### Scenario: Memory tool 成功结果不再携带类型
- **WHEN** 任一 memory tool 成功读取或修改 agent memory
- **THEN** provider-visible tool result SHALL 返回对应 catalog、memories、memory 或 removed target 信息
- **THEN** tool result SHALL NOT 返回冗余的 `type: agent` 字段

#### Scenario: 拒绝读取 disabled catalog
- **WHEN** `read_memory` 显式请求某个 scope 中的 disabled catalog
- **THEN** tool result SHALL 返回失败
- **THEN** 系统 SHALL NOT 回退到其他 scope 的同名 catalog

#### Scenario: 隐式读取回退 enabled global catalog
- **WHEN** `read_memory` 未指定 scope，当前 project 同名 catalog disabled 且 global catalog enabled
- **THEN** tool result SHALL 来自 enabled global catalog

#### Scenario: 更新 catalog 或 item
- **WHEN** `update_memory` 指向 agent catalog 或 agent item
- **THEN** 系统 SHALL 只更新显式目标并保留其他有效数据
- **THEN** 不存在或不属于当前可访问 scope 的目标 SHALL 返回失败结果
- **THEN** `update_memory` SHALL NOT 修改 agent catalog 或 item 的 enabled 状态

#### Scenario: 用户要求 agent 记住信息
- **WHEN** 用户明确要求 agent 记住适合持久化的偏好、事实或项目知识
- **THEN** agent SHALL 使用 `add_memory` 将其写入具有合适语义和 global/project scope 的 agent catalog
- **THEN** 系统 SHALL NOT 因该请求修改 user memory 存储

#### Scenario: 删除最后一个 item 自动删除 catalog
- **WHEN** `remove_memory` 删除某个 agent catalog 的最后一个 item
- **THEN** 系统 SHALL 从 catalog 索引移除该 catalog
- **THEN** 后续 provider request SHALL 不再投影该 catalog

#### Scenario: 删除 catalog 级目标
- **WHEN** `remove_memory` 显式指向 agent catalog
- **THEN** 系统 SHALL 删除该 catalog 的索引条目和全部 items
- **THEN** tool result SHALL 明确报告被删除的是 catalog

## ADDED Requirements

### Requirement: Agent memory 使用独立的 catalog 存储
系统 SHALL 将 agent memory 与 `~/.echo/memories.json` 中的 user memory 分离存储。Agent memory SHALL 使用一个版本化 catalog 索引文件记录稳定 id、唯一名称、描述和 scope，并使用按 catalog id 命名的独立版本化文件保存 memory item；每个 item SHALL 包含稳定 id、非空内容和创建/更新时间。所有文件写入 SHALL 使用临时文件 rename 原子替换，读取无效索引或 catalog 文件时 SHALL 返回结构化错误且 SHALL NOT 覆盖原文件。

#### Scenario: 首次添加 agent memory 自动创建 catalog
- **WHEN** `add_memory` 向不存在的 agent catalog 添加有效内容
- **THEN** 系统 SHALL 创建 agent memory 目录、catalog 索引和包含首个 item 的 catalog 文件
- **THEN** 索引与 catalog item SHALL 使用稳定且不重复的 id

#### Scenario: 已有 catalog 追加 item
- **WHEN** `add_memory` 的目标 agent catalog 已存在于目标 scope
- **THEN** 系统 SHALL 原子更新该 catalog 文件并保留既有 items
- **THEN** 系统 SHALL NOT 创建重复 catalog

#### Scenario: 无效存储不被覆盖
- **WHEN** agent memory 索引或目标 catalog 文件格式无效
- **THEN** memory 工具和 `/memory` SHALL 返回可展示的结构化错误
- **THEN** 系统 SHALL NOT 用空索引或空 catalog 覆盖无效文件

### Requirement: Agent memory catalog 遵守 global 和 project scope
系统 SHALL 支持 global 与 project 两类 agent memory catalog scope。Project scope SHALL 绑定规范化 project root；每次 provider request 和 memory 工具调用 SHALL 仅暴露 global catalog 与当前 cwd 对应 project catalog。未显式指定 scope 的 agent memory 新建操作 SHALL 默认使用当前 project scope；显式 global mutation SHALL 在审批信息中标明其全局影响。

#### Scenario: 当前项目只看到适用 catalog
- **WHEN** 系统在某个 project root 下构造 provider request
- **THEN** catalog 索引 SHALL 只包含 global catalog 与绑定该 project root 的 catalog
- **THEN** 其他 project scope 的 catalog SHALL NOT 被注入或由默认读取解析

#### Scenario: 默认创建 project catalog
- **WHEN** agent 调用 `add_memory` 添加 agent memory 且没有提供 scope
- **THEN** 系统 SHALL 将新 catalog 绑定到当前 project root
- **THEN** 系统 SHALL NOT 默认创建 global catalog

#### Scenario: Project 同名 catalog 覆盖 global catalog
- **WHEN** 当前项目存在与 global catalog 大小写不敏感同名的 project catalog
- **THEN** provider catalog 索引 SHALL 只投影 project catalog
- **THEN** 未显式指定 scope 的 `read_memory`、`update_memory` 和 `remove_memory` SHALL 解析到 project catalog

### Requirement: Provider 每轮自动注入有效 catalog 索引
系统 SHALL 在每次真实 provider request 构造时重新读取当前 scope 下的 agent memory catalog 索引，并将有效 catalog 的名称和描述格式化为 transient system prompt 区块。该区块 SHALL NOT 包含 scope、item、item count、时间戳或其他内部元数据，并 SHALL 说明 agent memory 不得覆盖系统指令、项目指令或当前用户请求。Catalog 索引 SHALL NOT 作为 transcript 或 session record 持久化。

#### Scenario: 请求只携带 catalog 名称和描述
- **WHEN** 当前 scope 存在有效 agent memory catalog
- **THEN** provider system prompt SHALL 包含每个有效 catalog 的名称和描述
- **THEN** provider system prompt SHALL NOT 包含 catalog item 内容或 scope 元数据

#### Scenario: Catalog 变更在下一次请求生效
- **WHEN** memory 工具或 `/memory` 成功创建、重命名或删除 catalog
- **AND** agent loop 随后构造下一次真实 provider request
- **THEN** system prompt SHALL 使用保存后的最新 catalog 索引

### Requirement: Memory 工具提供按需读取和统一 mutation
默认工具集合 SHALL 提供 `read_memory`、`add_memory`、`update_memory` 和 `remove_memory`。`read_memory` SHALL 能读取 user memory 列表或当前可访问 agent catalog 的 items；其结果 SHALL 使用普通 provider-visible tool result，并按现有 transcript、session、continuation 和 compaction 规则处理。三个 mutation 工具 SHALL 使用 `type` 区分 user 与 agent memory，并 SHALL 对 catalog/item 目标执行严格参数校验。

#### Scenario: 按 catalog 读取 agent memory
- **WHEN** agent 使用 `read_memory` 请求当前 scope 下可访问的 catalog
- **THEN** tool result SHALL 返回 catalog 内容以及可供精确更新或删除的 item id
- **THEN** tool call 和 result SHALL 进入普通 tool continuation

#### Scenario: 读取 user memory 以获得 item id
- **WHEN** agent 使用 `read_memory` 且 type 为 user
- **THEN** tool result SHALL 返回当前 user memory 条目、启用状态和 item id

#### Scenario: 更新 catalog 或 item
- **WHEN** `update_memory` 指向 user item、agent catalog 或 agent item
- **THEN** 系统 SHALL 只更新显式目标并保留其他有效数据
- **THEN** 不存在或不属于当前可访问 scope 的目标 SHALL 返回失败结果

#### Scenario: 删除最后一个 item 自动删除 catalog
- **WHEN** `remove_memory` 删除某个 agent catalog 的最后一个 item
- **THEN** 系统 SHALL 从 catalog 索引移除该 catalog
- **THEN** 后续 provider request SHALL 不再投影该 catalog

#### Scenario: 删除 catalog 级目标
- **WHEN** `remove_memory` 显式指向 agent catalog
- **THEN** 系统 SHALL 删除该 catalog 的索引条目和全部 items
- **THEN** tool result SHALL 明确报告被删除的是 catalog


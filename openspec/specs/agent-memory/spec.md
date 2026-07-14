# agent-memory Specification

## Purpose
定义 agent memory 的独立存储、scope 过滤、provider catalog 注入，以及 memory 工具的按需读取与统一 mutation 行为。

## Requirements

### Requirement: Agent memory 使用独立的 catalog 存储
系统 SHALL 将 agent memory 与 `~/.echo/memories.json` 中的 user memory 分离存储。Agent memory SHALL 使用一个版本化 catalog 索引文件记录稳定 id、唯一名称、描述、scope 和布尔 `enabled` 状态，并使用按 catalog id 命名的独立版本化文件保存 memory item；每个 item SHALL 包含稳定 id、非空内容、布尔 `enabled` 状态和创建/更新时间。新建 catalog 和 item SHALL 默认启用。索引和 catalog 文件 SHALL 继续使用 `version: 1`，且读取时 SHALL 严格要求 `enabled` 字段存在并为 boolean，不兼容缺少该字段的旧开发文件。所有文件写入 SHALL 使用临时文件 rename 原子替换，读取无效索引或 catalog 文件时 SHALL 返回结构化错误且 SHALL NOT 覆盖原文件。

#### Scenario: 首次添加 agent memory 自动创建 catalog
- **WHEN** `add_memory` 向不存在的 agent catalog 添加有效内容
- **THEN** 系统 SHALL 创建 agent memory 目录、catalog 索引和包含首个 item 的 catalog 文件
- **THEN** 索引与 catalog item SHALL 使用稳定且不重复的 id
- **THEN** 新 catalog 和首个 item SHALL 均包含 `enabled: true`

#### Scenario: 已有 catalog 追加 item
- **WHEN** `add_memory` 的目标 agent catalog 已存在于目标 scope
- **THEN** 系统 SHALL 原子更新该 catalog 文件并保留既有 items
- **THEN** 新 item SHALL 包含 `enabled: true`
- **THEN** 系统 SHALL NOT 创建重复 catalog 或改变 catalog 的 enabled 状态

#### Scenario: 缺少 enabled 的开发文件无效
- **WHEN** agent memory catalog 索引条目或 item 缺少 boolean `enabled`
- **THEN** 系统 SHALL 将文件视为格式无效
- **THEN** 系统 SHALL NOT 因文件仍为 `version: 1` 而补充默认值或自动迁移

#### Scenario: 无效存储不被覆盖
- **WHEN** agent memory 索引或目标 catalog 文件格式无效
- **THEN** memory 工具和 `/memory` SHALL 返回可展示的结构化错误
- **THEN** 系统 SHALL NOT 用空索引或空 catalog 覆盖无效文件

### Requirement: Agent memory catalog 遵守 global 和 project scope
系统 SHALL 支持 global 与 project 两类 agent memory catalog scope。Project scope SHALL 绑定规范化 project root；每次 provider request 和 memory 工具调用 SHALL 仅考虑 global catalog 与当前 cwd 对应 project catalog。未显式指定 scope 的 agent memory 新建操作 SHALL 默认使用当前 project scope；显式 global mutation SHALL 在审批信息中标明其全局影响。Provider prompt 与 `read_memory` 的有效 catalog 解析 SHALL 先排除 disabled catalog，再由 enabled project catalog 覆盖大小写不敏感同名的 enabled global catalog。

#### Scenario: 当前项目只看到适用 catalog
- **WHEN** 系统在某个 project root 下构造 provider request
- **THEN** catalog 索引 SHALL 只考虑 global catalog 与绑定该 project root 的 catalog
- **THEN** 其他 project scope 的 catalog SHALL NOT 被注入或由默认读取解析

#### Scenario: 默认创建 project catalog
- **WHEN** agent 调用 `add_memory` 添加 agent memory 且没有提供 scope
- **THEN** 系统 SHALL 将新 catalog 绑定到当前 project root
- **THEN** 系统 SHALL NOT 默认创建 global catalog

#### Scenario: Enabled project 同名 catalog 覆盖 global catalog
- **WHEN** 当前项目存在与 enabled global catalog 大小写不敏感同名的 enabled project catalog
- **THEN** provider catalog 索引 SHALL 只投影 project catalog
- **THEN** 未显式指定 scope 的 `read_memory` SHALL 解析到 project catalog
- **THEN** 未显式指定 scope 的 `update_memory` 和 `remove_memory` SHALL 继续解析到 project catalog

#### Scenario: Disabled project 同名 catalog 回退 global catalog
- **WHEN** 当前项目存在 disabled project catalog，且存在大小写不敏感同名的 enabled global catalog
- **THEN** provider catalog 索引 SHALL 投影 global catalog
- **THEN** 未显式指定 scope 的 `read_memory` SHALL 解析到 global catalog

### Requirement: Provider 每轮自动注入有效 catalog 索引
系统 SHALL 在每次真实 provider request 构造时重新读取当前 scope 下的 agent memory catalog 索引，并将 enabled 有效 catalog 的名称和描述格式化为 transient system prompt 区块。Disabled catalog SHALL NOT 进入该区块。该区块 SHALL NOT 包含 scope、enabled、item、item count、时间戳或其他内部元数据，并 SHALL 说明 agent memory 不得覆盖系统指令、项目指令或当前用户请求。Catalog 索引 SHALL NOT 作为 transcript 或 session record 持久化。

#### Scenario: 请求只携带 enabled catalog 的名称和描述
- **WHEN** 当前 scope 存在 enabled 和 disabled agent memory catalog
- **THEN** provider system prompt SHALL 只包含 enabled 有效 catalog 的名称和描述
- **THEN** provider system prompt SHALL NOT 包含 disabled catalog、catalog item 内容或 scope/启停元数据

#### Scenario: Catalog 启停在下一次请求生效
- **WHEN** 用户通过 `/memory` 成功切换 catalog enabled 状态
- **AND** agent loop 随后构造下一次真实 provider request
- **THEN** system prompt SHALL 使用保存后的最新 enabled catalog 索引

#### Scenario: Catalog 元数据变更在下一次请求生效
- **WHEN** memory 工具或 `/memory` 成功创建、重命名或删除 catalog
- **AND** agent loop 随后构造下一次真实 provider request
- **THEN** system prompt SHALL 使用保存后的最新 catalog 索引

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

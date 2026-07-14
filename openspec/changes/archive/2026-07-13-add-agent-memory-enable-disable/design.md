## Context

Agent memory 当前由一个 `catalogs.json` 索引和按 catalog id 拆分的 item 文件组成。管理 UI 使用 `listAgentMemoryCatalogs` 与 `readAgentMemoryCatalog` 读取完整数据，而 provider request 使用 `listEffectiveAgentMemoryCatalogs` 生成轻量 catalog 索引，`read_memory` 则复用普通 catalog 读取。现有 catalog 和 item 均没有启停状态。

本次变更横跨存储校验、有效 scope 解析、tool 读取和 `/memory` command surface。由于 agent memory 尚未发布，允许直接扩展 `version: 1` 格式，不承担旧开发文件迁移成本。

## Goals / Non-Goals

**Goals:**

- 让用户可在 `/memory` 中独立启停 agent catalog 和 item，而无需删除内容。
- 保证 disabled catalog 不进入 provider system prompt，也不能由 `read_memory` 读取。
- 保证 disabled item 仍可管理，但不进入 `read_memory` 结果。
- 保持 project/global 同名覆盖在启停后的行为确定且可测试。
- 保持现有 mutation tool schema、审批策略和 agent memory 文件版本不变。

**Non-Goals:**

- 不允许 agent 通过 `add_memory`、`update_memory` 或 `remove_memory` 切换 enabled 状态。
- 不兼容或自动迁移缺少 `enabled` 的旧 agent memory 开发文件。
- 不改变 user memory 的启停和 `read_memory` 语义。
- 不增加 catalog 时间戳、空 catalog 或新的 scope 类型。

## Decisions

### 1. Catalog 与 item 都持久化严格 boolean `enabled`

`AgentMemoryCatalog` 和 `AgentMemoryItem` 均增加必需的 `enabled` 字段，新建 catalog 和 item 默认 `true`。索引和 catalog 文件继续写入 `version: 1`；解析时缺少字段或字段不是 boolean 均视为无效格式。

选择严格解析而不是缺省为 `true`，是因为功能仍处开发期，直接暴露陈旧 fixture 或手工文件更有利于尽早发现数据假设错误。

### 2. 区分管理读取与 agent 有效读取

`listAgentMemoryCatalogs` 和 `readAgentMemoryCatalog` 保留所有 enabled/disabled 数据，作为 `/memory` 的管理视图。Provider 继续通过 `listEffectiveAgentMemoryCatalogs` 读取有效 catalog；该函数先排除 disabled catalog，再应用 project 同名覆盖 global。

为 `read_memory` 提供独立的有效 catalog 读取能力，而不在普通 catalog 读取中增加过滤。有效读取在未指定 scope 时依次选择 enabled project、enabled global；显式 scope 只检查该 scope，目标 disabled 时返回失败。返回成功后只投影 enabled items。

这种双视角避免管理 UI 因读取过滤而无法重新启用数据，也避免用可选 boolean 参数模糊存储 API 的调用语义。

### 3. Disabled project 不作为同名 global 的屏蔽标记

有效 catalog 解析先过滤 disabled，再执行 project 覆盖。因此 disabled project 与 enabled global 同名时，provider prompt 和未指定 scope 的 `read_memory` 都使用 global catalog。若调用显式指定 project scope，则拒绝读取 disabled project，不回退 global。

这使 `enabled` 表示“是否参与有效解析”，而不是引入未声明的 tombstone 语义。

### 4. 启停使用仅供本地管理的专用 mutation

存储和 `CommandHost` 增加 catalog/item enabled setter，供 `/memory` Space 操作调用。Catalog setter 只更新索引中的 `enabled`；item setter 更新 catalog 文件中的 `enabled` 和 `updatedAt`。现有内容编辑函数及三个 mutation tool schema 不增加 enabled 参数。

新 item 即使添加到 disabled catalog 中也默认启用，但 catalog 保持 disabled；只有用户在 `/memory` 中重新启用 catalog 后它才可被读取。

### 5. `/memory` 缓存保存完整管理状态

Catalog 和 item 行复用 user memory 的 toggle 表达，Space 在当前列表切换选中对象。成功 mutation 返回的快照立即更新当前 surface 和 session cache，不额外重载全部文件；失败时保留当前选择和缓存并显示错误。

一级类型菜单中的 global/project item count 继续统计全部 item，包括 disabled item，因为该数字表示可管理数据量而不是 provider 可见量。

## Risks / Trade-offs

- [旧开发文件缺少 `enabled` 后无法读取] → 这是明确接受的开发期破坏性格式调整；测试 fixture 全量更新，必要时手工删除本地 agent-memory 目录重建。
- [管理读取与有效读取出现逻辑漂移] → 将有效 catalog 选择集中在独立存储函数，并覆盖隐式 scope、显式 scope及同名 fallback 测试。
- [切换后 session cache 与磁盘不一致] → setter 返回完整 mutation snapshot，handler 只从成功结果更新 cache；失败不修改内存状态。
- [disabled catalog 仍可被 mutation tools 修改] → 本次只限制发现和读取，保持既有 mutation tool 能力不变；启停本身仍只能由本地 UI 控制。

## Migration Plan

不提供数据迁移。实现合入后，新建数据直接包含 `enabled: true`；缺少字段的本地开发文件会报告格式错误，开发者可删除后重建。回滚不涉及外部服务或依赖。

## Open Questions

无。

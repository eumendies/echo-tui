## Context

Echo TUI 当前使用四个 memory tools 同时承载两套语义：user memory 是保存在 `~/.echo/memories.json`、每轮全文注入的用户固定背景；agent memory 则按 global/project scope 和 catalog 组织，只在 system prompt 中注入索引，并通过 `read_memory` 按需读取内容。工具依靠 `type: user | agent` 分派到不同 store，`update_memory` 和 `remove_memory` 还需要结合 `target: catalog | item` 解释其余字段。

这种统一接口减少了工具数量，却产生了大量条件字段和无效组合，也使 system prompt 将 agent 写入并经审批的内容描述为“user-provided”。本变更不改变两套存储及 `/memory` 管理界面，只收紧 provider 可调用工具的边界。

## Goals / Non-Goals

**Goals:**

- 四个 memory tools 仅操作 agent memory，并从公开输入 schema 移除 `type`。
- 移除 handler 对 user memory store 的依赖和所有 user memory 工具分支。
- 保留 agent catalog/item、global/project scope、审批、普通 tool continuation 和启停行为。
- 让 user memory 恢复为仅由用户通过 `/memory` 维护的每轮固定背景。

**Non-Goals:**

- 不删除、迁移或重命名现有 user/agent memory 文件。
- 不移除 `/memory` 对任一 memory 类型的人工管理能力。
- 不改变 agent memory 的 catalog 数据模型、scope 覆盖规则或 enabled 行为。
- 不新增自然语言专用的 user memory pin 工具，也不建立固定的 `user-request` catalog。
- 不在本变更中移除 agent 对 catalog 元数据更新或整库删除的能力。

## Decisions

### 1. 保留四个工具名称，但将输入收敛为 agent memory

工具名称和职责保持不变，避免扩大 registry 并保留现有审批分类：

```text
read_memory(catalog, scope?)
add_memory(catalog, content, catalogDescription?, scope?)
update_memory(target, catalog, itemId?, content?, name?, description?, scope?)
remove_memory(target, catalog, itemId?, scope?)
```

`read_memory` 将 `catalog` 设为必填；`update_memory` 和 `remove_memory` 将所有 agent 目标都需要的 `catalog` 设为必填。`target` 继续区分 item 与 catalog，因为 catalog rename、description 更新和整库删除仍是已存在的 agent 能力。item id、content 与 catalog 元数据继续由 handler 根据 target 做严格校验，公开 schema 不增加 enabled。

替代方案是保留 `type` 并只修改描述，但这不会减少条件组合，也无法建立清晰边界。另一方案是把 catalog 操作拆成新工具，虽然单个 schema 更窄，却增加工具数量且超出本次“只操作 agent memory”的范围。

### 2. Handler 不再导入或调用 user memory store

`memory-tool-handler.ts` 删除 `createUserMemory`、`readUserMemories`、`updateUserMemory` 和 `deleteUserMemory` 依赖，并删除 `parseType` 及 user 分支。每个执行函数直接解析 agent memory 所需字段并调用 agent memory store。

Provider tool schema 的 `additionalProperties: false` 是本次尚未发布接口的唯一参数边界；handler 直接解析 agent memory 所需字段，不增加针对已废弃字段的兼容或迁移逻辑。

成功结果中的冗余 `type: agent` 一并移除，结果继续返回 catalog、memory 或 removed target 信息。普通 tool result 生命周期不变。

### 3. 自然语言“记住”请求写入语义化 agent catalog

`add_memory` 描述 SHALL 说明：用户明确要求记住的稳定偏好、事实或项目知识也写入 agent memory；跨项目偏好使用 global scope，项目知识使用默认 project scope。Catalog 由 agent 按内容语义选择，例如 `user-preferences` 或 `project-conventions`，系统不硬编码 `user-request`。

不固定单一 catalog 可以避免无关信息聚集后每次整库读取。代价是 agent 需要选择 catalog 和 scope；现有 catalog 索引与审批 preview 可帮助用户确认该选择。

User memory 仍有独立价值：其 enabled 内容每轮自动注入，适合作为用户手工固定的 always-on 背景。Agent memory 只保证 catalog 可发现，不保证每轮读取，因此本变更不把现有 user memory 自动迁移到 agent memory。

### 4. 审批与渲染删除 memory 类型分支

三个 mutation 工具继续要求审批，plan mode 继续拒绝执行；`read_memory` 仍为安全只读工具。审批 preview 删除 `Type` 行，保留 scope、catalog、target、item 和内容摘要，global mutation 仍显式标注全局影响。

Memory renderer 直接根据 catalog、target 和 content 生成摘要，不再检查 `args.type`。成功 read result 只解析 agent memories；无法解析的 call/result 继续使用既有 malformed/safe fallback。

### 5. User memory 仅保留本地管理与 prompt 注入路径

`/memory` 的 CommandHost facade 和 user memory store 保持不变，因为它们仍服务于用户直接管理。Provider request 仍在每轮重读 enabled user memories。仅删除 provider tools 到 user memory store 的连接，因此无需数据迁移，也不会影响已有用户偏好。

相关文档与规范应明确区分：

```text
User memory   用户通过 /memory 管理，enabled 内容每轮自动注入
Agent memory  agent tools 或 /memory 管理，catalog 索引自动注入、items 按需读取
```

## Risks / Trade-offs

- **[自然语言“记住”不再产生每轮自动注入内容]** → 工具描述引导 agent 选择可发现的语义 catalog；必须 always-on 的内容由用户通过 `/memory` 固定为 user memory。
- **[Agent 可能选择错误 scope 或 catalog]** → 默认 project 限制影响范围，global mutation 的审批 preview 保持醒目标识，用户可通过 `/memory` 纠正。
- **[只移除 `type` 后 update/remove 仍有 target 条件字段]** → 这是保留 catalog mutation 能力的明确取舍；若真实使用中仍造成模型误调，再单独评估将 catalog 管理收回 `/memory`。

## Migration Plan

1. 更新 memory tool definitions、handler、审批 preview 和 renderer，使新 provider request 只看到 agent memory schema。
2. 更新测试，覆盖无 `type` 的正常操作及 user memory 文件不受 agent memory 工具调用影响。
3. 更新架构文档与 OpenSpec 主规范，明确 user memory 的本地管理边界。
4. 发布时不转换任何持久化文件；现有 user memory 与 agent memory 原样继续读取。
5. 如需回滚，恢复旧工具 schema 与 user store 分派即可，存储格式没有变化。

## Open Questions

暂无阻塞问题。是否进一步取消 agent catalog metadata mutation，应由本变更上线后的工具调用质量决定。

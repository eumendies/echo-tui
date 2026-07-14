## Context

Echo TUI 现有 user memory 使用 `~/.echo/memories.json` 保存用户显式维护的扁平条目，并在每次真实 provider request 中注入全部 enabled 内容。该模型适合少量稳定偏好，但 agent 长期积累的项目经验会持续增长，若继续全文注入会扩大 system prompt，并把不同项目的经验混在一起。

本变更增加独立 agent memory：存储层按 catalog 和 scope 组织，provider 每轮只看到当前可用 catalog 的名称与描述，agent 通过 `read_memory` 按需读取 item。读取结果沿用普通 tool call/result 生命周期；所有 mutation 复用现有风险分类和 tool approval。`/memory` 继续作为用户审阅和纠正两类 memory 的统一入口。

约束包括：不引入数据库或第三方依赖；继续使用同步文件 API 与原子 rename；不改变 user memory 文件格式；不把 scope 和 item 泄漏到 catalog prompt；不为 memory 建立独立的 agent loop continuation 协议。

## Goals / Non-Goals

**Goals:**

- 将 agent memory 与 user memory 的物理存储、类型和 prompt 投影分离。
- 支持 global/project scope，并保证其他项目 catalog 不会被默认注入或读取。
- 每次真实 provider request 自动加载有效 catalog 索引，但只投影名称与描述。
- 通过四个 provider-neutral 工具完成读取和受审批 mutation，同时允许 agent 修改 user memory。
- 在 `/memory` 中提供 user/agent、catalog/item 的完整人工纠错能力。
- 保持普通 tool result、session persistence、compaction 和 context usage 语义一致。

**Non-Goals:**

- 不实现向量搜索、语义检索、自动排序或自动压缩 catalog item。
- 不实现 turn-local/ephemeral memory tool result；读取内容正常进入 transcript 和 compaction。
- 不向 provider 暴露 catalog scope、item count、时间戳或 provenance。
- 不支持通过 UI 或工具直接迁移 catalog scope；需要时可删除后在目标 scope 重建。
- 不改变 user memory 的 enabled 模型，也不为 agent item 增加 confidence、usage count 或自动过期策略。

## Decisions

### 1. 使用索引文件加按 id 分离的 catalog 文件

Agent memory 存储位于：

```text
~/.echo/agent-memory/
├── catalogs.json
└── catalogs/
    ├── <catalog-id>.json
    └── <catalog-id>.json
```

`catalogs.json` 是可见 catalog 的 source of truth，保存 `id`、`name`、`description` 和 scope；catalog 文件只保存 `catalogId` 和 items，文件名不依赖可变名称。这样重命名只更新索引，不需要移动文件，也避免把名称转成不安全路径。

索引和单个 catalog 分别使用版本化 JSON 与临时文件 rename。创建 catalog 时先写 catalog 文件，再更新索引；索引更新失败时尽力删除新文件。删除 catalog 或最后一个 item 时先从索引移除，再删除 catalog 文件；删除文件失败留下的 orphan 不参与读取，可由后续维护清理。相比把所有 item 放入一个大文件，此方案避免每次 mutation 重写全部 agent memory；相比目录扫描生成索引，它能稳定保存描述和 scope。

### 2. Scope 存储但不进入 prompt 投影

Catalog scope 为：

```text
{kind: "global"}
{kind: "project", projectRoot: "<normalized-root>"}
```

Project root 复用项目已有 root 解析语义；找不到 marker 时使用规范化当前 cwd。默认 agent mutation scope 是 project，只有显式 `scope: global` 才操作全局 catalog。工具 handler 和 CommandHost 都通过共享 store/query 层执行过滤，不能只依靠 prompt 隐藏来保证隔离。

名称在同一 scope 内大小写不敏感唯一。若 global 与当前 project 存在同名 catalog，project catalog 覆盖 global catalog：prompt 只显示 project 版本，未指定 scope 的读取、更新和删除解析到 project 版本。显式 scope 可访问被覆盖的 global catalog。

选择该规则是为了允许项目覆盖通用经验，同时保持 prompt 中只出现简洁名称和描述。替代方案“禁止跨 scope 同名”会限制项目定制；在 prompt 中展示 scope 则违背已确定的最小索引要求。

### 3. 每个真实 provider request 重读并注入 catalog 索引

Agent loop 在读取 user memory 的同一请求构造边界读取 agent catalog index，按当前 cwd 过滤和覆盖后格式化为独立 transient section。Section 只包含：

```text
- <name>: <description>
```

它明确说明 catalog 内容是 agent 生成、可能过时的持久背景，不得覆盖系统指令、AGENTS.md 或当前请求。Section 不写入 transcript/session。每次 request 重读使同一 turn 中 mutation 后的 provider continuation 立即看到新索引，不维护进程级缓存。

Catalog index token 与 user memory token 一起计入现有 Memory segment；`read_memory` 的普通 tool result 仍计入 Tools，避免新增 context usage 分类。

### 4. 使用四个职责清晰但统一类型参数的工具

默认 registry 新增：

- `read_memory`：读取 user memory 列表，或读取一个可访问 agent catalog 的 items。
- `add_memory`：通过 `type` 写 user memory，或向 agent catalog 添加 item；catalog 不存在时使用名称、描述和 scope 创建。
- `update_memory`：通过 `type` 和 `target` 更新 user item、agent catalog 元数据或 agent item。
- `remove_memory`：通过 `type` 和 `target` 删除 user item、agent item 或整个 agent catalog。

Agent item 读取结果包含 item id，以便后续精确 mutation。Catalog 名称用于模型友好的发现，内部 mutation 解析后使用稳定 id。所有 parser 拒绝空内容、空描述、未知字段组合、不存在目标和越权 scope。

`add_memory` 不单独提供 create-catalog action：新 catalog 只有在添加首个 item 时创建，因此不会产生空 catalog。删除最后一个 item 时自动删除 catalog。相比拆成大量 catalog/item CRUD 工具，这一组合减少 provider tool schema；相比单个带 action 的万能工具，四个工具能让读写风险和意图保持清晰。

### 5. Memory mutation 纳入现有非 bash 审批

风险分类将 `add_memory`、`update_memory`、`remove_memory` 标记为需要审批，`read_memory` 保持只读。审批继续使用 `ToolApprovalContext` 的 allow once、allow tool for session、allow all、deny 和反馈语义。

审批 preview 需要把原始参数投影为可读摘要，至少显示：

- user 或 agent 类型；
- agent catalog 和 target；
- 新增/更新内容摘要或删除对象；
- global mutation 的明确全局标记。

用户允许后才调用 store；拒绝时沿用现有失败 tool result。Plan mode 继续由风险分类阻止所有 mutation，不为 memory 工具增加特殊旁路。

### 6. `/memory` 使用分层 command session 而非新增命令

`/memory` 第一层区分 User 与 Agent。User 分支保留当前列表和 enabled toggle。Agent 分支依次展示 scope/catalog 列表和 item 列表，并支持编辑 catalog 名称/描述及 item 内容。Command session 保存当前 section、scope、catalog id、selected index、编辑 target 和 composer draft；所有存储访问通过扩展后的 `CommandHost.memory` facade。

编辑区继续使用真实 footer cursor row/column，不把块字符或 ANSI cursor marker写入文本。Esc 逐层返回或取消草稿，保存失败保留草稿和当前层级。删除最后一个 item 后返回 catalog 列表，因为其 catalog 已自动删除。

### 7. User memory mutation 复用现有 store

Memory tool handler 的 `type: user` 直接调用现有 user memory store，不复制 schema，也不把 user item 转存为 agent catalog。`add_memory` 创建默认 enabled 条目；`update_memory` 保留现有 enabled 值；启停仍由 `/memory` 管理。下一次 provider request 按现有逻辑重读文件，因此 agent 获批写入后立即生效。

## Risks / Trade-offs

- **[普通 tool result 会让已读取 catalog 在 session 中持续占用上下文]** → 这是明确选择；工具描述提示不要重复读取已加载 catalog，后续有实际 token 压力再设计 transient result。
- **[Agent 可能保存错误、过时或恶意来源内容]** → catalog prompt 标记为低优先级持久背景，mutation 必须审批，并提供 `/memory` 人工审阅、编辑和删除。
- **[索引与 catalog 无法跨文件事务原子提交]** → 以索引为 source of truth，采用确定写入顺序、创建失败清理和 orphan 忽略策略，避免半完成文件被正常读取。
- **[绝对 project root 在项目移动后失配]** → 第一版与当前 cwd/project 体系保持一致；未来如确有迁移需求，再引入稳定 project id 或迁移工具。
- **[Project 覆盖 global 可能隐藏全局同名 catalog]** → 使用确定覆盖规则；`/memory` 明确显示 scope，工具可显式指定 global 访问被覆盖项。
- **[允许 agent 修改 user memory 会影响每轮 system prompt]** → mutation 必须审批，preview 清楚标记 user memory，用户可立即在 `/memory` 中启停、修正或删除。
- **[Catalog 索引变化降低 provider prompt cache 命中]** → 只在 catalog 元数据变化时改变索引；item 内容增删不改变名称/描述时无需改变 prompt 文本。

## Migration Plan

1. 新增 agent memory 目录时按需创建，不扫描或迁移现有 user memory。
2. 保持 `~/.echo/memories.json` version 1 和现有读取行为不变。
3. 发布后首次 agent mutation 创建 `~/.echo/agent-memory/`；没有 agent catalog 时不注入空 section。
4. 若新功能需要回滚，可停止注册 memory 工具和 catalog prompt；agent memory 文件保留在磁盘，不影响旧版本读取 user memory。

## Open Questions

- 暂无阻塞实现的问题。Project root 移动和 orphan catalog 清理由后续真实需求决定，不纳入第一版。

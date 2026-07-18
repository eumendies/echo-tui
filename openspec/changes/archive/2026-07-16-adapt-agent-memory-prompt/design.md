## Context

当前 agent loop 在每次 provider request 前调用 `listEffectiveAgentMemoryCatalogs`，只读取 `catalogs.json` 并把有效 catalog 的名称和描述交给 `system-prompt.ts`。Item 文件仅在执行 `read_memory` 时读取，因此即使全部 agent memory 只有几条短内容，模型也需要额外工具往返；另一方面，现有固定折叠策略避免了长期积累的 memory 无限制扩张 system prompt。

本变更需要在不改变磁盘格式、scope 覆盖规则、memory 工具协议和 transcript 生命周期的前提下增加自适应投影。现有 `resolveContextWindow` 提供模型窗口，`estimateTextTokens` 提供统一的轻量 token 估算，二者可直接作为确定性预算依据。

## Goals / Non-Goals

**Goals:**

- 小型 agent memory 无需 `read_memory` 即可作为每轮持久背景直接使用。
- memory 增长后自动恢复当前 catalog 索引模式，限制固定 system prompt 成本。
- 展开和折叠遵守 enabled、global/project scope 与 project 覆盖 global 的既有规则。
- 每轮选择确定、可测试，并让 `/context` 使用实际注入文本计算 Memory 分类。
- 读取异常时保持完整、保守的 catalog 发现能力，不注入不完整的 item 集合。

**Non-Goals:**

- 不实现逐 catalog 混合展开、语义检索、相关性排序或 item 自动摘要。
- 不根据当前对话剩余空间动态切换模式，也不修改自动 compaction 阈值和算法。
- 不移除 `read_memory`，不改变 mutation 所需 item id 或公开工具 schema。
- 不增加用户配置项，不迁移或升级 agent memory 文件版本。

## Decisions

### 1. 使用“窗口比例与绝对上限同时满足”的固定预算

展开预算为 `min(floor(contextWindow * 0.02), 8_000)` tokens。系统先生成完整展开区块，再用现有 `estimateTextTokens` 对实际文本估算；仅当展开区块 token 数不超过预算时展开。

比例预算让小窗口模型保持保守，绝对上限避免百万 token 窗口长期携带数万 token 的静态 memory。选择基于完整渲染区块而非 item 原文长度，可以把标题、catalog 描述和列表格式等真实 prompt 开销纳入判断。替代方案只看 item 字符数会低估实际成本；只用百分比会在超大窗口下放大固定开销。

模式不依赖当前对话占用。这样只要模型窗口和 memory 内容不变，同一会话中的选择就保持稳定，避免对话增长导致 prompt 在两种形态间抖动，也无需让 memory 选择介入现有 compaction 编排。

### 2. 全部有效 catalog 采用单一模式

一次请求只能是 `expanded` 或 `catalog`：前者展开全部有效 catalog 的 enabled items，后者只显示全部有效 catalog 的名称和描述。展开区块按 catalog 分组，包含名称、描述和 item 分点；两种格式都省略 scope、enabled、id、数量和时间戳，并保留低优先级、可能过时的安全说明。

全局二态比逐 catalog 决策更容易让模型理解“哪些内容已加载”，也与总量预算的产品语义一致。逐 catalog 混合虽然能多塞入部分内容，但需要额外标记已展开状态、定义选择顺序，并可能诱发模型重复读取或遗漏折叠 catalog，因此本次不采用。

### 3. 存储层提供有效 catalog 与 items 的快照式聚合读取

在 `agent-memory-store.ts` 增加只读聚合查询：先按现有 enabled、scope 和同名覆盖规则得到有效 catalog 快照，再读取每个 catalog 文件并只保留 enabled items。成功结果以 catalog 和 memories 成组返回，不改变持久化类型或文件结构。

若索引无效，沿用当前行为，不注入 agent memory。若索引有效但任一有效 catalog 文件缺失、损坏或格式无效，聚合查询整体失败；memory prompt resolver 随后使用有效 catalog 索引构造折叠 prompt。该回退允许模型继续发现 catalog，同时禁止把“成功读取的部分 items”伪装成完整展开结果。异常路径可以再次读取索引，正常路径保持一次索引快照和每个有效 catalog 一次文件读取。

### 4. Memory prompt 模块集中解析并返回可复用结果

`memory-prompt.ts` 提供 user memory 格式化、agent memory 展开/折叠纯函数，以及负责每轮读取和失败回退的 `resolveMemoryPrompt`。Resolver 返回 system prompt sections、合计 memory tokens，以及包含 `mode`、`estimatedTokens` 和非敏感计数的 agent memory 摘要。`system-prompt.ts` 只负责按顺序拼装已生成的 sections；agent loop 在每次 provider continuation 前调用一次 resolver，`buildProviderRecords`、context usage 和 debug 复用同一结果，避免重复格式化或统计口径不一致。

Debug 事件只增加模式、catalog 数、enabled item 数和估算 token，不记录 item 内容、catalog 描述或路径。Memory tool 的描述改为说明 system prompt 可能包含 catalog 索引或已展开内容；已展开内容无需为使用事实而重复读取，但精确 mutation 仍可读取 id。

### 5. 展开内容仍属于 transient system memory

展开区块与现有 catalog 索引一样，只存在于 provider request，不写入 transcript/session。它的估算 token 与 user memory 一起归入 `/context` 的 Memory segment。`read_memory` 的调用和结果仍按普通 tool history 归入 Tools；系统不尝试从历史中去重已展开内容。

这保留了现有 transcript、session、compaction 和 provider adapter 边界。替代方案把展开内容生成 tool result 会引入额外 continuation 和持久化语义，违背减少工具往返的目标。

## Risks / Trade-offs

- **[展开模式使 item 内容进入 system prompt，item 修改会降低 provider prompt cache 命中率]** → 仅在完整展开成本较小时采用，并在超过预算后恢复只受 catalog 元数据影响的折叠 prompt。
- **[每轮展开判定需要读取所有有效 catalog 文件]** → 使用同步本地小文件和单次快照读取；超过预算后仍需读取才能判断总量，未来若出现实际性能问题再为索引增加安全的尺寸摘要。
- **[轻量 token 估算与 provider tokenizer 存在误差]** → 使用保守的 2% 与 8,000 双限制，并与项目现有 context usage 估算保持同一口径。
- **[从折叠切换到展开后，历史 `read_memory` tool result 可能与 system prompt 重复]** → 模式只随模型窗口或 memory 变化而切换，不主动重写历史；由后续正常 compaction 处理历史重复。
- **[聚合读取失败会隐藏本可成功展开的其他 catalog items]** → 整体回退 catalog 索引，优先保证“全部展开”的完整性和可解释性，具体损坏 catalog 仍可通过 `read_memory` 暴露错误。

## Migration Plan

1. 先增加聚合读取和纯 prompt 投影，不改变现有 version 1 文件格式。
2. 通过独立 memory prompt resolver 每轮生成自适应投影，并让 system prompt、agent loop、context usage 和 debug 摘要消费同一结果。
3. 更新工具描述和自动化测试，验证小型展开、大型折叠、scope 覆盖、disabled 过滤及读取失败回退。
4. 回滚时可恢复固定 catalog 格式化调用；磁盘数据与工具协议无需迁移或清理。

## Open Questions

暂无阻塞问题。2% 与 8,000 tokens 作为首版内置常量，后续仅在真实使用数据表明需要时再考虑配置化。

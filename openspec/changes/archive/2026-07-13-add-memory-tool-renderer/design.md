## Context

工具 transcript 当前先把相邻且 `toolCallId` 匹配的 call/result 聚合为 pair，再由 `tool-message-renderer.ts` 选择 pair-aware 或单 record renderer。`use_skill` 已采用“成功只展示调用摘要、失败追加短诊断”的模式，而四个 memory tools 尚未注册专属 renderer，会由通用路径直接显示 arguments 和 result JSON。

Memory tool 的现有 payload 已包含生成语义摘要所需的 type、target、catalog 和 content；`read_memory` 成功结果包含 user memories 或 agent catalog/items。渲染层只需消费这些既有事实，不能修改 tool handler、transcript 或 provider continuation。

## Goals / Non-Goals

**Goals:**

- 为四个 memory tools 提供统一、简洁且不暴露 raw JSON 的 terminal 投影。
- 让 pending preview、孤立 call 和相邻 call/result pair 使用一致的调用文案。
- 成功 mutation 只显示调用摘要，失败 mutation 显示调用摘要和 bounded 诊断。
- 将成功 `read_memory` 的 user/agent contents 都投影为不带启停状态和内部元数据的分点列表。
- 对 malformed payload、窄终端和长内容安全降级，不中断渲染。

**Non-Goals:**

- 不改变 memory tools 的参数 schema、执行结果 JSON 或审批策略。
- 不改变 user/agent memory 的存储、启停、scope 或读取语义。
- 不从之前的 transcript 记录反向查询 item id 对应内容。
- 不把可见摘要写回 transcript、session、compaction 或 provider context。

## Decisions

### 1. 新增独立 memory renderer 并接入 pair-aware 分派

新增 `src/render/tool-message-renderers/memory.ts`，集中识别四个 memory tool names、解析 call/result payload 并生成可见行。`tool-message-renderer.ts` 在 generic fallback 前注册 memory pair renderer 和单 record renderer；footer pending preview 继续通过现有 `renderToolCallPreviewLines` 自动复用 call 投影。

选择独立模块而不是在主 dispatcher 中展开分支，是为了把四种 payload shape、文案和列表预算保持在一个责任边界内，并沿用 `use_skill` 的已验证模式。

### 2. 使用一致的记忆动作词汇

Call 摘要使用进行时动作词，与现有 `Using skill` 风格一致：

- `add_memory`: `Remembering`
- `read_memory`: `Recalling`
- `update_memory`: `Revising`
- `remove_memory`: `Forgetting`

各目标采用以下语义摘要：

- user add：`Remembering · <content-preview>`
- agent add：`Remembering in <catalog> · <content-preview>`
- user read：`Recalling user memories`
- agent read：`Recalling · <catalog>`
- user item update：`Revising user memory · <content-preview>`
- agent item update：`Revising in <catalog> · <content-preview>`
- agent catalog update：`Revising catalog · <old-name>`，存在新名称时追加 `→ <new-name>`，存在 description 时追加其预览
- user remove：`Forgetting user memory`
- agent item remove：`Forgetting from <catalog>`
- agent catalog remove：`Forgetting catalog · <catalog>`

Item id、时间戳、enabled、scope 和 JSON 字段名不进入正常调用摘要。Remove payload 没有被删内容，因此 renderer 不尝试根据 id 猜测文本。

### 3. Mutation 成功隐藏 result，读取成功展示列表

相邻匹配 pair 的展示规则如下：

```text
add/update/remove success  → call summary
add/update/remove failure  → call summary + bounded failure text
read success               → call summary + memory bullet list
read failure               → call summary + bounded failure text
```

`read_memory` user result 与 agent result 都只提取每个 memory 的非空 `content`，使用 `•` 分点展示。User result 即使包含 enabled 字段，也不显示 `on/off` 或使用不同 marker；agent result 不显示 catalog description、item id、时间戳或 enabled。空列表显示 `No memories found.`。

孤立 call 使用同一调用摘要。孤立成功 mutation result 使用不含 payload JSON 的安全完成摘要，孤立 read result仍可投影列表；孤立失败 result 显示 bounded failure text，避免有效历史记录出现空白块。

### 4. Memory renderer 不把 malformed JSON 交回 raw generic 展示

Call arguments 无法解析时，根据 tool name显示 `Remembering memory`、`Recalling memories`、`Revising memory` 或 `Forgetting memory`。成功 read result 无法解析时显示 `Memory result unavailable.`；成功 mutation result 使用安全完成摘要。失败 result 继续显示现有文本诊断并受通用 tool result 行数预算约束。

与 `read_files` 的 generic fallback 不同，memory renderer 的核心目标就是隐藏内部 JSON，因此 malformed 数据也不能回退到会展开 raw arguments/result 的通用 renderer。

### 5. 内容预览和列表共享现有布局约束

Memory content preview 将 CR/LF 和连续空白规范化为空格，并限制可见长度，避免单条持久记忆占满 transcript。Read 列表按现有 safe render width 换行，并使用 `TOOL_RESULT_MAX_DISPLAY_LINES` 约束总物理行；超出时显示既有 `[tool output truncated for display]` 标记。调用状态颜色继续由 `resolveToolCallPrefixStyle` 根据 pending/success/failure 决定。

## Risks / Trade-offs

- [User read 不显示 enabled 状态会隐藏管理信息] → 这是明确的展示取舍；`/memory` 仍提供完整启停管理，tool transcript 专注于回想内容。
- [Remove item 无法显示具体被忘记的内容] → 当前 payload 只有 item id；使用目标和 catalog 摘要，不跨记录猜测或修改 tool schema。
- [长 memory item 换行后挤占列表预算] → 统一按物理行预算截断，并保留原始 tool result 给 provider。
- [Malformed success payload 丢失细节] → 使用安全摘要而不是 raw JSON；原始事实仍保存在 transcript 中，可供 provider continuation 使用。

## Migration Plan

无需数据迁移。实现只改变可见渲染投影；回滚时删除 memory renderer 分派即可恢复通用展示，原始 transcript 和 tool results 不受影响。

## Open Questions

无。

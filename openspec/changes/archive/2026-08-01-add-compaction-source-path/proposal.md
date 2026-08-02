## Why

上下文压缩会把较早的历史压成结构化摘要，摘要必然丢失精确数字、完整文件路径和长工具输出等细节。但压缩本身不删除记录——transcript journal 是 append-only，被压缩区间的原始记录仍完整保留在 JSONL 文件中，目前模型侧却拿不到这个入口，压缩一旦损失关键信息便无法主动取回。对话引用功能已经建立了「`source_file` 路径 + `read_files` 分页回读」的成熟模式，压缩复用该模式可以让模型在需要精确细节时低成本取回原始上下文。

## What Changes

- 在 `AgentSessionInput` 中新增可选 `sessionJournalPath`，指向当前 session 的 transcript journal 文件绝对路径；headless `--once` 无 session 时为 `undefined`，不注入。
- app 层组装 agent session 时，通过 transcript store 从当前 cwd 与 session id 实时计算并传入该路径，不修改 `CompactionState` 与 journal schema。
- 压缩后的 provider 请求投影：摘要消息中附加 `source_file` 路径，并提示模型仅在需要精确细节时使用现有 `read_files` 分页读取该文件（与 conversation-reference 的提示语义一致，并说明 truncate 可能使早期记录失效）。
- 自动压缩与 `/compact` 手动压缩两条路径共享同一提示与注入行为。

## Capabilities

### New Capabilities
<!-- 无新增能力：本变更只调整既有 context-compression 的外部行为。 -->

### Modified Capabilities
- `context-compression`: 压缩后的请求投影需要携带源 journal 路径与按需回读提示。

## Impact

- `src/types/agent.ts`: `AgentSessionInput` 增加可选 `sessionJournalPath` 字段及中文注释。
- `src/app/state/app-context.ts`: `getAgentSession()` 组装时计算当前 session journal 路径。
- `src/app/state/transcript-context.ts`: 暴露当前 session 源路径的读取入口（如 `getCurrentSessionJournalPath()`）。
- `src/agent/agent-loop-runtime.ts`: `buildProviderRecords` 注入 `source_file` 与回读提示。
- `src/agent/context/context-compaction.ts`: `createCompactionNoticeRecord` 支持可选路径参数。
- 测试：`context-compaction` 与 `agent-loop-runtime` 相关单测更新；无路径（headless）时不注入的用例。
- 不改变：journal 文件格式、`CompactionState` 结构、压缩边界与摘要生成逻辑、`/resume` 恢复流程。

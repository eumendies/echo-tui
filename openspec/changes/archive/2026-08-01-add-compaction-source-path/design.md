## Context

上下文压缩（context-compression）将压缩边界之前的 transcript 记录压成结构化摘要，并将摘要作为一条 `user` 消息注入 provider 请求（`agent-loop-runtime.ts` 的 `buildProviderRecords`）。压缩可见提示记录（`createCompactionNoticeRecord`）只写「已将较早的 N 条历史压缩为摘要」，不携带任何来源信息。

关键事实：transcript journal 是 append-only，压缩只写入 `set_compaction` 状态并追加 `compaction_notice` 记录，**被压缩区间的原始记录完整保留在 JSONL 文件中**；只有 `/undo` 的 `truncate_records` 会真正删除早期记录。因此「给模型暴露 journal 路径 + 按需 read_files 回读」是可行且低成本的。

项目中已存在相同模式的先例：conversation-reference 在 summary 投影中输出 `source_file: <path>` 并提示「If exact details are needed, use the existing read_files tool to read source_file with pagination. source_file is an append-only JSONL journal; later truncate or set operations can supersede earlier entries.」本变更复用该语义，保证产品行为一致。

## Goals / Non-Goals

**Goals:**
- 压缩发生后，模型在需要精确细节时能通过现有 `read_files` 工具回读当前 session 的原始 journal。
- 压缩摘要注入文本能携带源 journal 路径。
- 路径是运行时事实，不从 `CompactionState` 或 journal schema 读取，避免持久化兼容问题。
- 自动压缩与 `/compact` 手动压缩共享同一提示与注入行为；headless `--once` 无 session 文件时安全跳过。

**Non-Goals:**
- 不把被压缩的原始记录重新塞回 provider 请求（路径只是按需回读入口）。
- 不修改 `CompactionState`、journal 操作类型或文件格式。
- 不改变压缩边界计算、摘要生成逻辑、`/resume` 恢复流程。
- 不注册任何新的会话读取工具（沿用既有 `read_files`）。

## Decisions

**决策 1：路径通过 `AgentSessionInput.sessionJournalPath` 运行时传入，而不是持久化进 `CompactionState`。**
理由：journal 路径由 cwd + sessionId 确定性派生，属于运行时事实；若持久化到 `CompactionState` 会改变 journal schema 与 `isCompactionState` 校验，历史 session 需要迁移兼容。运行时传入保持 schema 稳定，`/resume` 重放后路径仍可由 app 层重新计算。
备选：把 `sessionJournalPath` 加入 `CompactionState` —— 被否，引入 schema 变更与迁移负担，收益只是路径早于运行时可用，而 app 层本来就有 store。

**决策 2：provider-facing 提示与 conversation-reference 保持一致措辞。**
`buildProviderRecords` 在摘要消息后附加：
```
The full original history is preserved in source_file: <path>
If exact details are needed, use the existing read_files tool to read source_file with pagination.
source_file is an append-only JSONL journal; later truncate or set operations can supersede earlier entries.
```
理由：模型已熟悉该格式（引用功能同款），提示语义（append-only、truncate 可失效）对压缩场景同样成立。

**决策 3：可见 notice 记录不携带路径。**
`compaction_notice` 是 `NON_PROVIDER_ROLES` 之一，只对用户可见、不进入 provider 请求；路径是模型侧的回读入口，暴露给用户的哈希式 store 路径属于噪音。因此 notice 保持「已将较早的 N 条历史压缩为摘要」既有文本，路径只出现在 provider-facing 摘要消息中。

**决策 4：路径解析收敛在 app 层。**
`app-context.getAgentSession()` 通过 `transcriptContext.getCurrentSessionJournalPath()`（store.getSessionFilePath(cwd, currentSessionId)）计算路径；`one-shot` 无 transcript store，不传该字段。agent runtime 保持纯输入消费，不知道 store 细节。

## Risks / Trade-offs

- [路径暴露增加模型可读文件范围] → 模型本就拥有 `read_files`（受审批控制），路径是本地用户自己的文件，与 conversation-reference 已有暴露面一致，无新增权限。
- [模型过度回读浪费 token] → 提示语限定「仅在需要精确细节时」，回读是按需的，不增加稳态上下文 token。
- [`/undo` truncate 后早期记录失效，模型回读到残缺文件] → 提示语明确「later truncate or set operations can supersede earlier entries」，与引用功能行为一致。

## Context

当前 transcript 按 cwd 分区保存为独立 JSONL journal，`TranscriptContext` 持有当前 records、journal reference、compaction、todo state 和 change history，`ModelContext` 通过同 session id 的 sidecar 保存当前 model/effort。`/resume` 可以切换到历史 session，但系统没有“保留当前 session，同时从同一上下文创建独立后续”的入口。

`/fork` 跨越 command handler、CommandHost、AppContext、transcript persistence 和 model settings，因此需要由现有状态边界协调，而不能让 handler 直接操作 store。实现继续遵守 append-only journal、当前终端 command surface、无第三方 TUI 依赖和不切换 alternate screen 等约束。

## Goals / Non-Goals

**Goals:**

- 从当前非空 session 的最新稳定状态创建可独立恢复和追加的新 session。
- 分叉后保持当前可见 transcript 和会话语义不变，只切换 journal/settings 归属。
- 复制 records、compaction、todo state、change history 和当前 model/effort。
- 保证新 journal 创建失败时仍停留在源 session，不产生半切换状态。
- 通过现有 CommandHost 和 info surface 完成命令路由与用户反馈。

**Non-Goals:**

- 不支持从任意历史消息或指定 record 边界分叉。
- 不创建 Git branch、worktree、文件副本或其他工作目录快照。
- 不提供会话分叉树、父子 lineage 展示、命名或删除能力。
- 不为 `--once` 增加 slash command 解释。
- 不优化超长 transcript 分叉时的磁盘复制量。

## Decisions

### 1. 新 session 使用自包含快照

`TranscriptContext` 将当前 records 与状态投影成一个用于创建 session 的 `batch`，其中包含 `append_records`、`set_change_history`、`set_compaction` 和 `set_todo_state`。该 batch 通过现有 `TranscriptStore.createSession()` 与 `session_start` 一起原子写入新 journal。

这样新 session 的 replay 不依赖源 journal；之后源 session 的追加、truncate、损坏或人工删除都不会改变分叉结果。替代方案是让子 journal 引用源 session 与 sequence 边界，只保存后续增量，但这会引入递归 replay、循环检测、父文件生命周期和列表性能问题，超出当前需求。

分叉不会增加新的 journal operation 或 schema。新 journal 的首个 batch 是创建时的完整基线，不违反既有 session 内普通追加只保存增量变化的约束。

### 2. TranscriptContext 只在创建成功后切换 journal reference

分叉入口只接受已有 records 且已持有当前 journal reference 的稳定 session。调用时先确保既有 pending session 状态已经持久化，再以当前内存状态创建新 journal。只有 `createSession()` 成功返回新 reference 后，才更新 `currentSession` 与 `currentSessionId`；records、compaction、todo state 和 change history 的内存对象保持当前语义。

如果创建失败，源 session reference 和当前 transcript 均保持有效，handler 获得结构化失败结果。这样无需通过 `/resume` 回滚半完成切换。

### 3. AppContext 协调 model sidecar 与 transient 状态

新 journal id 生效后，`AppContext` 要求 `ModelContext` 将当前 model profile 与显式 effort override 重新绑定到新 session，并尽力写入对应 settings sidecar。不能只调用现有“仅 dirty 时保存”路径，因为从已恢复 session 分叉时缓存可能处于 clean 状态。

Sidecar 写入仍遵循既有 best-effort 语义：写入失败不回滚已经成功创建的 journal或当前内存模型选择，并保留后续正常提交时的重试机会。源 session 的 sidecar 不改写。

最近一次 provider context usage 在 session id 与 transient runtime context 改变后不再视为新分支的真实请求结果，因此分叉成功后清空；interaction mode、pending composer/reference 等其他进程内交互状态不因分叉重置。

### 4. `/fork` 通过 transcript CommandHost facade 执行业务动作

新增 handler 只匹配无参数 `/fork` 和尾随空白，通过 `CommandHost.transcript` 的结构化 fork 能力执行操作，不直接访问 AppContext 或 TranscriptStore，也不要求 CommandRuntime 增加业务 effect。

命令无破坏性确认步骤：提交后立即执行并打开现有 info surface。成功 surface 显示新 session id、说明后续将写入新会话，并明确工作目录和文件系统没有被分叉；空会话和存储失败使用对应提示。surface 关闭后回到普通 composer。

成功和失败反馈均不追加 transcript record。否则命令自身会成为分叉后的第一条持久化内容，并可能进入 provider context；复用 info surface 也避免新增 renderer 类型。

### 5. 第一版不持久化 lineage

新 session 与普通 session 使用相同 header 和 metadata；源、新 session id 只在本次成功结果中同时可用。第一版 `/resume` 没有树形展示或 lineage 查询需求，增加 `parentSessionId`、fork sequence 等字段会扩大 schema 和 replay 契约而没有当前消费方。

如果未来需要会话树，应单独设计可查询的 lineage metadata 和旧 session 兼容方式，而不是让运行时依赖父 journal 才能恢复子 session。

## Risks / Trade-offs

- [Risk] 自包含快照会按当前 transcript 和 change history 大小产生 O(n) 写入与额外磁盘占用 → Mitigation：第一版换取独立 replay 和简单故障边界；沿用工具结果 offloading，后续有实际性能数据后再设计增量 lineage。
- [Risk] 分叉复制 change history，但源、子 session 共享同一工作目录，任一分支后续修改文件都会使另一分支的 undo snapshot 相对陈旧 → Mitigation：保持与 `/resume` 恢复 change history 一致的语义，成功提示和文档明确文件系统不会分叉，`/undo` 继续展示覆盖手动修改警告。
- [Risk] Journal 创建成功但 settings sidecar 写入失败时，重启恢复会回退全局默认模型 → Mitigation：保留当前内存选择并将 settings 标记为待同步，在下一次正常提交重试；不以可选 sidecar 失败破坏已成功的会话分叉。
- [Risk] 分叉与正在进行的 assistant/tool 状态交错会复制不完整 turn → Mitigation：沿用 composer response lock；命令只在普通稳定提交路径执行，排队的 `/fork` 也要等当前 turn 结束后再路由。

## Migration Plan

1. 增加内部 fork 结果类型、TranscriptContext/AppContext/ModelContext 协调方法和 CommandHost transcript facade。
2. 注册 `/fork` handler，并更新帮助、slash descriptors 和文档。
3. 通过单元测试验证快照内容、分支独立性、sidecar 继承和失败原子性。
4. 该变更不修改既有 journal/schema；回滚时移除命令和内部入口即可，已创建的分叉 journal 仍是普通有效 session，可继续通过 `/resume` 使用。

## Open Questions

无。第一版固定为“从当前最新稳定状态分叉”，并复制 change history 但不复制文件系统。

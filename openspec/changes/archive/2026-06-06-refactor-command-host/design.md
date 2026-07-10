## Context

当前 command 链路是 `CommandHandler -> CommandEffect[] -> CommandRuntime effect interpreter -> main.ts callback -> AppContext/renderer/agent`。这让 handler 足够纯，但新增一个业务动作需要同时扩展 effect 类型、effect creator、runtime switch、runtime dependencies 和 `main.ts` 回调。

`/compact` 已经触发了这个问题：确认 surface 属于 command 交互，但手动压缩需要 responding 锁、working spinner、agent 初始化、`runCompaction(force)`、压缩状态落盘、提示块追加和错误处理。继续使用业务 effect 会让 `CommandRuntime` 越来越像 app action interpreter，也会让 `main.ts` 堆积各类 command flow。

本次按 `command-host-redesign.md` 的当前方案实现，不引入更复杂的双层 host、action runtime 或独立 flow 文件。目标是用一个受控 `CommandHost` facade 让 handler 直接调用 app 能力，同时保留 command runtime 对 active session 和事件分发的所有权。

## Goals / Non-Goals

**Goals:**

- `CommandRuntime` 只负责 slash 路由、active command session、surface 快照和输入事件分发，不再解释业务 `CommandEffect`。
- `CommandHandler.start` 与 `CommandHandler.handleEvent` 接收 `CommandHost`，由 handler 直接调用 host 执行 session、composer、transcript、model、compaction 等命令行为。
- `main.ts` 保持装配根职责，不继续为具体 command 增加 `runXxx` 业务函数；现有手动压缩编排迁移到 command host 实现。
- 现有 `/help`、`/model`、`/clear`、`/compact`、`/resume` 用户可见行为保持不变。
- 删除当前不再需要的 command effect 类型和 creator，减少新增 command 的改动面。

**Non-Goals:**

- 不重写普通 assistant turn、agent loop、transcript persistence 或 render pipeline。
- 不引入第三方 TUI / command framework。
- 不为每个 command 预先拆独立 `flow.ts`；只有后续出现明显复用或可读性问题时再抽。
- 不改变 `/compact` 的强制压缩语义、错误处理语义或可见提示文案。

## Decisions

### 1. 使用 `CommandHost` 替代业务 `CommandEffect`

`CommandHost` 是 app 层暴露给 command handler 的受控 facade。handler 不能拿裸 `AppContext`，只能通过 host 暴露的领域方法修改状态或触发业务能力。

候选方案：

- 继续扩 `CommandEffect`：保持 handler 纯，但新增业务动作仍需改多处类型和 runtime switch。
- 新增 `CommandActionRuntime`：只是把 switch 从 `CommandRuntime` 挪到另一处，没有切断 main callback 膨胀。
- `CommandFeatureDeps + flow`：能把流程移出 main，但全局 deps 会随着命令能力增长持续扩大。
- `CommandHost`：让 handler 直接调用受控 app 能力，新增命令通常只改 handler 和注册列表。

选择 `CommandHost`，因为它最直接地减少 runtime 和 `main.ts` 的业务分支，同时仍能通过 facade 控制 handler 的访问范围。

### 2. `CommandRuntime` 保留 session 所有权

`CommandRuntime` 继续持有 `activeCommandSession`，并提供 `getSurface()` / `hasActiveSession()` / `getSnapshot()`。host 的 `session.open/update/close/getActive` 方法由 runtime 在创建 host 时绑定到同一个闭包状态。

这样 handler 可以命令式打开、更新和关闭 command session，但 session 状态仍集中在 runtime 中，renderer 仍通过 `commandRuntime.getSurface()` 取得当前 command surface。

### 3. 先实现单一 host，不拆双层 host

虽然可以把 app host 与 runtime session host 拆成两层，但本次按当前方案实现，避免过早抽象。`createCommandRuntime` 接收创建好的 `CommandHost` 或创建 host 所需依赖，并在 runtime 内部把 session controller 与 app 能力组合起来即可。

实现时应保持类型边界清晰：`CommandHost` 是对 handler 可见的协议，`createCommandHost` 是 app 装配函数，`AppContext` 仍不直接暴露给 handler。

### 4. `/compact` flow 先放入 command host 或 handler 私有方法

为贴合当前方案，不预先创建独立 `compact-flow.ts`。手动压缩流程从 `main.ts` 移出，可放入 `src/app/command-host.ts` 的 compaction 能力实现，或作为 `CompactCommandHandler` 私有方法通过 host 原语执行。

无论具体放置位置，必须保持现有流程顺序：检查 responding、进入手动压缩态、启动 working spinner、重读配置并初始化 agent、执行 `runCompaction(force: true)`、成功/无需压缩/失败反馈、停止 spinner 并释放 responding 锁。

### 5. 迁移所有现有 handler 到 host 协议

所有 handler 使用同一个调用协议：

- `/help`：reset composer，open info session；Esc close/reset。
- `/clear`：open confirm session；Enter close/reset/clear transcript；Esc close/reset。
- `/compact`：open confirm session；Enter close/reset/触发手动压缩；Esc close/reset。
- `/resume`：通过 host 读取 session metadata，更新 select surface；Enter load session；Esc close/reset。
- `/model`：通过 host 读取模型信息和保存选择，更新 select/error surface；Enter 持久化或显示错误；Esc close/reset。

迁移完成后，`command-effects.ts` 应删除或至少不再被运行时代码依赖。

## Risks / Trade-offs

- **[Risk] handler 不再是纯 effect producer，测试需要 fake host。** → 使用轻量 fake `CommandHost` 记录调用与状态，断言 handler 对 host 的命令式调用结果；对 runtime 继续测 session 分发和 surface 快照。
- **[Risk] `CommandHost` 变成 god object。** → 只暴露 command 已真实需要的能力，并按 session/composer/transcript/model/compaction/ui 分组；不要把完整 `AppContext` 或 renderer 透传给 handler。
- **[Risk] 异步 `/compact` 可能破坏响应锁或 spinner 清理。** → 保留现有 `try/catch/finally` 等价语义，覆盖成功、无需压缩、失败和并发阻止测试。
- **[Risk] 一次性删除 effect 影响多个测试。** → 按 handler 逐个迁移，先让行为测试通过，再删除旧 effect 类型和 creator。
- **[Trade-off] 命令式 handler 可读性更直接，但纯函数断言减少。** → 接受该取舍，因为当前主要痛点是业务动作改动面过大；host fake 仍能保持单元测试稳定。

## Migration Plan

1. 新增 `CommandHost` 类型与 `src/app/command-host.ts`，将现有 `main.ts` command dependencies 和手动压缩编排搬入 host。
2. 修改 `CommandHandler` 协议和 `CommandRuntime`，让 runtime 调用 `handler.start(text, host)` / `handler.handleEvent(session, event, host)`。
3. 迁移 `/compact`，删除 `REQUEST_MANUAL_COMPACTION` 相关类型、creator、runtime 分支和 main callback。
4. 迁移 `/help`、`/clear`、`/resume`、`/model`，让它们统一使用 host。
5. 删除不再使用的 `command-effects.ts` 与旧 `CommandRuntimeDependencies` 业务字段。
6. 更新并运行 typecheck、test 和 JavaScript 语法检查。

## Open Questions

- 暂无。后续如果某个 command flow 明显变长或需要跨命令复用，再单独评估是否抽 service 或独立 flow 模块。

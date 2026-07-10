## 1. 抽出可复用压缩核心

- [x] 1.1 在 `src/agent/context-compaction.ts` 新增 `RunCompactionResult` 类型（`didCompact` / `reason: 'compacted' | 'below_threshold' | 'no_boundary'` / `compaction?`）
- [x] 1.2 实现 `runCompaction(options)` 异步纯函数：估算/阈值（非 force）→ 边界吸附 → 摘要生成 → 返回结果；不修改外部状态、不触发回调
- [x] 1.3 支持 `force` 入参：跳过阈值判定但仍执行边界吸附；无有效边界返回 `no_boundary`

## 2. runtime 改为复用压缩核心

- [x] 2.1 把 `agent-loop-runtime.ts` 的 `maybeCompact` 改为调用 `runCompaction({force:false})`，按返回结果回填 `compactionState`/`usageAnchor` 并触发 `onCompacted`
- [x] 2.2 确认自动触发行为不变（阈值、边界、滚动摘要语义一致）

## 3. 异步压缩命令委派通道

- [x] 3.1 在 `command-effects.ts` 新增 effect type `REQUEST_MANUAL_COMPACTION` 与对应 `createRequestManualCompactionEffect()`
- [x] 3.2 在 `command-runtime.ts` 的 `applyEffects` 处理该 effect，调用 `dependencies.requestManualCompaction()`
- [x] 3.3 在 `CommandRuntimeDependencies` 类型与 main.ts 装配处补充 `requestManualCompaction` 回调

## 4. /compact 命令 handler

- [x] 4.1 新增 `src/commands/compact-command-handler.ts`：`match` 仅命中纯 `/compact`，`start` 打开 confirm surface（标题/正文/确认取消，结构参照 ClearCommandHandler）
- [x] 4.2 `handleEvent`：Enter → close session + reset composer + requestManualCompaction；Esc → close session + reset composer
- [x] 4.3 在 `resolve-slash-command.ts` 注册 `CompactCommandHandler`（确保 /compact 进入 slash 提示与解析）

## 5. app 层手动压缩编排

- [x] 5.1 给 app 层提供执行 `runCompaction` 所需的 `ProviderAgent` 访问路径（注入形态按 design Open Question 决定）
- [x] 5.2 在 main.ts 实现 `runManualCompaction()`：检查 responding 锁 → 起 working spinner + 置 responding → 调 `runCompaction({force:true})`
- [x] 5.3 成功（`compacted`）→ `applyCompaction` 落盘 + 追加 compaction_notice
- [x] 5.4 无边界（`no_boundary`）→ 追加"当前无需压缩"提示
- [x] 5.5 失败 → 追加 error role record（复用 failAssistantTurn 路径）；finally 停 spinner + 释放 responding

## 6. 测试与验证

- [x] 6.1 `runCompaction` 单测：成功 / below_threshold / no_boundary / force 绕过阈值仍吸附边界
- [x] 6.2 CompactCommandHandler 单测：仅匹配纯 /compact、confirm 启动、Enter/Esc effects
- [x] 6.3 手动压缩编排测试：成功落盘+提示块、no_boundary 提示、失败 error record、responding 锁阻止并发
- [x] 6.4 运行 `npm run typecheck`
- [x] 6.5 运行 `npm test`
- [x] 6.6 运行 `find bin src test -name '*.js' -exec node --check {} \;`
- [x] 6.7 手动验证：长会话 /compact 确认压缩、提示块、无需压缩反馈、失败反馈、压缩中阻止提交

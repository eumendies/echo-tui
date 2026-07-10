## Context

上下文压缩能力已落地（change `add-context-compression`，已归档）。当前压缩编排 `maybeCompact` 是 `agent-loop-runtime.runAgentLoop` 内的闭包，捕获 run 内运行态（`recordRegion`、`usageAnchor`、`state.contextWindow`、可变 `compactionState`），并在压缩后回填状态 + 触发 `onCompacted`。纯算法（`estimateContextTokens` / `exceedsCompactionThreshold` / `computeCompactionBoundary` / `generateCompactionSummary`）已在 `context-compaction.ts`。

slash 命令体系（`command-runtime` + `command-effects`）是**同步 effect 模型**：handler 返回 effect[]，runtime 同步执行完。带副作用且需委派 app 的动作（如 `loadTranscriptSession`）通过 effect type + `CommandRuntimeDependencies` 回调落地。`/clear` 用 confirm surface（提交 → 确认框 → Enter 执行）。

约束（AGENTS.md）：模块小而专注；抽象要有具体收益；不引入第三方库；注释中文；改动配合 `node:test`。

## Goals / Non-Goals

**Goals:**
- 抽出可复用的纯异步压缩核心 `runCompaction`，自动触发与手动触发共享。
- 新增 `/compact`：confirm 确认 → 手动触发一次压缩（绕过阈值，立即压）。
- 手动压缩复用 `responding` 锁与 working spinner；失败走 `error` role record；成功复用 `applyCompaction`。
- 活跃区间不足以产生有效边界时给出"无需压缩"反馈，而非静默。

**Non-Goals:**
- 不改自动触发的行为语义（仍超阈值才压）。
- 不做压缩失败重试（后续 change）。
- 手动压缩**不**顺带发起对话请求（`/compact` 后等用户下一条消息）。
- 不新增独立的 `compacting` 锁/spinner kind（复用 `responding` + working）。

## Decisions

### 决策 1：抽出 `runCompaction` 纯异步函数，runtime 与手动共享

```ts
// context-compaction.ts
type RunCompactionResult = {
  didCompact: boolean;
  reason: 'compacted' | 'below_threshold' | 'no_boundary';
  compaction?: CompactionState;   // didCompact 时给出新状态
};

async function runCompaction(options: {
  records: TranscriptRecord[];
  compaction?: CompactionState;
  anchor?: TokenUsageAnchor | null;   // 自动触发用于估算；手动可省
  contextWindow?: number;             // 自动触发用于阈值；force 时可省
  force?: boolean;                    // true=绕过阈值，仍做边界吸附
  agent: ProviderAgent;
}): Promise<RunCompactionResult>;
```

逻辑：
- `force=false`：先 `estimateContextTokens` + `exceedsCompactionThreshold`，未超 → `{didCompact:false, reason:'below_threshold'}`。
- `force=true`：跳过阈值判定，直接算边界。
- 两者都执行 `computeCompactionBoundary`（含工具配对吸附）；`boundary <= activeStartIndex` → `{didCompact:false, reason:'no_boundary'}`。
- 生成摘要 → 返回 `{didCompact:true, reason:'compacted', compaction:{...}}`。

**纯函数式**：不直接改状态、不触发回调。调用方拿 result 自行处理。

- 替代方案（否决）：手动压缩在 app 层另写一套——两份编排重复，违背 DRY。

### 决策 2：runtime `maybeCompact` 退化为薄封装

```
maybeCompact():
  result = await runCompaction({records:recordRegion, compaction, anchor, contextWindow, force:false, agent})
  if result.didCompact:
    compactionState = result.compaction
    usageAnchor = null
    onCompacted(compactionState)
```

保持现有自动触发行为不变（`force:false`），只是把内部算法编排换成调用共享核心。

### 决策 3：异步 slash 命令通过新 effect type 委派给 app

同步 effect 装不下异步 LLM 调用。沿用 `loadTranscriptSession` 的委派模式：新增 effect `REQUEST_MANUAL_COMPACTION`，`CommandRuntimeDependencies` 增 `requestManualCompaction()` 回调，由 main.ts 实现真正的异步编排（fire-and-forget，effect 解释本身仍同步返回）。

```
/compact 提交 → confirm surface
Enter → effects: [closeSession, resetComposer, requestManualCompaction]
        runtime applyEffects 调 dependencies.requestManualCompaction()
        main.ts: 启动异步 runManualCompaction()（不阻塞 effect 返回）
```

### 决策 4：main.ts `runManualCompaction` 异步编排

```
runManualCompaction():
  if responding: return                     // 复用锁，避免并发
  responding=true; startSpinner('working')
  try:
    session = appContext.getAgentSession()   // records + compaction
    result = await runCompaction({records:session.records, compaction:session.compaction,
                                  force:true, agent})  // 复用同一 agent 实例
    if result.didCompact:
      appendRecord(appContext.applyCompaction(result.compaction))
    else:
      appendRecord({role:'compaction_notice', text:'当前无需压缩'})  // no_boundary 反馈
  catch error:
    appendRecord(failAssistantTurn(error))   // error role，复用现有
  finally:
    stopSpinner; responding=false
```

待确认细节：`runCompaction` 需要 `ProviderAgent` 实例。当前 agent 由 `agent-loop-runtime` 内部 `initialize` 持有，app 层拿不到裸 agent。需要给 app 层一条获取/复用 agent 的路径（见 Open Questions）。

### 决策 5：`/compact` confirm surface 与 `/clear` 同构

复用 `ConfirmCommandSurface`：标题"/compact 压缩上下文"，正文说明"将发起一次摘要请求压缩较早历史"，confirm/cancel。handler 结构照搬 `ClearCommandHandler`。

## Risks / Trade-offs

- [app 层缺少裸 `ProviderAgent` 访问] → 见 Open Questions；倾向让手动压缩走与 runAgent 同一注入点。
- [手动压缩与自动 turn 并发] → 复用 `responding` 锁，进行中拒绝新提交/再次 /compact。
- [force 跳过阈值但记录太少] → 边界吸附后无有效边界，返回 `no_boundary`，UI 给"无需压缩"提示而非报错。
- [压缩失败] → error record + 释放锁，不重试（既定）。
- [effect 解释同步但压缩异步] → 用委派回调 fire-and-forget，effect 仍同步返回，UI 靠 spinner/record 反映进度。

## Open Questions

- **app 层如何拿到 `ProviderAgent` 执行 `runCompaction`？** 候选：(a) `createApp` 注入 agent 工厂，手动压缩时新建/复用；(b) 把手动压缩也走 `runAgent` 的一个特殊模式（但 `runAgent` 当前签名是跑完整 turn）。倾向 (a)——给 app 一个 `runManualCompaction` 依赖（类似 `runAgent` 的注入），内部持有 agent。具体注入形态在实现时定。
- 反馈文案"当前无需压缩"是否需要区分 `below_threshold`（force 下不会出现）与 `no_boundary`——手动 force 只会遇到 `no_boundary`，单一文案即可。

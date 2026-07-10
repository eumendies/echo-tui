## Why

当前上下文压缩只在「发请求前预估超阈值」时自动触发，用户无法主动压缩。有时用户明知接下来要问的内容会很长、或想在长会话中途主动精简上下文，需要一个手动入口立即触发一次压缩，而不必等到自动阈值命中。

## What Changes

- 新增本地 slash 命令 `/compact`：用户主动触发一次上下文压缩。
- `/compact` 复用现有 confirm command surface（与 `/clear` 一致）：提交纯 `/compact` 先弹确认框，确认后才执行（因为压缩会发起一次 LLM 摘要请求、消耗 token）。
- 把 `agent-loop-runtime` 内 `maybeCompact` 的压缩编排抽到 `context-compaction.ts` 的纯异步函数 `runCompaction`，供自动触发与手动触发共享同一压缩核心。
- 手动触发**绕过阈值判定**（用户主动要求即压），但**仍执行边界吸附**（不切断 tool_call/tool_result 配对）；活跃区间不足以产生有效边界时给出"无需压缩"反馈。
- 手动压缩复用现有 `responding` 锁与 working spinner；压缩失败走现有 `error` role transcript record（与"模型响应失败"统一），不重试。
- 压缩成功后复用现有 `applyCompaction`（落盘压缩状态 + 追加 `compaction_notice` 提示块）。

## Capabilities

### New Capabilities
（无新建 capability；本变更扩展既有能力。）

### Modified Capabilities
- `context-compression`: 抽出可复用的 `runCompaction` 异步压缩核心（边界计算 + 摘要生成 + 产出新压缩状态），支持 `force` 绕过阈值；新增手动触发压缩的需求。
- `terminal-tui-prototype`: 新增 `/compact` slash 命令（confirm 确认 + 手动压缩执行 + 复用 responding 锁 + 失败走 error record + 边界不足时反馈）。

## Impact

- 抽取/复用：`src/agent/context-compaction.ts` 新增 `runCompaction`；`src/agent/agent-loop-runtime.ts` 的 `maybeCompact` 改为调用它。
- 命令：新增 `src/commands/compact-command-handler.ts`；在 `src/commands/resolve-slash-command.ts` 注册。
- 编排：`src/app/main.ts` / `src/app/app-context.ts` 新增手动压缩异步编排（起 spinner/锁、调 `runCompaction`、`applyCompaction`、失败插 error record）。
- 可能新增 command effect 类型用于触发异步压缩（取决于 design 决策）。
- 测试：compact handler、`runCompaction`、手动压缩编排的成功/失败/无需压缩路径。

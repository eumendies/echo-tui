## Why

当前 status line 只能显示最近一次 provider request 的 context 总用量，用户无法判断上下文主要被 system prompt、工具定义、历史消息还是 reasoning 占用。新增 `/context` 命令可以把已有真实 usage 进一步拆解展示，帮助用户决定是否压缩、清理会话或调整工具/模式使用。

## What Changes

- 新增 `/context` slash command，用于展示最近一次 provider context usage 的详细分类视图。
- 扩展 context usage 状态，保留 provider 返回的真实 input token 总量，并附带分类 token breakdown。
- 基于 provider request 快照估算分类占用：System prompt、Skills、Tools、Messages、Reasoning。
- 将分类估算按 provider `usageInputTokens` 校准，使 breakdown 总和与真实 used tokens 一致。
- 使用与 demo 一致的终端卡片风格展示：总量、窗口占比、上下文占用条和分类明细。
- 无最近 provider usage 时，命令给出明确提示，不展示本地实时估算。

## Capabilities

### New Capabilities
- `context-usage-command`: 定义 `/context` 命令展示 provider context usage 详细 breakdown 的用户可见行为。

### Modified Capabilities
- `terminal-tui-prototype`: 将已有 status line context usage 语义扩展到可由 `/context` 命令查看详细分类，但 status line 的短文本行为保持不变。
- `command-host-runtime`: 为本地 slash command 暴露读取 context usage 与展示上下文详情 surface 所需的受控能力。

## Impact

- 影响 `src/agent/`：复用/抽取 token estimator，并在 agent loop 中生成 context usage breakdown。
- 影响 `src/types/agent.ts`：扩展 `ContextUsage` 类型以包含分类 segments。
- 影响 `src/app/`：缓存详细 context usage，并通过 CommandHost 暴露给 `/context` 命令。
- 影响 `src/commands/`：新增 `/context` command handler 并注册到默认 slash command 列表。
- 影响 `src/render/` 与 command surface 类型：新增或复用可交互详情 surface，渲染 demo 风格 context meter。
- 影响测试：新增 token breakdown、命令路由、无 usage 提示、详情渲染和 status line 兼容性覆盖。

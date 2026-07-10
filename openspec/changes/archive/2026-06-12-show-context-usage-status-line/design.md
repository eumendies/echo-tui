## Context

OpenAI provider agent 已能从 `response.completed` 提取 `usage.input_tokens`，agent loop runtime 也已经接收 `usageInputTokens` 并用它作为 context compaction 的内部锚点。当前这份真实 usage 只存在于 agent runtime 内部，不会进入 app 状态或 status line。

Status line 由 `RenderContext` 从 `AppContext` 提供的模型 label、pending 状态、slash suggestion 和模式派生，当前只显示模型、项目、mode 和快捷键提示。要显示真实 context usage，需要把 provider usage 通过 agent callback 传回 app，并作为当前进程内 transient 状态参与 render state。

## Goals / Non-Goals

**Goals:**

- 在 status line 显示最近一次真实 provider input usage 和当前 context window。
- 明确显示的是最近一次真实请求 usage，例如 `ctx last 18.2k/128k`，避免被理解为本地实时估算。
- 把 context usage 存在 AppContext 侧的 transient state，不写入 transcript 或 persisted session。
- 在模型切换、清空 transcript、恢复 session 等旧 usage 失效的场景清空该状态。
- 保持 command surface、approval surface 和 user-question surface 仍替换普通 status line，不新增额外 UI 区域。

**Non-Goals:**

- 不实现实时估算 composer 草稿或下一次请求 token。
- 不把 tool schema、system prompt 或 skill catalog 的估算值单独展示。
- 不持久化 usage，也不在 `/resume` 后恢复 usage。
- 不新增图形进度条、颜色阈值告警或 context usage 历史。

## Decisions

### 使用 provider `usage.input_tokens` 作为唯一 used 值

Status line 的 used token SHALL 来自 provider 返回的真实 input usage。没有真实 usage 时不展示 context usage，而不是用本地估算填充。这样展示值可信，代价是首次请求完成前、provider 不返回 usage 时不会显示。

替代方案是复用 `estimateContextTokens()` 做实时估算，但这会混入 system prompt、tool schema、provider 包装开销等不确定因素，且用户明确希望看到真实 usage。

### 通过 agent callback 上报 context usage

在 `AgentCallbacks` 增加 `onContextUsage`，payload 包含 `usedTokens`、`contextWindow` 和 `source: 'provider'`。agent loop runtime 在每次 provider turn 返回 `usageInputTokens` 后调用该 callback，并继续保留现有 compaction usage anchor 逻辑。

这样 OpenAI provider agent 仍只负责 provider 边界解析；agent loop runtime 负责把当前模型 context window 和 usage 组合成 app 可用事件。

### AppContext 持有 transient usage 状态

Context usage 不属于 transcript fact，也不是 renderer 自有状态。AppContext 作为 app 实例组合根持有最近一次 usage，并在 `createRenderState()` 时传给 `RenderContext`。如果后续需要更多方法，可抽成 `ContextUsageContext`；第一版直接在 AppContext 增加小型状态和 `set/clear` 方法即可。

### Status line 使用短文本片段

Status line 增加 `ctx last <used>/<window>` 片段，放在模型 label 后、项目名前：

```text
GPT-5 · ctx last 18.2k/128k · echo_tui · idle · / 命令 · Ctrl+J 换行
```

数值使用紧凑格式：小于 1000 直接显示整数，大于等于 1000 使用一位小数的 `k` 表示。status line 继续使用现有单行裁剪逻辑。

## Risks / Trade-offs

- 旧 usage 可能被误解为当前 composer 草稿后的用量 -> 使用 `ctx last` 文案，并在模型切换、清空、恢复 session 时清空。
- provider 不返回 usage 时没有显示 -> 比显示不可信估算更安全；可在后续变更中增加 fallback。
- status line 更拥挤 -> 复用现有单行截断；窄终端可能截断 key hint 或 context 片段。
- 多次 continuation turn 会不断更新 usage -> status line 显示最近一次真实 provider request，这符合 `last` 语义。

## Migration Plan

无需数据迁移。新增状态只在进程内存中存在，旧 session 和 transcript 文件不受影响；回滚代码会恢复原 status line 行为。

## Open Questions

- 是否未来需要显示百分比或阈值颜色？本次先不做。

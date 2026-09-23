## Why

当前 `/status` 只能展示运行配置和账户用量。会话已经持久化当前生效的 compaction 摘要与结构化 todo 状态，但用户无法在不翻阅 transcript 或工具消息的前提下查看它们，也无法在长内容场景中稳定阅读。

## What Changes

- 将 `/status` 扩展为“概览、压缩摘要、Todo”三个只读页面，在同一 command surface 中展示当前会话的压缩状态和 todo 状态。
- 概览页保留现有运行状态与账户用量，并展示压缩和 todo 的简要状态。
- 压缩摘要页展示当前生效摘要的更新时间、活跃记录起点和可滚动的完整摘要文本。
- Todo 页展示当前会话 todo 的完成进度、更新时间和按原有顺序排列的完整任务列表。
- 支持页签切换、页面内容滚动和手动刷新本地会话快照；保持该 command 的只读、非 transcript 语义。
- 在窄终端或有限 footer 高度下，确保页签、正文和操作提示遵守现有终端安全宽度与高度预算。
- 保留概览页现有字段和顺序，并以统一的 key/value 标签列提升运行信息的可扫读性。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `status-command`: 扩展 `/status` 的会话状态信息、只读导航与长内容阅读行为。

## Impact

- 影响 `src/app/command/status-command-ports.ts`、`src/commands/status-command-handler.ts`、`src/render/footer/status-surface.ts` 及相关 command 类型。
- 读取既有 `TranscriptContext` 的 compaction 和 todo 状态，不改变其 journal 持久化格式、agent 上下文投影或 todo 工具语义。
- 需要补充 `/status` 快照、交互和受限终端布局的自动化测试。

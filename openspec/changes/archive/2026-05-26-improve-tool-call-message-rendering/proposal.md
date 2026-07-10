## Why

当前 `tool_call` / `tool_result` 在 TUI 中复用 assistant 消息样式，bash 结果会直接显示给模型使用的完整执行摘要，包括 exit code、duration、timeout 等内部元信息，导致终端阅读噪音较大。随着后续 edit、search 等工具接入，不同工具需要不同的可见投影，现有单一 assistant-block 渲染方式也不利于扩展。

## What Changes

- 优化 bash tool call 的可见展示：调用显示为 `Bash('...')`，而不是 `$ ...` 或原始 JSON arguments。
- 优化 bash tool result 的可见展示：紧跟 tool call，使用灰色弱化样式和 `⎿` 前缀，只显示命令输出或简洁状态，不显示 exit code、duration_ms 等执行摘要行。
- 为过长 tool result 增加 display-only 截断，避免长输出撑爆 transcript 区域；截断不改变 transcript 事实内容和 provider input。
- 引入按 `toolName` 分发的工具消息渲染边界，使后续工具可以实现专属显示方式，例如 edit 工具的 diff view。
- 保持 tool transcript metadata 和 OpenAI `function_call_output` 语义不变，模型仍接收完整 tool result。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `terminal-tui-prototype`: 修改 tool transcript message 的 TUI 可见投影要求，区分 tool call 与 tool result，并要求工具展示可按工具类型扩展。

## Impact

- 影响 `src/render/app-renderer.ts` 中 tool transcript records 的渲染分支。
- 可能影响 `src/app/turn-context.ts` 中 bash tool call fallback 文本的生成，但不改变 transcript metadata。
- 可能扩展 `ToolExecutionResult` / `TranscriptRecord` 的 display-only 字段，用于区分模型回传内容和 TUI 展示内容。
- 影响 render/app flow 测试中 tool record 的可见输出断言。
- 影响 `docs/README.md` 对 tool call 展示行为的说明。

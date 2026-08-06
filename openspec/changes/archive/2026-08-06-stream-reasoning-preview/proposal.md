## Why

当前 assistant 正文的流式输出会先以 footer pending preview 展示，但 reasoning summary 只有在 provider turn 结束后才作为 transcript record 出现，用户会感觉“正文已经开始了，推理内容才突然插入”。这降低了 reasoning 可见性的实时感，也让用户难以区分模型仍在推理还是已经进入最终回答生成。

## What Changes

- 为 provider-neutral agent callback 增加端到端统一的 `onReasoningUpdate` 事件，以 `draft` / `complete` 阶段同时承载可读 reasoning 内容和完成边界，不再保留单独的 summary callback。
- 在 OpenAI Responses、OpenAI Chat compatible、Anthropic provider adapter 中识别各自的 reasoning/thinking stream delta 与完成边界，并通过唯一的 reasoning 事件通道发送 draft/complete。
- 将 assistant turn 的 pending preview 拆分为顺序互斥的 `reasoning_streaming` 与 `streaming` 状态。reasoning 完成前展示 reasoning preview，完成后立即追加 `reasoning_summary` transcript，再进入正文或工具阶段。
- 保持 transcript append-only、session 持久化和 provider 续传语义不变；不可读或未返回的 provider-private reasoning 仍不展示明文。
- 更新测试覆盖 reasoning delta、阶段切换、长 preview 高度预算、完成/失败/取消路径，以及不支持明文 reasoning 的降级行为。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `streaming-llm-service-adapter`: provider adapter 的 stream 处理和 callback contract 增加可读 reasoning draft/complete 通知；`AgentTurnResult` 不再重复返回可见 summary，provider-private reasoning records 继续保持续传用途。
- `terminal-tui-prototype`: assistant 响应期间的 footer pending preview 支持 reasoning draft；reasoning 完成后立即转为 transcript，assistant 正文继续使用 streaming preview。

## Impact

- 影响 `src/types/agent.ts` 的 callback 类型定义和 provider-neutral turn callback 转发。
- 影响 `src/agent/openai-responses/agent.ts`、`src/agent/openai-chat/agent.ts`、`src/agent/anthropic/agent.ts` 以及复用 Responses stream 的 Codex 行为边界。
- 影响 `src/agent/agent-loop-runtime.ts`、`src/app/assistant-turn-runner.ts`、`src/app/state/turn-context.ts` 的 assistant turn 生命周期和 pending preview 状态。
- 影响 `src/types/render.ts`、`src/render/blocks.ts`、`src/render/footer.ts` 的 pending preview 类型与高度预算渲染。
- 需要更新相关 agent、app state、render/footer 测试；不引入新的运行时依赖，不改变 CommonJS 构建方式，不引入第三方 TUI 框架。

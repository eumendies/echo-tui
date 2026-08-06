## 1. Agent callback 与 provider stream 接入

- [x] 1.1 更新 `src/types/agent.ts`，为 agent/provider turn callback 增加 provider-neutral reasoning 更新回调，并保持现有 `onToken` 语义不变。
- [x] 1.2 更新 `src/agent/openai-responses/agent.ts`，在 `response.reasoning_summary_text.delta/done` 到达时重算可见 reasoning draft 并触发 reasoning 更新回调，同时保持 encrypted reasoning continuation 语义。
- [x] 1.3 更新 `src/agent/openai-chat/agent.ts`，在 `choices[].delta.reasoning_content` 到达时触发 reasoning 更新回调，并继续生成 Chat reasoning content record。
- [x] 1.4 更新 `src/agent/anthropic/agent.ts`，在明文 `thinking_delta` 到达时触发 reasoning 更新回调，并确保 redacted/private thinking 不进入可见 preview。
- [x] 1.5 更新 `src/agent/agent-loop-runtime.ts` 及相关测试，转发 provider reasoning draft，完成后仍按 `reasoning_summary -> tool/assistant` 顺序提交。

## 2. App turn 状态与 footer pending preview

- [x] 2.1 更新 `src/types/render.ts` 和 `src/app/state/turn-context.ts`，引入 reasoning 与 assistant 正文 pending 状态及其更新/清理方法。
- [x] 2.2 更新 `src/app/assistant-turn-runner.ts`，将 reasoning 更新回调绑定到当前 assistant turn，忽略旧 turn late callback，并在 token、失败、取消、完成和 tool handoff 路径正确清理 pending。
- [x] 2.3 保持正文 streaming 与 reasoning preview 都能复用现有响应锁、spinner/working 状态和 footer redraw 节流语义。
- [x] 2.4 更新 app state/assistant turn runner 测试，覆盖 reasoning 到达、完成后进入正文、失败清理、取消清理和旧 turn callback 隔离。

## 3. Render 与高度预算

- [x] 3.1 更新 `src/render/blocks.ts` 的 pending preview 渲染，使 reasoning preview 使用现有 reasoning 弱化样式，assistant 正文继续使用 Markdown/table-aware streaming projection。
- [x] 3.2 更新 `src/render/footer.ts` 或相关布局逻辑，让 reasoning preview 使用 footer 剩余高度预算，并在预算不足时折叠头部、保留尾部内容。
- [x] 3.3 确保 reasoning preview 在 resize/destructive replay 后按新 terminal size 重新计算预算。
- [x] 3.4 更新 render/footer 测试，覆盖长 reasoning、预算不足、预算为零、resize 后重算，以及不支持 reasoning 时不占额外行。

## 4. 文档与验证

- [x] 4.1 如有用户文档或架构文档描述 reasoning summary 显示时机，更新为“响应期间可作为 transient preview 流式展示，完成后仍按 transcript 顺序落盘”。
- [x] 4.2 运行 `npm run typecheck`。
- [x] 4.3 运行 `npm test`。
- [x] 4.4 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`。
- [x] 4.5 由用户执行交互式手动验证：真实支持 reasoning 的模型下确认 reasoning preview、assistant streaming、长输出折叠、resize、失败/取消、tool call handoff 和最终 transcript 顺序。

## 5. Reasoning 完成边界与提前落盘

- [x] 5.1 将 provider-turn `onReasoningUpdate` 扩展为 `draft` / `complete` 事件，并由 agent loop runtime 在 complete 时提前提交。
- [x] 5.2 接入 OpenAI Responses reasoning `output_item.done`、Anthropic thinking `content_block_stop`，以及 Chat compatible 首个非 reasoning 输出边界。
- [x] 5.3 调整 app turn 状态，使 reasoning transcript 提交只清 reasoning draft，并保留仍在生成的 assistant streaming draft。
- [x] 5.4 更新 provider、runtime、app 与 BTW 测试，使用协议真实事件并覆盖提前提交、失败和生命周期行为。
- [x] 5.5 同步架构文档中的 reasoning preview 与 transcript 提交时机。
- [x] 5.6 重新运行 typecheck、完整测试和 JavaScript 语法检查。

## 6. 统一 Reasoning Callback

- [x] 6.1 让 `AgentCallbacks` 与 provider-turn callback 共用结构化 `onReasoningUpdate`，删除 `onReasoningSummary` 和 runtime 的双 callback 判断。
- [x] 6.2 更新主会话、BTW 与相关测试，使 app 直接按 `draft` / `complete` 事件更新 pending 或提交 transcript。
- [x] 6.3 同步架构文档并重新运行 typecheck、完整测试和 JavaScript 语法检查。

## 7. 顺序阶段简化

- [x] 7.1 删除 Chat provider host 白名单、completion mode 与 adapter 级 `reasoningCompleted`，统一使用首个非 reasoning 输出边界。
- [x] 7.2 将 footer pending 拆分为 `reasoning_streaming` 与 `streaming`，删除组合状态、组合渲染和预算分配。
- [x] 7.3 更新 app、BTW、render/footer 与 provider 测试，覆盖顺序阶段切换和迟到 reasoning 隔离。
- [x] 7.4 同步架构文档并重新运行 typecheck、完整测试和 JavaScript 语法检查。

## 8. 单一 Reasoning 完成通道

- [x] 8.1 删除 `AgentTurnResult.reasoningSummary`、runtime turn-end fallback 与 `reasoningCommitted`。
- [x] 8.2 更新三个 provider 与 runtime 测试，使 complete callback 成为唯一可见 reasoning 完成事实。
- [x] 8.3 同步架构文档并重新运行 typecheck、完整测试和 JavaScript 语法检查。

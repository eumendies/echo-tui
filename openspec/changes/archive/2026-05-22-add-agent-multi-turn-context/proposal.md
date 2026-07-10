## Why

当前普通消息提交后，agent 只接收本轮用户文本，无法利用当前 transcript 中已经存在的历史 user / assistant 对话。`/resume` 虽然能恢复本地 transcript，但恢复后的下一轮请求仍然是单轮请求，模型看不到被恢复的上下文。

## What Changes

- 将 app 调用 agent 的输入从“当前用户文本”调整为“当前 transcript records”，使本轮 user record 与此前 assistant / user records 一起作为多轮上下文来源。
- 扩展 `TranscriptRecord` 的已知 role，支持 `system` 与 `error`；本次 change 暂不加入 `tool` 支持。
- 将本地 agent 失败反馈从 assistant 消息语义收敛为 `error` transcript record，并保持可见、持久化、可恢复。
- 在 OpenAI adapter 内增加 transcript 到 OpenAI Responses API input 的转换边界：`user`、`assistant`、`system` 进入请求，`error` 不发送给 agent。
- 保持 stateless 请求模型：每次请求基于本地 transcript 派生上下文，不引入 provider conversation id、previous response id、工具调用或 token 裁剪。
- 保持 `/clear` detach session 语义：清空后新普通消息只携带清空后的新 transcript 上下文。

## Capabilities

### New Capabilities

### Modified Capabilities
- `streaming-llm-service-adapter`: adapter 请求输入从当前用户文本扩展为从 transcript records 派生的多轮 OpenAI input，并明确 error records 不进入模型请求。
- `terminal-tui-prototype`: 普通提交、`/resume` 后继续提交、失败反馈和 transcript 渲染需支持多轮上下文与 `error` transcript role。

## Impact

- 影响 `src/types/transcript.ts` 与 `src/types/agent.ts` 的输入 contract。
- 影响 `src/app/main.ts`、`src/app/app-context.ts`、`src/app/transcript-context.ts`、`src/app/turn-context.ts` 的 transcript / agent 调用编排。
- 影响 `src/agent/openai-agent.ts`、`src/agent/fake-agent.ts`，并可能新增 OpenAI transcript converter 模块。
- 影响 `src/render/app-renderer.ts` / `src/render/blocks.ts` 的 `error` record 可见投影。
- 需要更新 app、agent、render 相关测试，覆盖多轮提交、`/resume` 后继续对话、`/clear` 后上下文断开、OpenAI input 转换和 error record 过滤。

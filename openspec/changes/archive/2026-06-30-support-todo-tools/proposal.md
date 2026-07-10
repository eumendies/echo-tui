## Why

长任务中模型需要稳定记录下一步工作，但现在只能依赖自然语言历史或压缩摘要保存 todo，未完成事项可能在上下文压缩后丢失或被摘要改写。todo 又是高频状态，若放入 system prompt 会导致 prompt cache 前缀频繁失效。

## What Changes

- 新增模型可调用的 todo 管理工具，支持创建当前 todo list 和完成指定 todo。
- 新增会话级结构化 `todoState`，与 transcript session 生命周期绑定，随 `/resume` 恢复，随 `/clear` 清空。
- 每次 provider 请求只把未完成 todo 作为 transient suffix 注入；全部完成时不注入 todo suffix。
- 新建 todo list 时覆盖当前 `todoState.items`，旧的已完成 todo 不继续作为运行时状态保留。
- todo tool call/result 仍作为普通 transcript records 记录，并按现有压缩逻辑处理；未完成 todo 的可靠来源是 `todoState`，不是历史 tool records 或压缩摘要。
- 为 `create_todos` 和 `complete_todo` 增加专属 tool message renderer，已完成 todo 显示勾选和删除线，未完成 todo 显示未完成标记，并用颜色强调未完成的第一项。
- 不新增第三方依赖，不改变 system prompt 或 provider-visible tools schema 的稳定性目标。

## Capabilities

### New Capabilities
- `session-todo-management`: 会话级 todo 状态、create todos / complete todo 工具、未完成 todo transient suffix 注入和持久化恢复语义。

### Modified Capabilities

## Impact

- 影响 `src/types/transcript.ts`、`src/persistence/transcript-store.ts`、`src/app/state/transcript-context.ts` 和 `src/app/state/app-context.ts` 的 session 状态结构。
- 影响 `src/types/agent.ts` 与 `src/agent/agent-loop-runtime.ts` 的 agent session 输入和 provider records 构造。
- 新增或扩展 `src/tools/` 下的 todo 工具 handler，并接入默认 tool registry / agent loop 执行路径。
- 影响 `src/render/tool-message-renderer.ts` 和 `src/render/tool-message-renderers/` 的工具消息渲染路由。
- 需要更新 agent runtime、transcript store、app context、tool execution 和 render 相关测试。

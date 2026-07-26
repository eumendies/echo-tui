## Why

`/hooks` 管理面板在长 command、保存入口和交互一致性上存在可用性缺口：长 command 只能尾部截断，保存依赖隐藏式 `s` 快捷键，和其它表单 surface 的显式保存动作不一致。
同时，当前 lifecycle hooks 只能观察 tool call 的开始和结束，无法观察 tool approval 与 `ask_user_questions` 这类会阻塞用户交互的关键节点，限制了用户通过 hook 做审计、通知或本地判断的能力。

## What Changes

- `/hooks` entry detail 中的长 command SHALL 支持横向查看，而不是只能尾部截断。
- `/hooks` SHALL 移除 `s` 保存快捷键语义，并在 entries 与 entryDetail 两层提供 `Save changes` 可选 action row，通过 Enter 保存。
- lifecycle hook events SHALL 新增 tool approval request/response 事件，并在 response payload 中包含授权决策与用户反馈文本。
- lifecycle hook events SHALL 新增 user question request/response 事件，并在 response payload 中包含用户答案文本，方便用户通过 hook 审计或判断答案。
- 新增事件仍 SHALL 保持 lifecycle hooks 的旁路观察者语义：hook 不能允许、拒绝、修改工具执行，也不能替用户回答问题。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `hooks-command`: 调整 `/hooks` 管理面板的长 command 查看方式与保存动作呈现/键盘语义。
- `lifecycle-hooks`: 扩展 lifecycle hook 事件集合与 payload，覆盖 tool approval 与 user question 的 request/response 生命周期。

## Impact

- 影响 `/hooks` command handler、hooks surface render、hooks command surface 类型和相关测试。
- 影响 lifecycle hook event 常量、payload 类型、synthetic test payload、hook dispatcher 事件派发点和配置 bootstrap 文档。
- 影响 agent loop runtime 中 tool approval 与 `ask_user_questions` 的观测事件派发，但不改变现有授权决策、用户问题结果、tool execution 或 transcript 语义。
- 不引入新依赖，不使用 alternate screen，不改变 hook 命令执行隔离模型。

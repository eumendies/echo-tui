## Why

当前 plan mode 通过每次 provider 请求末尾的动态 suffix 重复注入约束，而切回 normal 后不发送对等的解除说明，模型可能继续沿用历史 assistant 消息中的 Plan Mode 判断并拒绝写入。需要把模式切换表达为持久化、模型可见的 user message 事实，同时保持终端只展示用户原文。

## What Changes

- 移除 plan mode 在 provider runtime context suffix 中的动态注入；todo 运行态继续沿用现有动态 suffix。
- 当下一条提交给 agent 的 user message 相对上一条 agent user message发生 normal/plan 模式切换时，把模式切换说明、对应模式约束和用户原文组合为该 record 的 provider-facing `text`。
- 进入 plan 时写入只读规划约束；退出 plan 回到 normal 时明确写入此前 Plan Mode 限制已解除，并允许在正常审批边界内执行修改。
- user record 通过 `displayText` 保留并展示用户原文，通过 `historyText` 保留原始 composer 输入，模式说明不出现在普通 transcript 渲染和输入历史中。
- 仅模型可见模式发生切换的首条 user message 携带模式说明；同一模式下后续消息不重复注入。未启动 agent 的 shell/shell-local 命令不更新上一条模型可见模式。
- plan mode 的工具风险分类和写操作拒绝边界保持不变；本变更只调整模型提示的注入与持久化方式。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `app-mode-command`: 修改 normal/plan 模式切换对 agent user message、provider 上下文和可见 transcript 的要求。

## Impact

- 影响 `AppContext` / assistant turn 提交流程：需要识别上一条模型可见 mode，并在模式切换时构造隐藏的 provider-facing user text。
- 影响 transcript user record：复用现有 `displayText`、`historyText` 和 `interactionMode` 元数据，不新增独立可见记录。
- 影响 agent runtime context：plan mode 不再进入动态 mode suffix，todo suffix 行为保持不变。
- 影响 mode、assistant turn、provider records、resume/历史记录和渲染相关测试；不改变 provider adapter API、工具 registry 或审批策略。

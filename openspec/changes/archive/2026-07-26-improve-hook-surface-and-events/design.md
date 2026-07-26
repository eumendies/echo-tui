## Context

当前 `/hooks` surface 使用三层状态管理 lifecycle hook 配置：event 列表、entry 列表和 entry detail。entry detail 中 command 字段按固定宽度尾部截断，左右键没有查看语义；保存依赖 `s` 快捷键，与 `/config` 等表单类 surface 的显式 `Save changes` action row 不一致。

Lifecycle hooks 当前是不可拦截的旁路观察者，覆盖 assistant turn、tool call 和 compaction。tool approval 与 `ask_user_questions` 在 tool call start/end 之间发生，但没有独立 hook event，用户无法通过 hook 观察“正在等待用户授权/回答”以及最终选择内容。

## Goals / Non-Goals

**Goals:**

- 让 `/hooks` 的长 command 可在 entry detail 中横向查看。
- 将 `/hooks` 保存入口改为 entries 与 entryDetail 中的显式 `Save changes` action row，并移除 `s` 快捷保存语义。
- 为 tool approval request/response 和 user question request/response 增加 lifecycle hook event。
- 在 response payload 中包含用户反馈或答案文本，支持本地审计、通知和判断。
- 保持 hooks 旁路观察者语义，不让 hook 输出或退出码影响授权、回答或工具执行结果。

**Non-Goals:**

- 不让 lifecycle hook 拦截、修改或自动回答 tool approval / user question。
- 不改变现有 tool approval choice surface 或 `ask_user_questions` choice surface 的交互流程。
- 不将 hook 输出显示到 TUI、写入 transcript 或注入模型上下文。
- 不引入 alternate screen、第三方 TUI 库或新的外部依赖。

## Decisions

### `/hooks` command 横向查看使用状态内 scroll offset

为 hook entry detail 增加 command 横向查看状态，例如 `commandScroll`。当 surface 处于 `entryDetail`、当前焦点为 `Command` 且没有进入编辑态时，Left/Right 调整 scroll offset，Home/End 可跳到开头/末尾。渲染层基于该 offset 生成可见窗口，并使用前后省略号表达左侧或右侧仍有内容。

替代方案是对 command 自动换行。该方案会让 detail 表单行数不稳定，影响焦点行、底部错误和 test 状态展示，因此不采用。

### 保存入口改为 action row，移除 `s` 快捷键

entries 和 entryDetail 均显示 `Save changes` action row，用户通过 Up/Down 移动到该行并按 Enter 保存。`s` 不再触发保存，避免隐藏快捷键和其它 surface 的表单语义不一致。

entries 层也提供保存行，是因为用户可能只在 entry 列表中新增、删除、启停 entry 后就想保存，不应强迫进入 detail。entryDetail 提供保存行，是因为用户编辑 command/timeout 后需要在当前表单完成保存。

### hook interaction events 在 agent loop runtime 派发

tool approval 和 `ask_user_questions` 的 request/response hook 在 agent loop runtime 的 tool call 流程中派发，而不是放在 TUI context 内。这样 interactive TUI 和 headless `--once` 的自动拒绝或 full-access 自动允许路径都能被观察到。

这些 hook 仍使用现有 dispatcher 的 best-effort enqueue 模型：emit 不等待 hook 完成，hook 失败不影响主流程。

交互式 tool approval callback 通过返回值区分会话缓存与真实等待：allow-all、tool 级或 command 级缓存同步返回决策，不派发 approval interaction hooks；只有真实打开授权界面并返回 Promise 时才派发 request/response。Headless 策略不打开界面，但仍按可观察自动决策的既有契约派发 request/response。

### response payload 包含用户文本

`tool_approval_response` payload 包含 decision，并在用户选择反馈时包含 feedback 文本。`user_question_response` payload 包含 result text / answer text，使用户可以在本地 hook 中判断答案。该设计承认 payload 可能包含用户输入和工具参数，因此文档和类型应维持现有“不要包含 provider 密钥或 client 配置”的边界，同时不额外过滤用户主动提供给模型的文本。

## Risks / Trade-offs

- 用户答案和反馈文本可能包含敏感内容 → hook 是用户本地显式配置的 observer；payload 不包含 provider apiKey/headers，并在文档中保持 hook payload 可能包含交互内容的语义。
- `/hooks` 保存快捷键移除可能影响少量已有用户习惯 → 显式 `Save changes` action row 提升一致性；测试应确保 `s` 不再保存，避免双路径语义漂移。
- 横向 scroll 增加 surface 状态复杂度 → 只限定在 command detail 焦点行，切换 entry/event/edit 状态时重置，避免影响其它字段。
- 新增 hook events 增加 payload 和 synthetic test 覆盖面 → 使用现有 `LIFECYCLE_HOOK_EVENTS` 常量驱动 `/hooks` event 列表，并补齐 synthetic payload 的稳定测试字段。

## 1. 状态模型与 app 生命周期

- [x] 1.1 扩展 `PendingState`，新增 tool call pending preview 所需字段，并保持 thinking/streaming 现有语义。
- [x] 1.2 扩展 `RenderState` 与相关 context，增加 working 状态 `{ frame, elapsedMs }`，不新增 app/runtime 类。
- [x] 1.3 在 `TurnContext` 或等价现有状态边界中暂存当前 tool call，支持 result 到达后生成既有 `tool_call` record。
- [x] 1.4 调整首字 token、complete、fail、assistant segment、tool call、tool result 回调中的 pending/working 生命周期。

## 2. Footer 与 tool 消息渲染

- [x] 2.1 在 footer layout 中按 `pending preview -> working line -> divider -> composer surface` 顺序渲染，确保 working 紧贴 divider 上方。
- [x] 2.2 增加 working spinner 投影，显示 spinner 帧和本轮已耗时，并纳入 footer 高度和 cursor row 计算。
- [x] 2.3 增加 tool call pending preview 渲染，复用或对齐正式 tool call 的工具名称/参数展示。
- [x] 2.4 调整 tool message renderer，根据相邻 `tool_result.ok` 为 `tool_call` 行的 `◆` prefix 应用成功/失败样式，缺少状态时保持中性 fallback。

## 3. Transcript append 行为

- [x] 3.1 调整 `onToolCall` app 回调：只更新 footer pending，不立即 append 可见 transcript record。
- [x] 3.2 调整 `onToolResult` app 回调：result 到达后追加暂存的 `tool_call` record 和当前 `tool_result` record。
- [x] 3.3 保持 agent loop runtime continuation records、provider input 转换和 session persistence schema 不变。
- [x] 3.4 增加批量 append 渲染能力，确保相邻 `tool_call` / `tool_result` 可共享 result 状态并减少 footer 重绘。

## 4. 测试与文档

- [x] 4.1 更新 app 流程测试，覆盖 tool call pending 化、result 到达后再追加两条 transcript record。
- [x] 4.2 更新 footer/render 测试，覆盖 working line 位置、耗时显示、tool call pending preview 和 cursor row 计算。
- [x] 4.3 更新 tool message renderer 测试，覆盖 success/failure prefix 着色和历史 record fallback。
- [x] 4.4 更新相关 docs/spec 主文档说明新的 tool 消息显示行为。
- [x] 4.5 按仓库要求运行 `npm run typecheck`、`npm test`、`find bin src test -name '*.js' -exec node --check {} \;`。

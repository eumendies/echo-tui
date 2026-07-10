## 1. Agent 协议与工具循环

- [x] 1.1 在 `src/types/agent.ts` 中新增结构化 `ToolApprovalDecision` 类型，并扩展 `AgentCallbacks.onToolApprovalRequest` 回调。
- [x] 1.2 在 `src/agent/agent-loop-runtime.ts` 中为 `apply_patch` 增加执行前授权 gate，允许时执行原始 tool call。
- [x] 1.3 在 `src/agent/agent-loop-runtime.ts` 中实现用户拒绝时的 synthetic `ok: false` tool result，并确保 continuation 仍追加 tool result record。
- [x] 1.4 增加或更新 agent loop runtime 单元测试，覆盖允许执行、拒绝跳过执行、非 `apply_patch` 不拦截。

## 2. App 工具授权状态与输入

- [x] 2.1 新增 app 侧工具授权 context，管理当前 tool call、select 选项、选中索引、Promise resolver 和结构化决策。
- [x] 2.2 工具授权 context SHALL 提供 `request(call)`、`getSurface()`、`hasActiveRequest()` 和 `handleEvent(event)` 等运行时接口。
- [x] 2.3 在 `src/app/main.ts` 的 agent callbacks 中接入 `onToolApprovalRequest`，让 agent loop 等待用户选择。
- [x] 2.4 在 `src/app/main.ts` 的 render state 中让工具授权 select surface 优先于 command runtime surface。
- [x] 2.5 在 `src/app/main.ts` 的输入事件分发中让工具授权 modal 优先消费 Enter、Esc、Up、Down 和其他输入，避免污染主 composer。

## 3. TUI 行为与渲染集成

- [x] 3.1 使用现有 select surface 渲染工具授权面板，第一版展示 `Allow once` 和 `Deny` 两个选项。
- [x] 3.2 确认 Enter 选择当前高亮选项、Esc 等价拒绝、Up/Down 可移动选项并触发 footer 重绘。
- [x] 3.3 确认授权等待期间保持 response lock、pending tool call 和 working 状态，不允许提交第二个普通消息。

## 4. 测试与验证

- [x] 4.1 更新 app/main 相关测试，覆盖 `apply_patch` 授权面板出现、允许后执行、拒绝后不执行、Esc 拒绝和输入优先级。
- [x] 4.2 更新类型或 fixture 测试，确保缺省未提供 `onToolApprovalRequest` 时非 `apply_patch` 工具路径兼容现有行为。
- [x] 4.3 运行 `npm run typecheck`，修复类型错误。
- [x] 4.4 运行 `npm test`，修复失败测试。
- [x] 4.5 运行 `find bin src test -name '*.js' -exec node --check {} \;`，确认 JS 语法检查通过。

## 1. Agent Usage Callback

- [x] 1.1 扩展 `AgentCallbacks` 类型，新增 context usage callback payload，包含 used tokens、context window 和 provider source。
- [x] 1.2 在 `agent-loop-runtime` 收到 provider `usageInputTokens` 后调用 context usage callback，并继续保留现有 compaction usage anchor 行为。
- [x] 1.3 确保 provider 未返回真实 usage 时不调用 context usage callback，也不使用本地估算替代。
- [x] 1.4 增加 agent loop runtime 测试，覆盖 usage 上报、缺失 usage 不上报和 continuation 多次 usage 更新。

## 2. App Transient State

- [x] 2.1 在 AppContext 中增加 transient context usage 状态和 set/clear 入口，不写入 transcript 或 persisted session。
- [x] 2.2 在 agent callback 中把 context usage 写入 AppContext，并触发 footer 重绘。
- [x] 2.3 在 `/model` 切换成功、`/clear` 确认清空、`/resume` 成功恢复后清空 context usage。
- [x] 2.4 增加 AppContext 或 app integration 测试，覆盖 usage 保存、render state 派生和清空场景。

## 3. Status Line Rendering

- [x] 3.1 扩展 `StatusLineState` 和 render state，携带可选 context usage。
- [x] 3.2 更新 `RenderContext`，把 AppContext 提供的 context usage 注入普通输入态 status line。
- [x] 3.3 更新 status line 文本渲染，显示 `ctx last <used>/<window>`，并使用紧凑 token 格式。
- [x] 3.4 保持 command/approval/user-question surface 替换普通 status line，不额外显示 context usage 行。
- [x] 3.5 增加 footer renderer 测试，覆盖有 usage、无 usage、窄宽度裁剪和 k 格式。

## 4. Docs And Validation

- [x] 4.1 更新 `docs/README.md`，说明 status line context usage 是最近一次真实 provider input usage。
- [x] 4.2 更新 `docs/tui-architecture.md`，说明 usage callback、AppContext transient state 和 status line 数据流。
- [x] 4.3 运行 `npm run typecheck`。
- [x] 4.4 运行 `npm test`。
- [x] 4.5 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [ ] 4.6 手动验证真实 OpenAI 响应完成后 status line 显示 `ctx last ...`，模型切换、清空和恢复 session 后清空显示。

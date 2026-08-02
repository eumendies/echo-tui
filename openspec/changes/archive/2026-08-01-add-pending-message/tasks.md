## 1. 待发送状态与提交快照

- [x] 1.1 定义待发送文本、最小 render state 和单槽 `PendingMessageContext`，实现 enqueue、原子 claim 与显式 clear。
- [x] 1.2 将 pending-message context 接入 `AppContext`，并在 `/clear`、成功 `/resume`、应用退出等生命周期清理 transient 状态。
- [x] 1.3 为单槽拒绝覆盖、claim 一次性和清理行为增加 context 层测试。

## 2. 输入路由与 turn 编排

- [x] 2.1 将普通 composer 提交重构为共享文本管线，复用 command/skill、shell、file mention 和 assistant turn 路由，普通提交单独传入已有 conversation reference。
- [x] 2.2 区分 live composer 与 pending dispatch 的 composer 副作用，确保排队时只记录一次历史，自动处理时不重置后来输入的草稿或光标。
- [x] 2.3 在 active assistant turn 期间接入 Enter 排队：空输入无操作，已有 pending 时保留原消息和当前草稿，非 assistant response lock 保持既有行为。
- [x] 2.4 在 assistant turn 完成、失败或中断释放 response lock 后使用同步 claim 自动处理 pending 输入，并隔离旧 turn 的迟到 callback/finally。
- [x] 2.5 调整 Esc 优先级为 active surface → pending message → 其他 composer attachment → assistant interruption，并确保第一次 Esc 移除 pending、第二次 Esc 才中断 turn。
- [x] 2.6 增加 controller/runner 测试，覆盖正常完成、失败、queued slash 路由、排队后继续输入、重复 Enter、显式移除和迟到回调不重复发送。

## 3. Footer 卡片与高度预算

- [x] 3.1 扩展 `RenderState` 和 app render projection，将 pending message 的最小有界预览传给 composer surface。
- [x] 3.2 在 composer 上方实现固定最多两行、紧张空间可退化为一行的待发送卡片，将多行文本单行化并按 safe display width 截断。
- [x] 3.3 将卡片纳入 input-surface 高度分配，优先保留 status line、光标附近 composer 和 pending 卡片，并让 assistant preview、suggestions 与辅助附件使用剩余预算。
- [x] 3.4 保留 `constrainLayoutTail()` 最终兜底和合法 cursor row，确认卡片出现/移除只走 footer-only redraw，resize recovery 从当前状态重放卡片。
- [x] 3.5 增加 footer/app-renderer 测试，覆盖短→高、高→短清理、长 streaming、长 composer、conversation reference、极小 rows、窄 columns、`rows - 2` 上限和 destructive recovery。

## 4. 回归验证与文档

- [x] 4.1 更新 README 或架构文档，说明响应期间单条 pending message、Esc 移除优先级、自动处理和非持久化语义。
- [x] 4.2 运行 `npm run typecheck` 并修复所有类型错误。
- [x] 4.3 运行 `npm test` 并修复所有自动化测试回归。
- [x] 4.4 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`，并整理需要用户执行的真实终端 pending/streaming/resize/scrollback 验证清单。

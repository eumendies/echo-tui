## 1. Active turn 中断入口

- [x] 1.1 调整 `interruptActiveAssistantTurn()`：取消 `pendingKind` 仅限 thinking / streaming 的判断，改为基于 active turn identity、responding lock 和未触发的 turn-level `AbortController`。
- [x] 1.2 确认 `src/app/main.ts` 的 Esc 分发顺序保持 surface-first：user question、tool approval、file picker、command surface 和运行中 shell command 均先于 assistant loop interrupt。
- [x] 1.3 更新中断收尾逻辑，确保任意 loop 阶段中断时都会清理 pending preview/spinner、保留 partial assistant、追加本地中断提示并释放 response lock。
- [x] 1.4 补充 app/turn-context 测试，覆盖 thinking、streaming、tool pending、provider wait 和 surface 关闭后二次 Esc 的中断入口。

## 2. Agent loop abort 边界

- [x] 2.1 在 `agent-loop-runtime` 中增加统一的 abort boundary helper，并在每次 provider turn 前后检查取消信号。
- [x] 2.2 在 tool approval callback、`ask_user_questions` callback、tool executor 调用前后和下一轮 continuation 前检查取消信号。
- [x] 2.3 确保取消后不再调用 final complete callback、不再发起 provider continuation，并隔离迟到 token/tool/result/complete 回调。
- [x] 2.4 确保中断发生在未完成 tool call pending 时不会追加缺少 result 的孤儿 `tool_call` record；已成对完成的 tool records 保持 transcript 事实。
- [x] 2.5 补充 agent loop runtime 测试，覆盖 provider 返回后已取消、工具返回后已取消、continuation 前已取消和迟到回调隔离。

## 3. 取消信号传递到压缩与工具

- [x] 3.1 修改自动上下文压缩摘要生成入口，使其接收并传递 turn-level `AbortSignal` 到内部 provider request。
- [x] 3.2 确保压缩摘要请求取消或迟到返回时不落盘新的压缩状态，也不继续发起原计划 provider request。
- [x] 3.3 扩展 tool executor / tool handler options 类型，支持可选 `abortSignal`，并从 agent loop runtime 统一透传。
- [x] 3.4 让 `run_bash_command` handler 将 `abortSignal` 传给共享 bash runner，复用既有进程终止策略。
- [x] 3.5 让 `web_fetch`、`web_search` 等 web 工具组合自身 timeout 和 turn-level abort，任一信号触发都能取消底层请求。
- [x] 3.6 补充 compaction、tool executor、bash tool 和 web tool 的取消相关测试。

## 4. Surface 与 shell 语义回归保护

- [x] 4.1 为 `ask_user_questions` 增加测试：第一次 Esc 只关闭 choice surface 并返回 cancelled tool result，不直接中断 assistant turn。
- [x] 4.2 增加测试：`ask_user_questions` surface 关闭后，如果 assistant turn 仍 active，第二次 Esc 中断 agent loop。
- [x] 4.3 为 tool approval、file picker 和 command surface 增加或更新 Esc 优先消费测试，防止 global interrupt 抢占 surface 局部取消。
- [x] 4.4 为 shell mode 增加或更新测试，确认运行中 shell command 的 Esc 仍优先中断 shell command，而不是 assistant loop。

## 5. 验证与文档

- [x] 5.1 运行 `npm run typecheck`，修复所有 TypeScript 类型错误。
- [x] 5.2 运行 `npm test`，修复所有自动化测试失败。
- [x] 5.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`，确认 JavaScript 语法检查通过。
- [x] 5.4 手动验证 TUI：等待 provider 返回、工具执行、工具结果 continuation、自动压缩、`ask_user_questions` surface 首次/二次 Esc、tool approval Esc 和 shell command Esc 的交互行为。

## 1. Hooks 配置与类型

- [x] 1.1 新增 lifecycle hook event name、payload、hook entry、dispatcher 和 executor 相关 TypeScript 类型。
- [x] 1.2 实现用户级 `hooks` 配置解析，支持按事件名读取 hook command 和 timeout。
- [x] 1.3 对缺失、未知事件、无效 command 或无效 timeout 执行忽略策略，确保不阻断 CLI 启动。
- [x] 1.4 增加配置解析单测，覆盖未配置、有效配置、无效 entry、未知事件和边界 timeout。

## 2. Hook Dispatcher 与执行隔离

- [x] 2.1 新增 `src/hooks/` dispatcher，提供 `emit(event, payload)` 旁路接口和测试可用的 executor 注入点。
- [x] 2.2 实现 hook job enqueue 和 fire-and-forget 后台执行，生产路径不等待 hook 完成。
- [x] 2.3 实现非交互子进程执行：当前 cwd、stdin JSON payload、`ECHO_HOOK_EVENT` 和 `ECHO_HOOK_CWD` 环境变量。
- [x] 2.4 实现 timeout、stdout/stderr 忽略、异常捕获和失败隔离，hook 结果默认丢弃且不调用 renderer。
- [x] 2.5 增加 dispatcher 单测，覆盖 payload stdin、环境变量、执行顺序 enqueue、非零退出码、超时、输出忽略和 executor 异常。

## 3. Assistant Turn 生命周期接入

- [x] 3.1 在顶层装配中创建 hook dispatcher，并注入 `runAssistantTurn`。
- [x] 3.2 在普通 assistant turn 开始时派发 `assistant_turn_start`，payload 包含 cwd、timestamp、interaction mode 和 turn status。
- [x] 3.3 在 assistant turn 成功完成时派发 `assistant_turn_end`，不改变最终 assistant transcript 追加语义。
- [x] 3.4 在 assistant turn 非取消失败时派发 `assistant_turn_error`，不改变本地 error transcript 语义。
- [x] 3.5 在 assistant turn 中断时派发 `assistant_turn_cancelled`，不改变 partial assistant persistence 和中断提示语义。
- [x] 3.6 增加 assistant turn runner 单测，验证 hooks 被 emit 且 hook 失败不会影响 transcript、footer 或响应锁释放。

## 4. Agent Loop 生命周期接入

- [x] 4.1 将 hook dispatcher 注入 `createAgentLoopRuntime` 或每次 run state，保持 provider-neutral runtime 边界清晰。
- [x] 4.2 在 tool call 进入执行处理前派发 `tool_call_start`，payload 包含 tool call id、tool name 和 arguments text。
- [x] 4.3 在普通工具、拒绝工具和交互式工具产生 result 后派发 `tool_call_end`，payload 包含 tool call id、tool name 和 result ok 状态。
- [x] 4.4 在自动 compaction 完成并得到新 compaction state 后派发 `compaction_end`，payload 包含 activeStartIndex 和 createdAt。
- [x] 4.5 确认 token streaming、context usage 和 reasoning summary 不派发 hooks。
- [x] 4.6 增加 agent loop runtime 单测，验证 tool/compaction hooks 事件顺序、payload 内容和 hook 失败不影响 continuation。

## 5. 不可见性与持久化验证

- [x] 5.1 增加集成或控制器级测试，验证 hook stdout/stderr、退出码、超时和异常不追加 user、assistant、tool_result、local_notice 或 error transcript record。
- [x] 5.2 验证 hook 输出和执行结果不进入 provider request、tool result 或 session persistence。
- [x] 5.3 验证 invalid hooks 配置不在 TUI 中显示错误，不影响 `/help`、普通消息提交和 tool approval surface。
- [x] 5.4 验证 CLI 退出 cleanup 不等待未完成 hook jobs 且不破坏终端恢复。

## 6. 文档与最终验证

- [x] 6.1 更新用户文档，说明 `~/.echo/config.json` 的 hooks 配置格式、支持事件、stdin payload、环境变量和 best-effort 语义。
- [x] 6.2 文档中明确 hooks 不可拦截、默认不显示、不写 transcript、不持久化 session、不回传模型。
- [x] 6.3 运行 `npm run typecheck`。
- [x] 6.4 运行 `npm test`。
- [x] 6.5 运行 `find bin src test -name '*.js' -exec node --check {} \\;`。

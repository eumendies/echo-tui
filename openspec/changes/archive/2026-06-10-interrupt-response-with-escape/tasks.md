## 1. Agent 取消协议

- [x] 1.1 在 `src/types/agent.ts` 中为 `AgentSessionInput` 和 `ProviderAgent.runTurn` 增加可选取消信号类型，并补充可识别的 abort 判断/错误工具。
- [x] 1.2 更新 `src/agent/agent-loop-runtime.ts`，在 run 初始化、压缩、provider turn、tool call 和 continuation 边界传递并检查取消信号。
- [x] 1.3 更新 `src/agent/openai-agent.ts`，将取消信号传给 OpenAI SDK streaming 请求，并把用户主动 abort 与普通 provider 失败区分开。
- [x] 1.4 更新 `src/agent/fake-agent.ts`，让 thinking delay 和逐字 streaming delay 支持取消信号，取消后停止后续 token callback。

## 2. App 中断生命周期

- [x] 2.1 在 `src/app/main.ts` 为每次普通 assistant turn 创建 active turn identity 和 `AbortController`，并将 signal 传入 `runAgent` session。
- [x] 2.2 在输入事件分发中处理 response 活跃期间的 Esc：保留现有 modal/command 优先级，无高优先级 surface 时 abort 当前 turn。
- [x] 2.3 为 agent callbacks 增加当前 turn 校验，忽略被中断旧 turn 的迟到 token、tool、complete 等回调。
- [x] 2.4 在 abort catch/收尾路径中保留 partial assistant、追加本地中断提示、清理 pending/working、停止 spinner 并释放 response lock。

## 3. 本地中断提示与 provider 过滤

- [x] 3.1 在 transcript/types 或既有宽松 record 模型中定义并使用本地中断提示 role，保持 append-only 与持久化兼容。
- [x] 3.2 更新 `src/app/turn-context.ts` / `src/app/app-context.ts`，提供中断收尾或追加本地中断提示的语义方法。
- [x] 3.3 更新 `src/render/app-renderer.ts` / blocks，使本地中断提示以克制样式渲染，并支持 resize/replay。
- [x] 3.4 更新 OpenAI transcript converter 和 context compaction 的本地 role 过滤逻辑，确保中断提示不进入 provider input 或 token 估算。

## 4. 测试与验证

- [x] 4.1 增加 app 层测试：thinking/streaming 阶段按 Esc 会 abort signal、保留 partial、追加中断提示并释放 response lock。
- [x] 4.2 增加 app 层测试：tool approval、user question 和 command session 打开时 Esc 继续由对应 surface 消费，不直接中断整个 response。
- [x] 4.3 增加 stale callback 测试：中断后的旧 token/complete 不会污染后续 turn。
- [x] 4.4 增加 OpenAI provider 测试：SDK request options 携带 signal，abort 不按普通服务失败处理。
- [x] 4.5 增加 fake provider 测试：thinking 和 streaming 阶段 abort 后停止输出。
- [x] 4.6 增加 converter/compaction/render 测试：本地中断提示可见、可恢复，且不进入 provider input 和 token 估算。
- [x] 4.7 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \;`。

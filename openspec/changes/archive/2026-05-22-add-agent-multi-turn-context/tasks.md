## 1. 类型与 agent contract

- [x] 1.1 扩展 `src/types/transcript.ts` 的已知 role，加入 `system` 与 `error`，不加入 tool role。
- [x] 1.2 将 `src/types/agent.ts` 的 `RunAgent` 输入从当前用户文本调整为 `TranscriptRecord[]`。
- [x] 1.3 更新 `src/agent/fake-agent.ts`，从传入 transcript records 中选择最新 user record 作为模拟响应文本来源，并保持 callbacks lifecycle 不变。

## 2. OpenAI transcript 转换与真实 adapter

- [x] 2.1 在 `src/agent/` 增加 OpenAI transcript input 转换边界，负责把 `user`、`assistant`、`system` records 转成 OpenAI Responses API input，并过滤 `error` 和未知 role。
- [x] 2.2 更新 `src/agent/openai-agent.ts` 的 request 构造，使其接收 transcript records 并使用转换后的结构化 input 发起流式请求。
- [x] 2.3 增加或更新 agent 测试，覆盖多轮 user/assistant/system 转换、error 过滤、未知 role 跳过和 OpenAI request shape。

## 3. app 多轮上下文编排

- [x] 3.1 更新 `src/app/main.ts` 的普通提交流程，在 `beginUserTurn()` 之后把当前 transcript records 传给 `runAgent`，不在 main 中额外维护同构 agent history。
- [x] 3.2 如有需要，收敛 `AppContext` / `TranscriptContext` 门面，提供读取当前 transcript records 的语义入口，避免 main 手动拼接历史。
- [x] 3.3 更新 app 测试 harness 和断言，覆盖第二轮普通消息、`/resume` 后继续提交、`/clear` 后上下文断开，以及测试注入 agent 接收 transcript records。

## 4. error record 与渲染

- [x] 4.1 更新 `src/app/turn-context.ts`，让 agent 失败反馈生成 `role: 'error'` 的 transcript record，并保留错误脱敏语义。
- [x] 4.2 更新 render 投影，使 `error` transcript record 可见，且不显示为 assistant 回复或文字角色标签。
- [x] 4.3 更新持久化、resume 或 render 相关测试，确认 error record 可持久化、可恢复、可显示，且不进入后续 OpenAI input。

## 5. 文档、规格与验证

- [x] 5.1 更新 `docs/README.md` 和 `docs/tui-architecture.md`，说明普通 agent 请求使用本地 transcript 多轮上下文、`/resume` 后继续对话会携带历史、error record 不发送给模型。
- [x] 5.2 运行 `npm run build`、`npm run typecheck`、`npm test`、`find bin src test -name '*.js' -exec node --check {} \;` 和 `node --check dist/bin/echo-tui.js`。
- [x] 5.3 如实现影响可见 error 样式或交互流程，进行针对性 `npm start` 手工验收，并记录结果。

## 1. 配置与 SDK Adapter

- [x] 1.1 新增 `openai` 官方 SDK 依赖，并确认 CommonJS / Node.js >= 20 下的加载方式和测试 mock 方式。
- [x] 1.2 新增 LLM 配置 loader，读取 `~/.echo/config.json` 中的 `llm` 配置对象，校验创建 SDK client 和发起文本响应所需字段，并确保错误消息不泄露敏感字段值。
- [x] 1.3 校验 `maxOutputTokens` 等数值配置，覆盖缺失、非法 JSON、非法类型、非法正整数等失败路径。
- [x] 1.4 新增真实 LLM agent adapter，使用 OpenAI SDK 发起流式文本响应，兼容 `runAgent(input, callbacks)` contract，并按顺序触发 `onThinking`、`onToken(delta, draft)`、`onComplete(finalText)`。
- [x] 1.5 在 adapter 内部归一化 SDK stream 事件：累积文本增量、忽略首版不支持的非文本事件、成功时返回最终文本、失败时 reject 而不是伪造 completion。

## 2. App 与 CLI 集成

- [x] 2.1 修改 CLI/run wiring，使默认启动路径从 `~/.echo/config.json` 创建真实 LLM agent 并传入 `createApp({ runAgent })`，同时保留 `createApp(options).runAgent` 的测试注入能力。
- [x] 2.2 修改 `submitComposer()` 的 agent 调用错误路径：捕获 `runAgent` reject，停止 spinner、清空 pending、释放 `responding`，追加本地 assistant 错误 record，并持久化当前 session。
- [x] 2.3 保持 slash command runtime 先于普通消息提交执行，确保纯 `/help`、`/model`、`/clear`、`/resume` 不调用真实 LLM adapter，且 `/model` 只展示当前模型信息或安全配置错误，不修改真实模型配置。
- [x] 2.4 确认 `/clear` detach、新消息创建新 session、`/resume` 恢复 transcript、input history 不持久化等既有持久化契约在真实 adapter 下保持不变。

## 3. 自动化测试

- [x] 3.1 为配置 loader 添加单元测试，覆盖配置文件缺失、JSON 无效、必要字段缺失、数值配置非法、错误信息不含敏感字段值。
- [x] 3.2 为真实 LLM agent adapter 添加 mock OpenAI SDK 测试，验证请求参数、文本增量 draft 累积、complete 返回值、服务错误、stream incomplete 和 SDK 抛错。
- [x] 3.3 为 app orchestration 添加测试，覆盖真实 agent 成功 streaming 后提交 assistant record、agent reject 后释放 response lock 并追加/持久化本地错误 record。
- [x] 3.4 为 slash 隔离添加回归测试，验证本地 slash 命令不会调用真实 agent，非纯 slash 前缀仍按普通消息触发 agent。
- [x] 3.5 为配置读取路径添加测试隔离，确保测试不会读写用户真实 `~/.echo/config.json`，而是通过注入路径或临时目录验证。

## 4. 文档与验证

- [x] 4.1 更新 `docs/README.md`，说明真实流式 LLM 对话、`~/.echo/config.json` 配置方式、敏感字段不应提交到仓库、缺失配置的失败行为，以及工具调用暂不支持。
- [x] 4.2 更新 `docs/tui-architecture.md`，补充 OpenAI SDK adapter、配置 loader、SDK stream 事件归一化、CLI wiring、错误恢复和 fake agent 测试定位。
- [x] 4.3 运行 `npm test`，确保全部自动化测试通过。
- [x] 4.4 运行 `find bin src test -name '*.js' -exec node --check {} \;`，确保 JavaScript 语法验证通过。
- [x] 4.5 检查新增源码、测试和文档中没有真实敏感凭据、完整鉴权值或外部参考脚本路径。

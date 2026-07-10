## Context

`echo_tui` 当前已有稳定的 TUI 状态机：普通消息提交后先追加 user transcript、持久化当前 session、进入 `responding` 锁，再通过 `runAgent(input, callbacks)` 接收 `onThinking`、`onToken`、`onComplete` 回调。footer pending preview 已支持 thinking spinner 和 streaming draft；assistant 完成后才把最终文本追加为正式 transcript record 并持久化。

本次变更不需要重做 renderer、composer、slash command runtime 或 persistence。核心问题是把 `src/agent/fake-agent.js` 的 mock 回显替换为基于 OpenAI 官方 SDK 的真实流式 adapter，同时保持当前生命周期和测试注入能力。此前参考脚本只用于确认服务形态，不在 spec 中固化脚本路径、endpoint、header 或凭据字段。

仓库约束仍保持：CommonJS、Node.js >= 20、`src/app/`、`src/render/`、`src/terminal/` 中新增或实质修改函数需要简洁 JSDoc，行为变更需要自动化测试。密钥不得进入源码、OpenSpec artifacts、测试 fixture 或文档示例。

## Goals / Non-Goals

**Goals:**
- 让 CLI 默认普通对话请求真实 LLM 服务，并以现有 pending preview 进行流式输出。
- 直接使用 OpenAI 官方 SDK 作为真实 adapter 的客户端基础，减少后续迁移成本。
- 保持 `createApp(options).runAgent` 注入点可测试，避免把网络访问耦合进 app 状态机测试。
- 通过 `~/.echo/config.json` 提供模型服务连接配置、模型名、凭据和 max output tokens 等参数，缺失时明确失败并给出配置提示。
- 正确消费 SDK 的流式文本增量、累积最终 assistant 文本，并只在完成后提交 assistant transcript record。
- 在配置、网络、SDK stream 或服务错误时释放 `responding` 锁、停止 spinner，并向用户呈现可见错误反馈。
- 保持 `/help`、`/clear`、`/resume`、transcript persistence、`/clear` detach 和 `/resume` 恢复语义不变；`/model` 继续停留在本地 slash runtime 中，但收敛为读取当前真实模型配置的只读信息面板。

**Non-Goals:**
- 不实现工具调用、函数调用、parallel tool execution 或 agentic loop。
- 不实现多轮上下文压缩、系统提示管理、模型列表动态拉取或 `/model` 与真实模型配置联动。
- 不实现多模态输入、文件上传、图片理解或语音能力。
- 不新增配置编辑 UI；首版只读取本地 JSON 配置文件。
- 不引入自动重试队列、后台补偿或离线缓存。

## Decisions

### 1. 以 `runAgent(input, callbacks)` 为 adapter 边界

新增真实 agent adapter 仍暴露与 fake agent 相同的调用形态：`runLlmAgent(input, callbacks, options)` 或由工厂 `createLlmAgent(config, dependencies)` 返回同签名函数。adapter 内部负责 SDK client 调用、stream 事件归一化、文本累积和回调触发；app 层继续只关心 `onThinking`、`onToken(delta, draft)`、`onComplete(finalText)`。

理由：当前 `src/app/main.js` 的状态机已经正确处理 thinking、streaming preview、completion commit 和 persistence。复用该 contract 能让真实接入成为小边界替换，而不是重写 renderer 或 transcript 生命周期。

备选方案：在 app 层直接调用 SDK。该方案会把服务协议、凭据、stream 处理和 UI 状态混在一起，降低测试隔离度，因此不采用。

### 2. CLI 默认装配真实 adapter，测试仍可注入 fake agent

`run()` 或 CLI 启动路径从 `~/.echo/config.json` 读取配置，创建默认真实 adapter，并传入 `createApp({ runAgent })`。`createApp(options)` 保留 `runAgent` 注入能力；单元测试可以继续传入 fake/stub agent，必要时 `src/agent/fake-agent.js` 也可保留为测试和开发 fixture。

理由：用户可见的 CLI 默认行为应该变成真实对话；同时 app orchestration 测试不应依赖外部网络或真实凭据。

备选方案：把 `createApp()` 默认值直接改成真实 adapter。该方案会让直接调用 `createApp()` 的测试或调试代码更容易因缺少本地配置失败，因此推荐只在 CLI/run wiring 层装配真实默认。

### 3. 直接使用 OpenAI 官方 SDK

新增 `openai` 依赖，并在 adapter 中用 OpenAI SDK 创建 client、发起 Responses 流式请求、消费文本增量。配置 loader 负责把本地 JSON 中的 client 初始化参数和模型参数转换为 adapter config；adapter 不直接读取磁盘。

理由：用户明确预期后续一定迁移到 OpenAI 官方库；从首版开始使用 SDK 可以避免临时 fetch/SSE 客户端的重复抽象，后续接入标准 Responses 能力、工具调用或模型配置时也更顺滑。

备选方案：先实现 Node 20 内建 `fetch` 和自维护 SSE parser。该方案短期可控，但会制造后续迁移成本，不符合当前方向，因此不采用。

### 4. 配置通过 `~/.echo/config.json` 读取

建议首版配置结构集中在 `~/.echo/config.json`，例如使用 `llm` 对象承载：
- `baseURL`：OpenAI SDK client 的服务地址配置，可选或按环境需要填写。
- `apiKey`：OpenAI SDK client 的凭据字段，必填；错误提示只说明缺少字段，不输出字段值。
- `model`：请求使用的模型名，必填或提供明确默认值。
- `maxOutputTokens`：可选，默认 512，必须解析为正整数。

配置 loader 只返回运行所需的普通对象；不得把凭据写入 transcript、日志、错误消息、持久化 session 或测试快照。若配置文件不存在、JSON 无效或必填字段缺失，CLI 应在用户提交触发真实响应时给出明确本地错误反馈。

理由：用户级配置文件比环境变量更适合 CLI 工具的长期使用，也为后续多 profile、模型选择联动或更多 SDK 参数留出扩展空间。

备选方案：环境变量配置。该方案适合临时调试，但不符合当前要求，因此不采用。

### 5. 错误处理由 app 层统一恢复 UI 状态

真实 adapter 在配置缺失、SDK 初始化失败、网络失败、服务返回错误、stream 解析/消费失败或 stream 未完成时抛出明确错误。`submitComposer()` 需要包裹 `await runAgent(...)`：发生错误时停止 spinner、清空 pending、释放 `responding`，并追加一条本地 assistant 错误消息到 transcript 后持久化，保证用户看到失败原因且不会被锁死。

理由：真实服务接入的失败面明显多于 fake agent。把 UI 恢复放在 app 层，可以确保任何 agent 实现失败后都遵守同一状态机不变量。

备选方案：adapter 自行调用 `onComplete(errorText)`。该方案会混淆真实模型输出和本地错误反馈，不利于测试错误类型和未来扩展，因此不采用。

### 6. 对话上下文首版只发送当前用户输入

首版请求 input 使用当前提交的 `userText`，不把历史 transcript records 拼入请求。历史上下文、多轮会话格式和 token budgeting 作为后续能力处理。

理由：现有 fake agent 的 contract 只接收当前 input；保持该形态能最小化本次变更。真实服务连通和流式 UX 是首要目标。

备选方案：把完整 transcript 转成 Responses input array。该方案会牵涉角色映射、历史长度限制、resume 后上下文一致性和隐私提示，不纳入首版。

## Risks / Trade-offs

- [Risk] 本地配置不存在或字段错误导致 CLI 无法完成响应 → Mitigation：提交失败时释放响应锁并显示明确错误；配置错误提示不得泄露凭据值。
- [Risk] OpenAI SDK 的 stream event 形态与目标服务兼容性存在差异 → Mitigation：adapter 层只暴露 `delta/draft/finalText`，并用 mock SDK stream 覆盖成功和失败路径；如需适配差异，只改 adapter。
- [Risk] stream 中断后 transcript 已包含 user record 但没有 assistant 正文 → Mitigation：追加本地 assistant 错误 record 并持久化，使 session 状态完整可恢复。
- [Risk] 将来接入工具调用需要更多事件类型和状态 → Mitigation：adapter 内部保留 stream 事件归一化边界，但首版明确只消费文本增量，不把工具调用概念暴露给 app 层。
- [Risk] 真实服务响应速度导致大量 token 更新触发 footer redraw → Mitigation：首版先保持现有逐 delta redraw；如出现性能问题，再在后续 change 中引入节流或批量刷新。

## Migration Plan

1. 新增 `openai` 依赖、配置 loader、真实 LLM adapter 和 SDK stream 事件归一化逻辑，并用 mock SDK client/stream 编写单元测试。
2. 修改 CLI/run wiring，让默认启动路径使用真实 adapter；保留 `createApp(options).runAgent` 测试注入能力。
3. 修改 app response error path，确保任何 `runAgent` reject 都会停止 spinner、释放锁并产生可见错误反馈。
4. 更新 README 和架构文档，说明 `~/.echo/config.json`、凭据注意事项、真实流式输出和 fake agent 的测试定位。
5. 若发布后需要回滚，可把 CLI/run wiring 临时切回 fake agent 或提供显式开发开关，但不得把失败静默伪装成真实成功。

## Open Questions

- `~/.echo/config.json` 是否需要兼容未来多个 profile？首版建议只实现单个 `llm` 配置对象，避免过早设计选择器。
- `model` 是否必须显式配置？首版可由实现阶段根据用户本地配置习惯决定；无论如何缺失时都必须明确失败或使用文档化默认值。

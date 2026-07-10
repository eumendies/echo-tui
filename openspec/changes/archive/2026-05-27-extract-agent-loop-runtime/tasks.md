## 1. 类型与运行时边界

- [x] 1.1 在 agent 类型中定义底层 provider turn agent 的输入、输出与依赖类型，保持现有 `RunAgent`、`AgentCallbacks` 和 `TranscriptRecord[]` 契约不变。
- [x] 1.2 新增 agent loop runtime 模块，迁移 tool loop 所需的 assistant segment、tool_call record、tool_result record 构造逻辑。
- [x] 1.3 在 agent loop runtime 中实现默认运行时加载：读取 LLM 配置、创建默认 tool registry、创建 tool executor，并支持测试注入这些依赖。

## 2. OpenAI agent 收窄

- [x] 2.1 将 OpenAI agent 改为单次 provider turn adapter：保留 OpenAI client 创建、request 构造、stream 读取、tool call 提取和错误归一化。
- [x] 2.2 从 OpenAI agent 中移除本地工具执行、continuation while loop、tool_call/tool_result transcript record 追加职责。
- [x] 2.3 保留或迁移现有 OpenAI helper 导出，确保 request 构造、文本 delta 提取、错误脱敏和 converter 测试仍可覆盖。

## 3. 默认装配路径

- [x] 3.1 更新默认真实启动路径，使 `main.ts` 通过 `createAgentLoopRuntime({agent: createOpenAiAgent()})` 或等价形式获得 `RunAgent`。
- [x] 3.2 确认 `main.ts` 不直接创建 tool registry、tool executor 或读取工具运行时配置。
- [x] 3.3 确认 fake/stub `RunAgent` 注入路径不受影响，app 层 callbacks 和 transcript append 逻辑无需感知底层拆分。

## 4. 测试与验证

- [x] 4.1 新增 agent loop runtime 单测，覆盖无 tool call 完成、工具调用前 assistant segment 提交、单轮多个工具调用、工具失败仍 continuation、底层 provider 错误不触发 complete。
- [x] 4.2 更新 OpenAI agent 测试，覆盖单次 provider turn 的 request 构造、stream parsing、function call 去重、错误脱敏和不执行工具的边界。
- [x] 4.3 更新默认真实装配或集成测试，覆盖 OpenAI provider agent 经 agent loop runtime 完成 tool-call continuation 的完整路径。
- [x] 4.4 运行 `npm run typecheck`、`npm test` 和批量 `node --check`，确认 TypeScript 编译、CommonJS 输出与测试路径正常。

## 5. 文档与规格同步

- [x] 5.1 根据实现结果同步非归档文档或主 spec 中的现状契约，确保只记录当前架构边界，不写迁移前后叙述。
- [x] 5.2 回填本 tasks 清单，标记已完成任务，并在归档前确认 `openspec validate` 通过。

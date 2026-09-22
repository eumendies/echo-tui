## 1. 摘要请求形态与共享前导构造

- [x] 1.1 抽出共享请求前导构造（内置 system prompt + 存在压缩状态时原位的摘要消息），供 `buildProviderRecords` 与压缩摘要请求复用；材料口径一致时前导输出与普通请求逐字一致
- [x] 1.2 抽出 `resolveProviderPromptMaterials`（指令文件、system override、skill catalog 投影、sandbox note、contextWindow），`initializeRunState` 与手动压缩路径共用
- [x] 1.3 改造 `generateCompactionSummary`：输入改为「共享前导 + 被压缩记录原生投影 + 尾部摘要指令 user 消息」，经 `agent.runTurn(..., {isCompaction: true, sessionId})` 发起；移除 `renderRecordsForSummary`
- [x] 1.4 改写 `createSummaryInstruction`：保留 5 小节模板要求；存在旧摘要时引用「上方既有摘要」并要求产出单条更新摘要，SHALL NOT 重复嵌入旧摘要正文
- [x] 1.5 摘要输入不过滤 extension 记录（与 `shouldIncludeRecordInProviderContext` 的 role 过滤保持一致，仅排除本地非发送 role）
- [x] 1.6 `computeCompactionBoundary` 新增「被压缩区间不以 extension 记录结尾」吸附；与既有 tool 配对吸附迭代到稳定
- [x] 1.7 保持采纳语义宽松：非空摘要直接采纳，不引入小节标题校验、重试或 `summary_invalid` 失败原因

## 2. 缓存身份与 usage 透出

- [x] 2.1 `generateCompactionSummary` 返回摘要文本与 `usage` / `usageInputTokens`；`runCompaction` 在发起过摘要请求时（含摘要为空判定失败的路径）透传到 `RunCompactionResult`，调用契约向后兼容
- [x] 2.2 `runCompaction` 接受并透传 `sessionId`；主 runtime 与 subagent runtime 的 `maybeCompact` 传入运行时会话身份
- [x] 2.3 主/子 runtime 读取 `RunCompactionResult.usage` 并记入既有 observation 与 usage store；手动 `/compact` 路径记入 usage store（复用 `recordReferenceUsage` 同款记账口径）
- [x] 2.4 手动压缩路径（`assistant-command-port`）接入共享前导构造与材料解析：按与 `runAgentLoop` 相同规则派生 execution/sandbox 口径，构建含 MCP 合并口径的 registry，使前导与缓存键材料与普通请求一致
- [x] 2.5 responses/chat/codex 的 prompt cache key 身份与普通请求一致：responses/chat 压缩请求的键计算仍包含工具目录材料（即使请求本身不发送 tools）；codex 由压缩调用透传会话身份，获得与普通请求相同的会话级键

## 3. adapter 参数对齐

- [x] 3.1 四个 adapter 的 `isCompaction` 分支携带会话 reasoning effort（Responses/Codex `reasoning`、Chat `reasoning_effort`、Anthropic `thinking`+`output_config`），含显式 `none`；保留不携带展示用 reasoning summary 与 codex encrypted reasoning 回传；同步更新四处「压缩用途不暴露工具或 reasoning 配置」方法级 JSDoc 注释
- [x] 3.2 codex adapter：`isCompaction` 请求省略 `text.verbosity`（`text` 字段可选化）；普通 turn 保持 `text: {verbosity: 'low'}` 不变

## 4. 测试与验证

- [x] 4.1 扩展 `test/agent/context-compaction.test.js`：摘要请求形态用例（前导与普通请求逐条一致、既有摘要原位、被压缩记录含 extension 的原生投影、摘要指令为最后一条 user 消息且不重复嵌入旧摘要正文）、extension 结尾吸附用例、`sessionId` 透传用例、usage 透出用例（含摘要为空路径）
- [x] 4.2 采纳语义用例：非空摘要直接采纳；中文标题等非模板措辞同样被接受且不触发失败
- [x] 4.3 更新四个 adapter 既有 compaction 请求断言（`codex-agent` / `openai-agent` / `openai-chat-agent` / `anthropic-agent`）：reasoning 改为携带（含 `none` 语义）、codex 摘要请求不含 `text.verbosity`、缓存键材料与普通请求一致；工具定义携带见任务组 5
- [x] 4.4 runtime 集成断言：同一 run 内压缩请求前导 == 普通请求前导；`maybeCompact` 透传 sessionId 并记账 usage
- [x] 4.5 手动压缩路径测试：前导构造、registry 口径与 usage 记账
- [x] 4.6 回归既有行为：未超阈值 / 无边界 / 正常压缩路径、普通 turn 请求形态（含 codex 普通 turn 的 `low`）与 `buildProviderRecords` 投影不变
- [x] 4.7 运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 4.8 真实会话手动验证：触发自动压缩或 `/compact`，确认摘要产出正常、无接续式输出；核对压缩请求携带会话 effort、codex 摘要请求不含 `text.verbosity`；通过 `/usage` 观察压缩请求的 cached tokens 命中；如仍有续写样本则留存用于后续迭代

## 5. 压缩摘要请求携带工具定义（前缀缓存对齐强化）

- [x] 5.1 新增 `AgentTurnOptions.includeToolDefinitions`：摘要请求可按开关携带与普通 turn 同源的工具定义，缺省语义不变（普通 turn 恒携带；未开启开关的摘要请求保持无工具）
- [x] 5.2 四个 adapter 的 `isCompaction` 分支在开启开关时携带与普通 turn 一致的工具定义与转换口径（`openai-responses` / `openai-chat` / `codex` / `anthropic`）；`tool_choice` / `parallel_tool_calls` 维持不发送
- [x] 5.3 更新四处 adapter 断言：开启开关的摘要请求带工具定义、工具调用控制参数仍不发送；未开启开关的摘要请求保持无工具
- [x] 5.4 更新压缩路径断言（`context-compaction` / `assistant-command-port` / `agent-loop-runtime` / `conversation-reference`）：压缩显式开启工具定义携带，引用总结不开启
- [x] 5.5 运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 5.6 手动 `/compact` 路径注入 schema-only 委派端口（`createSubagentSchemaPort`）：复用运行端口同一目录加载口径，使压缩请求与主会话一致携带 `run_subagent` 定义
- [x] 5.7 真实会话验证：压缩请求的 cached tokens 命中是否从前导段扩展到工具定义段（与 4.8 合并观察）

## 6. 共享材料模块命名与子运行口径收敛（重构，无请求形态变化）

- [x] 6.1 模块更名为 `provider-request-prefix.ts`：文件名对齐产物（请求前导构造 + 材料解析），更新全部引用
- [x] 6.2 抽出 `resolveRuntimeMaterials`（contextWindow、skill catalog 投影、sandbox note）：`resolveProviderPromptMaterials` 内部复用它，主运行与手动压缩调用契约不变
- [x] 6.3 子运行初始化接入 `resolveRuntimeMaterials`，删除三处内联解析；子运行仍继承父运行冻结的指令链与 override，不重读磁盘
- [x] 6.4 补 `resolveRuntimeMaterials` 纯函数用例，并运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`

## Why

压缩摘要请求把被压缩历史拍平成 `[role] text` 文本塞进单条 user 消息，摘要指令只在 system 顶部一次性给出，压缩模型经常把这段拍平转写当作可接续的对话，输出对话续写而非按固定模板生成摘要（真实会话实测约一半压缩产出为自由形式续写文本）。坏摘要会持久化为 `summaryText`、经 `buildProviderRecords` 注入所有后续请求，并作为 `previousSummary` 参与下一轮合并，错误会复利传播，污染整个后半程会话。此外，摘要请求被 `isCompaction` 分支整体剥离 reasoning 配置，且 codex adapter 对包括摘要在内的全部请求固定发送 `verbosity: low`，与上游 Codex「压缩与采样共享同一请求 effort、verbosity 按配置省略」的行为相悖，是续写倾向的次要放大因素。

摘要请求同时完全无法复用会话的 prompt 缓存前缀：它没有普通请求的内置 system prompt 前导（codex adapter 对无 system 记录回退 `'You are a helpful assistant.'`），摘要输入过滤了 extension（provider reasoning 回传）记录，旧摘要被搬进尾部指令而非原位，压缩请求不携带会话身份（sessionId），responses/chat 的 prompt cache key 材料又因剥离工具定义而与普通请求不同；`generateCompactionSummary` 还把摘要请求 usage 直接丢弃，缓存是否命中完全不可观测。本地 usage 账本显示普通 turn 已稳定吃到缓存（codex 约 60%、openai-chat 约 95% 输入 token 为缓存读取），压缩请求则始终全价重发近整段历史。

## What Changes

- 改造摘要请求形态：请求输入改为「与同一会话普通请求一致的前导（内置 system prompt + 原位既有摘要消息）→ 被压缩记录原生 provider 转换投影 → 尾部摘要指令 user 消息」，替代拍平 `[role] text` 文本。
- extension（provider reasoning 回传）记录随原生投影进入摘要输入，不再额外过滤；压缩边界吸附新增保护，避免被压缩区间以 extension 记录结尾、切开 reasoning 回传与其配对后续记录。
- 摘要请求复用普通请求的缓存路由身份：透传会话身份（sessionId）；prompt cache key 材料与普通请求一致；并携带与普通请求同源的工具定义，使前导与工具定义段共同构成共享前缀，命中普通请求已建立的缓存。
- 摘要请求不携带工具调用控制参数（`tool_choice` / `parallel_tool_calls` 维持不发送）：工具调用兜底为既有行为（不执行、丢弃 tool call、仅取 draft）。
- 摘要请求 usage 回传可观测：摘要 provider turn 的 usage（含缓存命中 token）随压缩操作结果透出，自动路径记入 usage 账本与运行观测，手动 `/compact` 路径记入 usage 账本。
- 手动 `/compact` 复用同一前导构造与材料解析（与 agent loop 初始化共享），并携带会话身份。
- 摘要请求对齐上游 Codex：携带会话配置的 reasoning effort（含显式 `none` 禁用语义），不再整体剥离；仅保留「不携带仅供展示的 reasoning summary 配置」与「不请求 encrypted reasoning 回传」两条剥离。
- codex 摘要请求不再固定发送 `text: {verbosity: 'low'}`（省略该字段、使用模型默认）；普通 turn 保持现状。该调整同时覆盖引用总结请求（与压缩共用 `isCompaction` 语义）。
- 修正一处相邻的既有 spec 漂移：`openai-chat` 的 `none` effort 场景改为与实现一致（显式发送 `reasoning_effort: none` 表达禁用；未配置才不发送），不产生代码改动。
- 摘要采纳保持宽松：非空输出即采纳；模型输出中文标题或其他非模板措辞的小节时同样采纳，本迭代不引入小节标题校验、重试或新的失败原因。
- 扩展 `test/agent/context-compaction.test.js`（已覆盖 `runCompaction` 边界与输入过滤）回归测试，新增请求形态、缓存对齐与采纳语义用例；同步更新四个 adapter 与 runtime 的请求断言。
- 本迭代明确不做：摘要输出模板校验与重试、压缩请求超窗裁剪重试、`RunCompactionResult` 失败原因细分、压缩专用 reasoning effort 配置。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `context-compression`: 摘要请求形态改为「普通请求前导 + 原生转写 + 尾部指令」且不再过滤 extension；压缩边界吸附新增 extension 结尾保护；摘要请求复用普通请求缓存路由身份并随压缩操作结果透出 usage；摘要请求改为携带会话 reasoning effort（含显式 `none`）且不再固定低 verbosity；摘要采纳保持不校验小节标题语言与措辞。
- `conversation-reference`: 引用总结请求与压缩摘要共用 `isCompaction` 语义，由「不继承普通 turn 的 reasoning」改为「携带会话 reasoning effort（含显式 `none`）、不固定低 verbosity」，仍不携带仅供展示的 reasoning summary 配置与 reasoning 加密回传请求，也不因压缩摘要携带工具定义而一并携带工具。
- `streaming-llm-service-adapter`: 修正 `openai-chat` 的 `none` effort 场景文本，使其与既有实现和测试一致（显式 none 直传；未配置时不发送）。

## Impact

- `src/agent/context/context-compaction.ts`：`generateCompactionSummary` 请求构造（前导 + 原生投影 + 尾部指令 + sessionId + usage 透出）、`createSummaryInstruction` 指令组织、`computeCompactionBoundary` extension 吸附；移除 `renderRecordsForSummary`。
- 新增共享 prompt 构造模块（agent 层）：请求前导构造（内置 system prompt + 原位摘要消息）与 prompt 材料解析（指令文件、system override、skill catalog、sandbox note、contextWindow），供 agent loop 与手动压缩路径复用。
- `src/agent/loop-runtime/shared.ts`、`src/agent/loop-runtime/agent-loop-runtime.ts` 与 `subagent-loop-runtime.ts`：`buildProviderRecords` 改为复用共享前导构造；压缩调用传入前导与 sessionId，并登记结果中的 usage。
- `src/agent/openai-responses/agent.ts`、`src/agent/codex/agent.ts`、`src/agent/openai-chat/agent.ts`、`src/agent/anthropic/agent.ts`：`isCompaction` 分支的 reasoning 携带、codex 摘要 verbosity 行为、prompt cache key 材料对齐，以及按 `includeToolDefinitions` 携带工具定义。
- `src/app/command/assistant-command-port.ts`、`src/app/command/command-host.ts`：手动 `/compact` 构造同一前导、携带会话身份、记账 usage。
- `test/agent/context-compaction.test.js`、`test/agent/agent-loop-runtime.test.js`、`test/agent/subagent-runtime.test.js` 与四个 adapter 测试文件；手动压缩路径测试。
- `openspec/specs/streaming-llm-service-adapter/spec.md`：spec 文本修正，无代码改动（实现与测试已符合新口径）。
- 持久化格式（`CompactionState`、`set_compaction`）不变，旧会话无迁移成本。

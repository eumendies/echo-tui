## Context

压缩摘要生成位于 `src/agent/context/context-compaction.ts`：`generateCompactionSummary` 当前把 `createSummaryInstruction(previousSummary)` 放在首条 system 记录，把 `renderRecordsForSummary` 拍平出的 `[role] text` 文本塞进单条 user 消息，再调用 `agent.runTurn(summaryRecords, {}, {abortSignal, isCompaction: true})` 取 `result.draft.trim()`。真实会话实测约一半压缩产出是对话续写而非模板摘要：拍平转写天然诱导续写、指令离生成点太远、且输出只做非空校验，坏摘要直接持久化并作为 `previousSummary` 复利传播。

`isCompaction` 分支目前还统一剥离 reasoning 配置（四个 adapter），这是 2026-07-20「isolate compaction requests」变更的刻意选择（省 token 与延迟；当时风险记录已注明「省略 reasoning 后模型可能仍使用服务端默认推理」）；codex adapter 则对全部请求固定发送 `text: {verbosity: 'low'}`。

压缩请求与会话普通请求的 prompt 缓存身份完全不对齐：普通请求前导是「内置 system prompt + 存在压缩状态时原位的摘要消息」，压缩请求却以摘要指令充当 system、没有摘要消息、拍平形态与 provider 原生 token 流脱节、不带会话身份、还丢弃了 usage。本地 usage 账本显示普通请求已稳定吃到缓存（命中的缓存输入 token 占比约 60%–95%，随 provider 不同），而压缩请求按构造无法命中：每次压缩都以全价重发近整段历史。上游 Codex 的压缩请求直接走普通请求推理链路（`base_instructions` 原样保留、完整原生历史经 `for_prompt` 投影、摘要 prompt 追加在末条），天然共享前缀缓存，并可复用会话亲和（见 `6b2cc32`：会话身份缺失会让连续请求落到随机缓存分片，A/B 实测 0% vs 98.9% 命中率）。

参照 openai/codex 的本地压缩实现（`codex-rs/core/src/compact.rs`、`src/session/reasoning_effort.rs`）：摘要指令作为最后一条 user 消息追加在原生历史之后；压缩与采样共享同一请求 effort（`RequestEffortUsage::Compaction`）；`model_verbosity` 未配置时不发送 `text` 字段；对超窗只从头部裁剪以保持前缀缓存。本变更保留 echo-tui 的 5 小节固定模板（已决策，不做 Codex 自由 handoff 风格），吸收其请求形态、缓存对齐与参数策略；失败语义保持宽松采纳，本次不引入模板校验与重试。

复核中发现一处相邻的既有 spec 漂移：`streaming-llm-service-adapter` spec 的 `openai-chat` `none` 场景（「未设置或值为 `none` → SHALL NOT 发送」）与自 `6b1e860`（send explicit reasoning effort none）起的实现和测试（显式发送 `reasoning_effort: 'none'` 表达禁用）不一致，该提交未同步 spec。本变更一并把 spec 修正为实现口径。

约束：普通 turn 的请求形态与 prompt cache key 材料保持不变；`RunCompactionResult` 调用契约向后兼容（仅在发起摘要请求时新增可选 `usage` / `usageInputTokens` 字段）；持久化结构 `CompactionState` 与 `set_compaction` 不变；压缩摘要请求携带与普通请求同源的工具定义（详见 Decisions 12），`tool_choice` / `parallel_tool_calls` 等工具调用控制参数维持不发送；共享同一 `isCompaction` 语义的 `conversation-reference` 引用总结请求一并对齐（reasoning/verbosity）并维持工具剥离（其输入是引用素材文本，不参与本变更的前导复用）。

## Goals / Non-Goals

**Goals:**

- 压缩请求形态改为「与普通请求一致的前导 + 原生转换切片（含 extension）+ 尾部摘要指令」，消除续写诱因。
- 对齐普通请求的 prompt 缓存身份：前导复用、extension 纳入原生投影、摘要原位、会话身份与缓存键材料一致，使压缩请求共享普通请求已建立的前缀缓存。
- 摘要请求 usage（含缓存命中输入 token）可观测并可由调用方记账。
- 摘要请求携带会话 reasoning effort（含显式 `none`），与上游 Codex 共享 effort 语义对齐；codex 摘要请求不再固定低 verbosity。
- 摘要采纳保持宽松：非空即采纳，中文标题等同义措辞同样被接受。
- 扩展 `test/agent/context-compaction.test.js` 并更新 runtime、四个 adapter 与手动压缩路径的回归。

**Non-Goals:**

- 不改普通 turn 的请求形态、reasoning 参数、codex verbosity 行为与 prompt cache key 材料（仅调整 `isCompaction` 请求）。
- 不改摘要模板提示词内容（5 小节模板仍作为指令要求），但不引入输出校验与重试。
- 不改压缩阈值、`CompactionState` 持久化结构；边界计算只新增 extension 吸附保护。
- 不为 `conversation-reference` 引用总结请求做缓存对齐（其输入是一次性引用素材，没有与普通请求共享的前缀）。
- 本迭代不引入压缩专用 reasoning effort 配置、压缩请求超窗裁剪重试或独立压缩模型。

## Decisions

1. **请求形态：普通请求前导 + 原生转换切片 + 尾部指令 user 消息**。`generateCompactionSummary` 的输入改为 `[...请求前导, ...被压缩记录原生投影, {role: 'user', text: 摘要指令}]`：请求前导 SHALL 与普通请求同源构造（`buildProviderRequestPrefix` 抽出复用，内容为内置 system prompt 与存在压缩状态时原位的摘要消息），被压缩记录复用各 adapter 的 transcript converter（配对、图片、shell 投影由转换器统一处理），摘要指令作为最后一条 user 消息贴近生成点。不再构造拍平文本，`renderRecordsForSummary` 随之移除。备选「拍平文本 + 数据围栏 + 尾部指令」改动更小，但拍平形态本身是续写诱因、且与普通请求 token 流脱节，无法共享前缀缓存，弃用。
2. **摘要指令只放尾部 user 消息，既有摘要原位**。指令不再充当 system 记录；存在旧摘要时，摘要消息保持普通请求中的原位置（system 之后），尾部指令引用「上方既有摘要」并要求产出单条更新摘要，SHALL NOT 重复嵌入旧摘要正文。这样 system 槽位回到与普通请求逐字一致的内置 prompt，压缩请求与普通请求在 token 0 起共享前缀；备选「旧摘要并入尾部指令」会让前缀在第 2 条记录处分叉，无法命中缓存，弃用。
3. **extension 记录随原生投影进入摘要输入，并新增边界吸附保护**。extension 是 provider reasoning 回传载体，普通请求本身就会回传（codex/OpenAI 为 reasoning item、chat 为 reasoning_content、anthropic 为 thinking block）；把 extension 排除在摘要输入外会在切片遇到第一条 extension 时与前缀分叉，因此改为不过滤，与 `shouldIncludeRecordInProviderContext` 现有 role 过滤保持一致（仅排除本地不可发送 role）。原先「空 extension 悬尾」的续写诱因改由边界吸附消除：`computeCompactionBoundary` 新增「被压缩区间不以 extension 记录结尾」吸附，extension 与其后续记录保持同侧，摘要请求不再出现孤立 reasoning item，后续普通请求的活跃区间起点也不会切开配对。吸附与既有 tool 配对保护迭代到稳定。
4. **缓存路由身份对齐**。摘要请求 SHALL 复用同一会话普通请求的缓存路由身份：`isCompaction` 请求也透传运行时会话身份（`AgentTurnOptions.sessionId`，由调用方通过 `runCompaction` 传入），codex 因此得到与普通请求相同的会话级 prompt cache key；responses/chat 的键材料（模型、system 文本、工具目录材料）SHALL 与普通请求一致，且工具目录不再只做键材料、而是随请求体一起发送（详见 Decisions 12）。anthropic 无显式缓存键，靠前导 token 前缀命中。
5. **摘要请求 usage 透出，不引入回调**。`generateCompactionSummary` 返回摘要文本与对应 provider turn 的 usage；`runCompaction` 在发起过摘要请求时把 `usage` / `usageInputTokens` 透传到 `RunCompactionResult`（含摘要为空判定失败的路径，token 已真实消费）。主/子 runtime 在 `maybeCompact` 读取结果并记入既有 observation 与 usage store；手动 `/compact` 路径记入 usage store。备选「新增 `onProviderUsage` 回调」与 `可复用压缩操作` 的「纯函数式、SHALL NOT 触发回调」契约冲突，弃用（conversation-reference 的用法不在该契约约束内，不构成先例）。
6. **摘要请求携带会话 reasoning effort，对齐上游 Codex**。四个 adapter 的 `isCompaction` 分支按与普通 turn 同一规则发送 reasoning：Responses/Codex 发送 `reasoning`（含显式 `none`）、Chat 发送 `reasoning_effort`、Anthropic 在 effort 非 `none` 时启用 `thinking` + `output_config`。保留两条剥离：`reasoning.summary` 是仅供展示的配置；codex `include: ['reasoning.encrypted_content']` 是一次性请求不需要的回传。理由：上游压缩与采样共享同一 effort；实测失败形态是指令遵循失败，思考预算被剥离是合理放大因素；压缩为低频事件，成本可接受。
7. **codex 摘要请求不固定低 verbosity**。普通 turn 保持 `text: {verbosity: 'low'}`；`isCompaction` 请求省略 `text` 字段、使用模型默认详细度。理由：上游默认不发送该字段（走模型预设默认）；固定 low 压缩输出篇幅，不利于摘要按模板完整承载 5 小节内容。
8. **摘要采纳宽松：非空即采纳，不做模板校验**。不校验小节标题齐全度、语言或措辞；实测模型会以中文标题表达等价小节，硬校验会把合格摘要误判为压缩失败。请求形态改造已直接消除续写诱因，先以真实使用验证效果；若后续真实使用仍出现接续式摘要，再评估加入宽松校验（如最小长度）作为下一个迭代。该决定同时避免引入 `summary_invalid` 失败原因与重试状态机。
9. **手动 `/compact` 复用同一前导构造与材料解析**。抽出 `resolveProviderPromptMaterials`（指令文件、system override、skill catalog 投影、sandbox note、contextWindow）供 `initializeRunState` 与手动压缩路径共用；手动路径按与 `runAgentLoop` 相同规则派生 execution/sandbox 口径，构建与 runtime 相同口径的 registry（含 MCP 合并）使缓存键材料一致。手动路径在压缩时点重新解析材料，与运行中冻结值可能有轻微漂移（如会话中改了 skill/memory），best-effort：偏差只影响命中率，不影响请求正确性。
10. **测试夹具**。在既有 `test/agent/context-compaction.test.js` 基础上补齐请求形态与缓存对齐语义：断言压缩请求前导与普通请求前导逐条一致（含 extension 原位、摘要原位、指令居尾不重复正文）、边界 extension 吸附、`sessionId` 透传、usage 透出与采纳宽松；runtime 层补「同一 run 内压缩请求前导 == 普通请求前导」的集成断言。复用既有最小 `ProviderAgent` stub 模式，从公共入口驱动，不为测试增加生产参数。
11. **修正 chat none spec 漂移（spec-only）**。实现与测试已按「显式 `none` 必须发送」运行（省略参数无法向兼容服务端表达禁用），仅 spec 文本滞后。本变更更新 `streaming-llm-service-adapter` spec：配置 `none` 时 SHALL 显式发送 `reasoning_effort: none`；未配置时才 SHALL NOT 发送。不新增代码或测试改动。
12. **压缩摘要请求携带与普通请求同源的工具定义（前缀缓存对齐强化）**。真实会话复核发现：压缩请求即便复用了前导与键材料，`cacheReadInputTokens` 仍只有 3,712 / 269,091（1.37%），而相邻普通请求稳定在 97%–99.5%；差值 ≈ 被剥离的工具定义段（相差 62,177 tokens），说明 provider 把工具定义计入 token 前缀，前导对齐只保住了 system 段。因此 `generateCompactionSummary` 改为显式开启 `AgentTurnOptions.includeToolDefinitions`，四个 adapter（responses / chat / codex / anthropic）在摘要请求中携带与普通 turn 完全相同的工具定义与转换口径，让工具定义段一并进入共享前缀。上游对照：官方 codex 远端压缩（`compact_remote_v2_attempt.rs`）保留完整 `model_visible_specs()` 与 `parallel_tool_calls: true`，本地压缩（`compact.rs`，`Prompt::default()`）才是空工具集——本变更选择远端压缩的形态但只取工具目录，不引入 `CompactionTrigger` 协议。`tool_choice` / `parallel_tool_calls` 本轮明确不动：官方本地压缩保留 `tool_choice: "auto"`、远端压缩更不阻止调用，而官方 Guardian 采样器用 `tool_choice: "none"` 禁调用，三种做法并存，属独立决策，待前缀命中收益验证后再评估。工具调用兜底为既有行为：压缩路径不执行工具、丢弃 tool call，仅取 `draft`，摘要为空按失败路径处理且 usage 照常透出。引用总结（`conversation-reference`）显式不开启该开关，维持无工具摘要请求（其输入是引用素材文本，没有与普通请求共享的前缀，工具目录无对齐收益）。目录装配同样要求逐条一致：工具目录里按运行条件注册的委派工具（主会话的 `run_subagent`）必须出现在压缩请求中，因此手动 `/compact` 独立装配路径注入 schema-only 委派端口（`createSubagentSchemaPort`，复用运行端口同一 `loadSubagentCatalog` 口径，只投影目录、不提供执行能力）；否则工具定义段会在这一个工具处收尾，把其后全部消息重新踢出共享前缀。
13. **共享材料模块命名与子运行口径收敛**。`provider-prompt-context.ts` 更名为 `provider-request-prefix.ts`：模块产物是「provider 请求前导构造 + 材料解析」，文件名对齐产物而不是抽象词。从 `resolveProviderPromptMaterials` 抽出 `resolveRuntimeMaterials`（contextWindow、skill catalog 投影、sandbox note），子运行初始化改为调用它并删除三处内联解析；子运行仍继承父运行冻结的指令链与 override（不重读磁盘），运行派生材料与主运行、手动压缩同源。属重构，无请求形态与请求字节变化。

## Risks / Trade-offs

- [extension 纳入摘要输入后的 provider 兼容性] → 原生投影保持 extension 与后续记录同侧（边界吸附保证），OpenAI 的 reasoning item 配对、anthropic 的 thinking block 结构都不会被切开；人工验证阶段覆盖 codex/openai-chat/anthropic 三条链路；若特定 provider 仍拒绝，按现有错误路径失败（不写坏状态），后续再针对性降级。
- [前导材料在压缩时点与上一请求存在漂移]（memory/skill/sandbox 在会话中变化）→ runtime 复用运行冻结状态与 `currentMemoryPrompt`；手动路径为 best-effort 重新解析。偏差只降低命中率，不影响正确性。
- [缓存键材料包含未发送的工具目录] → 真实会话已证实该风险（剥离工具定义时压缩请求命中仅 1.37%，普通请求 97%–99.5%）：provider 把工具定义计入 token 前缀，键一致不足以保证命中。已改为压缩摘要请求携带同源工具定义（Decisions 12）；仍命中不完整时按 provider 行为处理，客户端只能继续对齐材料。
- [摘要请求携带工具定义后模型可能尝试调用工具] → 压缩路径不执行工具、丢弃 tool call，仅取 `draft`；模型若把回合花在工具调用上，摘要为空即按既有失败路径返回（`didCompact: false`），usage 照常透出，状态不写坏。`tool_choice` / `parallel_tool_calls` 保持不发送，不主动禁调用（与官方本地压缩的 `tool_choice: "auto"` 语义一致）；若真实使用中出现调用导致的高失败率，再评估 `tool_choice: "none"` 或协议级方案。
- [usage 记账口径变化] → 压缩 turn 的 usage 将出现在 usage 账本中，可被解读为额外输出；换取缓存命中与成本的可验证性（`/usage` 可直接观察 cached tokens），与 conversation-reference 的既有记账口径一致。
- [摘要请求携带 reasoning 增加压缩耗时与 token 成本] → 与上游语义一致且跟随用户已配置 effort；压缩是低频事件；若真实使用反馈延迟过高，后续评估压缩专用 effort 配置（Open Questions）。
- [不做输出校验，接续式输出仍可能被采纳] → 请求形态（前导复用 + 尾部指令 + 原生历史）是已确认的根因修复；先以真实会话观察效果，若仍出现接续样本再据此设计宽松校验。
- [部分 provider 可能拒绝无 tools 参数的工具形态历史] → 各 adapter 的转换器本就负责工具历史重组，`isCompaction` 仅屏蔽工具定义；OpenAI Responses/Chat 原生接受该形态。
- [中文标题等非模板措辞降低摘要的格式一致性] → 摘要仅作为背景上下文注入，`/status` 展示为纯文本；内容正确性优先于格式一致性。

## Migration Plan

- 单 PR 内替换 `generateCompactionSummary` 请求构造、抽取共享前导/材料构造、扩展边界吸附、接通 usage 透出、调整四个 adapter 参数分支，并接入手动压缩路径；`RunCompactionResult` 向后兼容，调用方（runtime 两个 loop、assistant command port）同步更新。
- 无持久化格式变化，旧会话（含已存坏摘要）不迁移；坏旧摘要将在下一次成功压缩时被滚动更新覆盖。
- 回滚：revert 提交即可，无数据迁移成本。

## Open Questions

- 若真实使用中仍出现接续式摘要，宽松校验的最佳形态是什么（最小长度、非空 + 软提示）？待真实样本决定。
- 是否需要压缩专用 reasoning effort 配置（当前跟随会话配置，与上游共享语义一致）？待真实使用评估延迟后决定。
- 摘要请求超窗失败是否需要后续引入裁剪重试？当前依赖既有失败路径，待出现真实错误样本再评估。
- 摘要长度是否需要上限？现状不设限，如出现超长摘要再补约束。
- 手动 `/compact` 的材料解析是否需要在后续迭代改成「复用最近一次运行的实际前导材料快照」，以进一步降低漂移？取决于真实使用中的命中率观测。
- 压缩摘要请求是否需要在携带工具定义的基础上进一步引入 `tool_choice: "none"`？三种上游做法并存（本地压缩 `auto`、远端压缩不阻止、Guardian 采样器 `none`），取决于携带工具定义后的真实前缀命中率与工具调用发生率。

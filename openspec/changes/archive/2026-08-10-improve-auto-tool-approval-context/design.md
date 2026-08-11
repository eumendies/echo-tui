## Context

自动审批当前在本地风险分类和会话授权缓存之后，以独立 provider 请求判断一次 approval-required 调用。Reviewer 已经具备低开销基础：不装配工具、关闭 reasoning、只接受精确 `yes`、失败回退人工；主要问题是输入仍按最近 10 条 transcript 记录截取，既没有区分用户授权与不可信执行证据，也没有约束单条工具参数体积。

审批发生时当前待审批 call 尚未提交到 App transcript，但当前用户消息和此前完成的工具 pair 已经存在。Composer 提交链还可能把文件 mention、skill/workflow 指令和会话引用展开进 provider-facing `userText`，因此 reviewer 不能仅从最终 user record 推断用户亲自输入的授权文本。`ask_user_questions` 的真实用户选择则以 tool result 形式存在，需要受控地恢复为可信澄清信息。

该流程位于用户等待路径上，不能照搬完整 Guardian：不增加 reviewer 工具、模型总结、第二轮请求、备用模型或解释输出，也不引入 tokenizer 和第三方依赖。

## Goals / Non-Goals

**Goals:**

- 让 reviewer 以当前用户原始提交文本为主要授权依据，必要时用极小前序窗口消解短请求中的指代。
- 将用户授权、assistant 引用和待审批动作分区，明确只有用户输入和真实澄清答案可以建立授权。
- 为常见 approval-required 工具生成确定性、有界、保留关键目标和副作用信息的动作投影。
- 通过固定字符预算、单次请求和独立短超时控制 token、内存复制和尾延迟。
- 维持现有严格 `yes`/`no`、`allow_once`、人工回退、turn abort 和配置 revision 语义。
- 提供足够的脱敏指标来评估输入规模、时延及保守回退率。

**Non-Goals:**

- 不改变 `safe`、`approval_required`、`rejected` 风险分类或 plan/headless 策略。
- 不把 reviewer 变成可调用工具、读取文件或执行多轮调查的 agent。
- 不生成或持久化审批解释，不把 reviewer 内容写入主 transcript。
- 不新增审批缓存、自动重试、备用模型、用户可配置预算或 timeout。
- 不把模型审批宣称为 sandbox 或确定性安全保证。

## Decisions

### 1. 在 turn 入口显式保存用户原始授权文本

Composer submission 在任何 command、skill、workflow、file mention 或 conversation reference 展开前捕获用户原始输入，并沿 assistant turn 输入传给审批 resolver。普通文本请求的原始输入与 provider text 相同；发生内部展开时不再使用展开文本建立授权。

选择显式传递而不是长期依赖 `displayText || text`，因为 `displayText` 是渲染字段，缺省规则和领域语义都不足以保证它始终代表用户亲自提交的内容。现有临时“最后一条 user record”实现将在实施时被替换。

### 2. 使用确定性的微型授权窗口，而不是最近 N 条记录

审批 prompt 包含以下分区：

1. `Trusted current user request`：当前用户原始输入，最多 4,000 字符。
2. `Trusted clarification answers`：当前 turn 内成功完成的 `ask_user_questions` 问题与用户答案，合计最多 1,500 字符。
3. `Referenced prior exchange`：仅当当前原始请求不超过 240 字符时，附加当前 turn 之前最近一条 user message（最多 1,000 字符）和其后的最近一条可见 assistant message（最多 1,500 字符）。
4. `Pending action`：工具专属投影，最多 8,000 字符。

整个动态 user prompt 不超过 16,000 字符。文本截断沿 Unicode code point 边界保留头尾并插入显式 omitted marker；总预算不足时依次丢弃 assistant 引用、前序 user 引用和非关键澄清展示，不能丢弃当前请求或 pending action 的目标字段。

短请求阈值是低成本的指代代理，不做语言相关的语义分类或额外模型调用。相比始终附加前序 exchange，它降低典型自包含请求的输入；相比关键词列表，它不会漏掉新的语言和表达形式。

### 3. 只把受控解析的用户问答结果提升为可信信息

投影器从当前 user record 之后扫描相邻或可按 call id 关联的 `ask_user_questions` call/result，复用现有参数和成功结果结构校验，恢复 question、selected labels 和 custom text。取消、失败、无法匹配或无法解析的结果不进入可信区。

所有其他 tool calls/results、shell output、reasoning、系统/本地提示和 provider-private records一律不进入 reviewer prompt。这样避免工具输出挤占授权预算，并减少间接 prompt injection 面。

### 4. assistant 引用只能解析指代，不能建立授权

固定 system prompt 明确声明：当前和历史 user 输入、成功的用户澄清答案是唯一授权来源；assistant 引用只能说明“继续”“照做”“第二种”等回复所指的候选动作，不能独立扩大授权。Pending action、tool arguments 和所有非用户内容都按不可信数据处理。

Reviewer 仍只在动作明显服务于可信用户意图、目标和范围相符且副作用可合理预期时输出 `yes`；不确定时输出 `no`。

### 5. Pending action 使用工具专属有界投影

投影器返回 `exact`、`summarized` 或 `manual_only`，并始终包含 tool name、当前 cwd 和可用的 approval preview：

- `run_bash_command`：解析 JSON 后只发送完整 command。command 超过 8,000 字符或无法形成有界完整动作时标记 `manual_only`，不截断命令后请求 reviewer。
- `apply_patch`：短 patch 发送完整 patch；较大但仍在工具输入安全上限内的 patch 发送 add/update/delete 路径、文件数量、原始字符数及有界头尾 excerpt，并显式标记正文被省略。路径集合无法可靠解析、关键路径字段本身无法装入预算或输入超过工具硬上限时标记 `manual_only`。
- `edit_file`：发送 path、`replace_all`、old/new 原始长度，以及各自有界头尾 excerpt和截断标记。path 或参数结构无效时保守投影原始短参数；无法有界表达时标记 `manual_only`。
- MCP：发送 server、tool 和完整 arguments；arguments 超过 8,000 字符时标记 `manual_only`，不以截断远端 payload 做自动批准。
- 未来其他 approval-required 工具：短参数使用通用有界精确投影，超限时 `manual_only`。

`manual_only` 直接打开现有人工审批 surface，不产生无价值 provider 延迟。投影只解析已有字符串，不读取文件、不模拟 patch、不执行工具。

### 6. 保持最小输出协议并增加独立 10 秒 timeout

Reviewer 继续使用单个 system + user 请求、无工具 agent、`reasoningEffort: none` 和精确 `yes` parser。不会要求 risk、authorization 或 rationale JSON，因为这些输出会增加生成时间、解析分支和日志敏感信息压力。

每个 review 派生独立的 10 秒 abort deadline，并与 parent turn signal 组合：

- parent abort 继续作为 turn 中断向上抛出；
- reviewer deadline 只终止本次 review 并回退人工 surface；
- 不重试、不切换模型。

这限制网络或 provider 尾延迟，同时不把审批超时误当作整个 assistant turn 失败。

### 7. 只记录脱敏性能和形态指标

审批 debug 事件增加 `latencyMs`、`promptCharacters`、`actionCharacters`、上下文分区布尔值、动作投影类型以及 `yes`、`no`、`timeout`、`error`、`manual_only` 结果。继续仅记录 arguments hash，不记录用户原文、投影正文、tool arguments 或模型响应全文。Usage 账本行为保持现状。

## Risks / Trade-offs

- [短请求窗口仍可能带入无关旧对话] → 仅保留一轮、严格字符上限，并声明 assistant 不能建立授权；不确定时回退人工。
- [长而含指代的当前请求不会附加前序 exchange] → 当前请求仍是主要授权依据；避免为少量边缘情况永久增加输入，模糊时由人工确认。
- [大 patch/edit 的摘要会省略正文中的风险] → 显式标注截断，保留操作类型、全部可接受目标路径和头尾 excerpt；目标无法可靠投影时不调用 reviewer。该方案接受文件内容级风险仍可能需要人工兜底。
- [固定字符预算与实际 token 数不完全一致] → 不引入 tokenizer以保持依赖和热路径简单；16,000 字符硬上限足以消除数量级失控，debug 指标用于后续校准。
- [10 秒 timeout 对慢速本地模型偏短] → timeout 只回退人工而不拒绝或中断 turn；先通过观测验证，不提前增加配置复杂度。
- [原始用户文本需要跨提交链传递] → 使用 turn-scoped 内存字段，不持久化新 transcript 数据，也不改变 provider-visible用户记录。

## Migration Plan

1. 先用新的 turn-scoped 原始输入和投影器替换临时最后一条 user 实现，保留原 reviewer 接口的 fail-closed 行为。
2. 加入工具专属动作投影、预算和 `manual_only` 分支，再加入独立 timeout 与 debug 指标。
3. 用单元和 controller 测试覆盖信任边界、大小边界、timeout/abort 区分及 provider 最小请求。
4. 发布后通过脱敏 debug 数据观察 prompt 大小、p50/p95 latency 和人工回退原因；预算调整作为后续独立变更。

回滚时可恢复为始终人工审批，或回退到旧 reviewer 上下文投影；没有持久化格式和用户配置迁移。

## Open Questions

- 10 秒 deadline 与 240 字符短请求阈值是否适合所有常用审批模型，需要实际延迟和回退率数据验证。
- 大 patch 的路径扫描是否复用现有轻量 label parser，还是提取一个同时服务 UI 与 reviewer 的完整有界 metadata parser，应在实施时按重复度决定。

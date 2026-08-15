## Context

当前 `SubagentToolPort` 在子运行开始后把 start、稳定 reasoning summary、assistant segment、内部 tool call/result 和终态增量发布到父 runtime；TUI 会进一步把这些事实同步追加到 session journal。主 provider 构造上下文时会过滤全部 `subagent` role records，只消费最终成对提交的外层 `run_subagent` call/result。因此，成功路径可以用最终回答继续主 continuation，但非取消失败路径只返回归一化错误文本，已经完成的调查和工具结果无法被主 Agent利用。

子 provider streaming 期间的 assistant draft 只通过 transient activity callback 投影到 footer。若 provider 在最终回答完成前抛出 termination 等错误，这一草稿既不是稳定 subagent record，也不会进入外层失败结果。另一方面，内部 tool call 会在执行前发布，tool result在执行完成后发布；两者不配对时不能断言工具没有产生副作用。

本变更横跨 Subagent callback桥接、结果协议、provider-facing文本投影和测试，但不改变 provider adapter重试、主/子 loop取消、session journal schema或TUI rail协议。

## Goals / Non-Goals

**Goals:**

- 非取消子运行失败时，向主 Agent返回一份基于已有运行事实确定性生成的有界交接。
- 明确区分稳定输出、已完成工具、未完成 assistant draft和状态不明工具调用，防止主 Agent把不完整内容当作最终结论。
- 保留潜在副作用和截断事实，使主 Agent能先验证状态再继续工作。
- 让 interactive、headless、内置与自定义 Subagent复用同一交接行为。
- 保持成功结果、父级取消、Subagent本地记录过滤和外层普通工具协议不变。

**Non-Goals:**

- 不增加或调整 provider/SDK重试次数、错误可重试分类或退避策略。
- 不在失败后自动重新运行、恢复或续跑 Subagent。
- 不解决进程被强制退出后缺少外层 tool result的跨进程恢复；此时继续沿用现有 orphaned rail投影。
- 不持久化每个 streaming token、raw reasoning draft或 provider-private reasoning records。
- 不调用额外模型总结中间过程，也不把完整 `subagent` records直接发送给主 provider。

## Decisions

### 1. 在 SubagentToolPort 边界维护单次运行 accumulator

每次 `SubagentToolPort.run` 创建独立 accumulator。所有准备发布的稳定 Subagent records先进入 accumulator，再通过既有 `publishRecords` sink进入父 runtime；`onToken` 只更新 accumulator中的当前 assistant draft和既有 transient activity。进入新 provider segment、稳定提交 assistant segment或正常完成后清理对应 draft，避免把上一 segment已稳定的正文误标为未完成草稿。

选择 Port 边界是因为该层同时拥有 run identity、任务、子 callback桥接、归一化失败和外层结果返回权；它不需要反向读取 AppContext或磁盘 transcript。备选方案是在 Subagent loop抛出携带完整 `recordRegion` 的专属异常，但这会让业务 loop把本地展示/交接策略编码进异常协议，并增加 provider-private记录泄漏风险。另一个备选是失败后按 `runId` 查询父 transcript，但 headless没有 App transcript查询端口，且会把 agent层与持久化层耦合。

### 2. 用结构化快照和纯 formatter 分离事实收集与文本交接

accumulator在失败时生成 provider-neutral快照，至少包含稳定 records、最新未完成 assistant draft和遗漏统计。同一责任聚合模块中的纯函数负责配对 tool call/result、识别无结果调用、提取稳定assistant内容、在没有assistant输出或草稿时选择最近reasoning summary兜底、生成工具摘要并应用预算，最终输出provider-facing文本。accumulator与builder不拆成两个只有单向依赖的小文件，避免无收益的模块边界。

外层 `SubagentRunResult` 的失败分支仍只暴露普通 `ok: false` 与 `text`。Port catch在局部保留简洁归一化诊断：failed terminal record使用该诊断，`run_subagent` tool result的`text`使用完整handoff。这样不为仅有一个消费者的返回协议增加冗余字段，rail也不会重复展示大段交接，而主 provider及后续压缩可以消费handoff。实现 MAY 将快照保留为内部类型；本变更不要求扩展持久化 tool result details schema。

不使用额外模型生成摘要，因为触发失败的 provider可能仍不可用，额外调用会引入延迟、费用和不可重复内容。纯 formatter也便于从同一输入进行精确测试。

### 3. 使用 stable、incomplete、uncertain 三类语义

- **Stable**：已发布的 assistant segment以及存在匹配 result的内部工具调用。这些内容可以作为已完成的部分工作交给主 Agent；完整 reasoning summary只在没有assistant segment和未完成assistant draft时作为最近稳定说明兜底，避免重复过程叙述。
- **Incomplete**：当前 provider segment最后一个非空 assistant streaming draft。formatter明确标注其可能被截断、未验证且不是最终回答。raw reasoning draft不进入交接。
- **Uncertain**：存在 tool call但没有匹配 tool result的调用。formatter不得将其描述为未执行或失败，而要提示结果未知；对 `apply_patch`、`edit_file`、`run_bash_command` 和 MCP调用额外提示先检查副作用再决定是否重复。

已配对且 `ok: false` 的工具属于稳定事实而非 uncertain；其失败文本可帮助主 Agent理解子运行受阻原因。用户或父级取消不生成交接，继续按现有中断语义结束父 turn。

### 4. 使用固定字符预算和确定性优先级

failure handoff使用独立于终端宽度和模型 tokenizer的固定内部字符预算，初始实现采用约 12,000 字符的集中常量；builder不暴露预算注入或配置扩展点。预算按以下优先级消费：

1. 简洁失败原因；外层tool call/result已经表达Agent和失败状态，因此handoff不重复Agent、Status或内部runId；
2. uncertain调用和潜在副作用摘要；
3. 工具总数、完成/失败/状态不明计数及有界过程索引；
4. 最近的稳定 assistant输出；
5. 当前 incomplete assistant draft；
6. 最近工具结果的有界 evidence excerpt；
7. 仅在没有assistant输出或草稿时使用的最近reasoning summary兜底。

每个动态字段同时有局部上限，防止单个 task、参数、错误或工具输出占满总预算。若过程索引或正文被省略，交接必须保留省略数量或截断标记。对长文本采用确定性的头尾保留；工具 evidence按时间倒序选择，但最终展示仍按原发生顺序排列。

选择字符预算而非 token预算，是为了避免把 tokenizer/provider依赖引入工具结果格式化层。其代价是不同语言的实际 token占用不同，通过保守总上限和测试覆盖控制。

### 5. 工具摘要优先使用已有结构化 details

formatter不复用终端 renderer，也不生成ANSI。`apply_patch`/`edit_file`优先从 `details.display.files`提取有界文件路径和 added/updated/deleted事实；Bash摘要保留有界 command、exit code、timeout/truncated状态和输出片段；grep/glob/read_files/web保留有界参数标签、结果状态和必要 evidence；附件只投影路径、媒体类型和大小，不复制base64。未知和MCP工具使用通用名称、参数片段和结果片段。

所有动态工具输出和 partial draft均作为观察内容而不是新系统指令呈现。不完整草稿在标题中直接标记为unverified，状态不明的副作用调用在对应条目旁提示验证；正文末尾只保留一句“作为部分进展而非最终答案使用”，不追加独立continuation notes区。

### 6. 只改变非取消失败的外层正文

成功时外层 result仍只返回子 Agent最终回答。参数/目录/预算等尚未启动子 runtime的拒绝仍返回现有简短失败，不构造空交接。子 runtime启动后发生的非取消错误才生成 failure handoff。TUI和headless共享同一 Port结果；即使没有 app观察callback，父 runtime内部已发布的稳定 records仍进入 accumulator并可用于交接。

## Risks / Trade-offs

- [Risk] incomplete draft可能包含半句、错误结论或未闭合Markdown。 → 明确标注为未完成且未验证，限制长度，不把它写成稳定 Subagent record或最终回答。
- [Risk] 工具结果可能很大并显著增加主上下文。 → 采用总预算、字段局部预算、过程计数、工具专属摘要和显式截断标记。
- [Risk] 动态文件/Web/MCP输出可能包含提示注入文本。 → 保持tool result角色边界和固定本地格式，把动态内容限制在缩进观察片段内；不允许动态内容控制交接结构。
- [Risk] 仅凭 tool name无法准确判断 Bash/MCP是否产生副作用。 → 对状态不明的 Bash/MCP采取保守提示，不声明已执行或未执行；对已配对结果只陈述可确认的exit/status事实。
- [Risk] accumulator与已发布 transcript顺序不一致会生成错误交接。 → 使用同一个“记录后发布”入口，并为顺序、工具配对和callback边界编写测试。
- [Risk] 进程硬崩溃时无法进入catch生成交接。 → 明确不在本变更解决；已稳定 records仍由journal保留并按现有意外中断投影恢复。
- [Trade-off] failure tool result比当前单行错误更长。 → 只在子 runtime已经产生可交接过程时扩展正文；无进展失败保持短格式，并用固定预算限制最坏情况。

## Migration Plan

该变更不修改用户配置、Subagent定义文件或journal schema，无需数据迁移。发布后新发生的非取消失败将写入较丰富的外层 tool result；旧 session继续按原始文本恢复。回滚时可恢复为仅返回 `errorText`，既有较长失败结果仍是合法普通 tool result并可被当前 transcript converter读取。

## Open Questions

- 初始字符预算和各分区上限是否需要在真实长任务中调优；第一版保持内部常量，不暴露配置项。
- 对 `use_skill`、MCP等通用工具是否值得后续增加更精确的摘要器；第一版使用通用有界投影即可。

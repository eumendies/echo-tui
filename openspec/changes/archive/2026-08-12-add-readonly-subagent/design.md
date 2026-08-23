## Context

当前 provider-neutral agent loop 已统一负责模型装配、system context、tool continuation、压缩、审批、取消和 usage；`BtwConversationController` 也证明同一个 `RunAgent` 可以承载隔离的 side run。但现有 `toolPolicy: readonly` 只在执行阶段拒绝副作用调用，provider 仍能看到完整工具 schema；现有 app turn 又只追踪一个 pending tool call，并在结果到达时才把 call/result 成对写入主 transcript。这些约束要求普通 `run_subagent` ToolHandler 通过窄 Port 获得本轮运行能力，并要求工具执行边界支持过程事件与延迟成对提交；不能让 handler 直接依赖 `AppContext`，也不能直接复用 BTW controller。

本变更跨越 agent runtime、工具目录、安全审批、transcript schema/journal、上下文压缩和终端渲染。设计必须同时维持以下不变量：

- 主 provider 只消费外层 `run_subagent` call/result，不消费子 Agent内部过程。
- runtime `recordRegion` 与 app 持久化 records 的物理索引继续一致，保证 compaction 和 undo 边界可靠。
- 外层工具协议不在进程崩溃后留下孤立 tool call。
- 子 Agent工具 schema 和本地执行边界都实施同一 allowlist。
- 正常 redraw 继续使用 ANSI、stdin raw mode 和 app-owned region，不进入 alternate screen。

## Goals / Non-Goals

**Goals:**

- 提供一个同步 `run_subagent` 工具和一个内置 `explorer` 定义。
- 让子 Agent使用独立 system prompt、隔离 transcript 和裁剪后的只读工具 registry。
- 对无法证明只读的子 Agent Bash 实施固定策略：交互环境复用主 Agent 审批流程和会话授权缓存，headless fail-closed，不继承父级 interaction mode。
- 实时展示并增量持久化子 Agent稳定过程，同时从主 provider、压缩摘要和引用素材中过滤。
- 使用外层连续 rail 嵌套现有工具 renderer，并在 resume、resize 和异常中断后稳定重绘。
- 传播父级取消并用父 turn/run identity 隔离迟到 callback。

**Non-Goals:**

- 不支持并行或后台子 Agent、任务队列、独立 tab 或多 Agent调度器。
- 不支持可配置 `.echo/agents/*.md`、用户自定义 Agent目录或运行时 Agent选择；第一版 prompt 和工具集内置。
- 不向子 Agent暴露文件编辑、MCP、用户提问、Todo 或再次委派工具。
- 不提供强 shell sandbox；人工批准的 Bash 仍可能修改工作区或系统状态。
- 不持久化可恢复执行栈；恢复只重绘已发生过程，不自动续跑中断的子 Agent。
- 不为子 Agent创建独立 session journal、独立 change checkpoint 或独立 `/resume` 候选。

## Decisions

### 1. 使用普通 ToolHandler，并通过窄 SubagentToolPort 注入运行能力

默认父 registry 注册由 `createRunSubagentToolHandler` 创建的普通 handler，使 `run_subagent` 与其他工具一样经过 `ToolRegistry → ToolExecutor → ToolHandler`。Handler从窄 `SubagentToolPort.listDefinitions()`动态生成必填 `agent` enum和 name/description目录，负责参数校验、调用 `SubagentToolPort.run(agentName, task, ...)`，并把成功或失败映射为现有 `ToolExecutionResult`；顶层工具描述只说明通用委派语义，不堆叠具体子 Agent说明。Handler不按工具名绕过 executor，也不直接访问定义实现、`AppContext`、renderer、transcript store或 provider adapter。

`SubagentToolPort` 是 run-scoped 领域端口，由父 agent runtime 在构造本轮 registry 时实现并注入。端口列出当前内置定义的 name/description，并在执行时按名称解析完整定义；内部拥有父 run已捕获的配置、cwd、abort signal、change recorder、委派预算、父 record sink、父 callbacks和子 runtime factory。TUI能力只通过 callbacks观察，headless缺少观察 callback时保持 no-op。每次合法委派都把所选定义交给 factory创建新的子 agent loop runtime，再通过专属 `SubagentLoopInput`和callbacks交付隔离运行；端口不递归调用父 runtime实例。该结构复用 command port的依赖倒置方式，但端口在 agent runtime层装配，因为 headless路径没有 `AppContext`，且子 provider continuation与父 `recordRegion`不属于 app状态。

为了避免 runtime 按 `run_subagent` 名称分支，工具执行协议增加通用的本地过程事件 sink 和 transcript commit mode。普通工具继续使用 `call_before_execute`；会在执行期间发布本地 records 的 handler声明 `pair_after_execute`。`run_subagent` handler通过端口把 subagent records同步追加到 runtime `recordRegion` 和 app transcript，结束后 executor再让外层 tool call/result成对追加到两侧。这样两侧顺序和索引一致，同时崩溃时不会持久化孤立外层 call。未来其他长任务工具也可复用该提交模式，而无需新增工具名分支。

### 2. 主 Agent与子 Agent使用同包独立 runtime

建立可枚举的内置子 Agent定义目录；每个定义包含 name、description、system prompt section和允许工具名集合。Description由主工具 schema动态投影，prompt与 allowlist由所选定义传给新建的子 runtime，三者不在 handler或 runtime中重复硬编码。运行 metadata通过专属子运行输入交付身份；专属 prompt、工具 allowlist和 MCP禁用由子 runtime创建边界固定，不允许由普通主 session输入覆盖。第一版目录仅包含 `explorer`。

父 runtime 在执行委派前冻结当前 AGENTS 指令、system prompt override、memory 和有界 skill catalog，runtime factory 把该快照复制进新子 runtime。子 runtime 使用父配置 revision和 cwd，模型 profile默认沿用父 run 已解析选择；其 records只包含一条结构化委派任务，todo、compaction、session journal path均为空。父子共享配置 snapshot、hooks、debug 和 usage store 等进程级服务，但不共享 runtime 实例、业务 loop、provider continuation、record region、compaction或 registry实例；子 runtime创建时不注入 MCP manager和再次委派 Port。第一版不做文件级 Agent配置，以缩小配置校验、热加载和优先级范围。

两个 runtime 放在同一 `loop-runtime` 包中：主 runtime负责完整会话、Todo、用户提问、MCP、普通审批、委派端口和主 transcript callback；子 runtime负责隔离任务、只读工具策略、人工升级、子运行 callback和自身 continuation。二者各自保留清晰的 `while` loop 与 hook/callback 提交顺序，不通过 `runtimeOptions.kind`、策略 callback集合或通用模板方法切换角色。只把不判断运行角色、不持有跨轮状态且输入输出完整的函数放入共享模块，例如 provider records构造、usage调试投影和工具结果截断事实提取。允许两个业务 loop保留少量结构重复，以免把未来不同的 hook、callback、并行和错误语义重新耦合到一个可配置 loop。

子 runtime使用专属 `SubagentLoopInput`、`SubagentLoopCallbacks` 和 `RunSubagentAgent`，而不是接收完整 `AgentSessionInput` / `AgentCallbacks`。这样隔离 transcript、空 Todo、无 journal、无再次委派和不暴露主 callback均由类型边界表达；`SubagentToolPort` 仍负责把专属 callback翻译成父 transcript稳定事件和 TUI瞬时活动。

### 3. Provider-visible registry 在装配阶段裁剪，执行阶段再次校验

`prepareAgent` 和默认 registry factory 增加运行工具集合与 run-scoped tool services 选项。父 run 使用现有完整 registry、注入本轮 `SubagentToolPort` 并额外创建 `run_subagent` handler；子 run只构造以下 handlers/definitions：

```text
read_files, glob, grep, run_bash_command,
web_fetch, web_search, use_skill
```

不先创建再仅过滤 definitions，因为 executor 仍可能找到未授权 handler；registry 本身只包含 allowlist handlers。Subagent policy 在普通 executor 调用 handler前再检查工具名，形成 schema 与执行两层边界。MCP manager 可以继续由共享 runtime持有，但子 registry不合并 MCP definitions/handlers，也不注入可再次委派的 `SubagentToolPort`。

### 4. Bash 采用严格 allowlist + 共享审批流程

子 Agent复用 `isPlanReadonlyBashCommand` 作为“可直接执行”的证明边界。命中时走普通 Bash executor；未命中时采用不受父级 interaction mode影响的固定规则：

- interactive：生成带 subagent origin 的普通 approval request，由 App 先查询与主 Agent 共用的 allow-all、tool 或精确 Bash command 会话缓存，未命中时再进入同一 manual/auto 流程；
- headless：返回无法取得人工审批的失败结果，即使父命令使用 `--full-access` 也不放行。

审批 callback只增加受信任的本地 origin 元数据，用于 surface 标题和迟到请求隔离，不改变授权语义。`ToolApprovalContext` 不按主 Agent或子 Agent分区缓存；任一来源产生的 allow-all、tool或精确 Bash command会话授权都可被另一来源复用。人工 surface使用现有完整选项，Feedback仍作为拒绝 tool result返回当前 Agent。批准后的未知 Bash复用父 turn的 change recorder，因此现有 Bash handler会在无法追踪时使本轮 `/undo` checkpoint失效。

选择严格 allowlist 而不是现有 normal-mode 风险黑名单，是因为 Node/Python 脚本、构建命令和复杂 shell 可以绕过关键词模式。代价是部分实际只读命令也会请求人工审批。

### 5. 子 Agent过程使用一等 `subagent` transcript role

新增 `SubagentTranscriptRecord`，使用公共身份字段 `runId`、`parentToolCallId`、`agentName` 和判别式 event payload。Tool call/result event 保留现有 provider-neutral 工具字段和 display metadata；reasoning/assistant event 只保存已经完成的可见文本；start保存任务摘要，终态保存状态和耗时。最终报告只写入 assistant event和外层 tool result，completed record不重复携带正文。

不把这些事件伪装成普通 assistant/tool records，因为普通 roles 默认具有主 provider协议语义，任何漏过滤都可能把内部 call id 或子 Agent指令发送给主模型。也不使用 `extension.unknown`，因为 extension 是 provider-private 扩展边界，不能清晰表达本地 UI 和恢复契约。

子 runtime保留自己的完整 continuation records；`SubagentToolPort` 桥接到主 transcript 时只镜像稳定、可见、provider-neutral 的事件，不镜像加密 reasoning、Anthropic thinking signature 或 token 增量。每个镜像事件先写端口持有的父 runtime record sink，再通过 `onSubagentRecords` callback 交给 app；只有 callback 仍属于当前父 turn/run 时 app 才持久化。

### 6. 在统一 provider-context 边界过滤 subagent records

`shouldIncludeRecordInProviderContext` 将 `subagent` 视为 non-provider role。主 `buildProviderRecords` 在交给 provider adapter 前先过滤，避免本地 role 插在 assistant/tool continuation 中影响各 adapter 的协议状态机；OpenAI Responses、OpenAI Chat、Anthropic 和其他 transcript converters仍增加防御性跳过测试。Conversation reference material、token估算和压缩摘要输入复用同一语义。

自动压缩阈值按 provider-facing records 估算。强制压缩的“保留最近 K 条”需要按可发送记录计数，再映射回物理 records 索引，避免大量 subagent UI records把仍有价值的主对话挤出活跃区间；映射后继续保护外层 tool call/result 配对。完整 subagent records始终留在 journal和可见 transcript中，activeStartIndex只影响 provider投影。

### 7. App 使用独立 SubagentRunContext 管理 transient 状态

新增 app state context 管理当前同步子运行的 run identity、agent name、task 摘要、阶段、elapsed anchor、reasoning/assistant draft和当前内部 tool preview。它不拥有 provider continuation，也不创建独立 transcript session。

`assistant-turn-runner` 将 runtime 的 subagent callbacks翻译为：

- stable event：验证父 turn/run identity，append journal record，清理 footer并增量渲染；
- token/reasoning draft：只更新 transient pending；
- internal tool call：更新 pending工具摘要；
- internal tool result：成对追加 subagent工具事件；
- complete/error/cancel：追加终态并清空 transient状态。

父 `TurnContext.pendingToolCall` 继续只持有外层 `run_subagent` call，不被内部工具覆盖。父 abort后 context立即失效，迟到 callback被丢弃。

### 8. 使用可组合的外层 rail 包装现有工具行 renderer

从 Bash renderer中提炼通用 rail row primitive，并从 `tool-message-renderer` 暴露不带 block尾部空行的 `renderToolRecordLines` / `renderToolPairLines`。Subagent renderer先为内部内容计算 `innerWidth = safeWidth - outerPrefixWidth`，调用现有工具专属行 renderer，再为每个物理行添加外层 rail。这样 read_files、grep、glob、Bash、Web和 use_skill继续共享原参数解析、结构、状态文本和显示预算。

嵌套调用使用专属 muted tone覆盖：内部工具 renderer的 marker、标题、rail、命令、stdout、stderr和结果正文统一映射到当前主题的 `toolOutput` 暗色，不使用 `toolSuccess`、`toolError`、普通正文色或其他彩色强调。失败、退出码、超时和截断仍通过文字保留，不依赖颜色表达。Tone覆盖应在语义样式选择阶段完成，不在最终 ANSI字符串上做脆弱的颜色剥离；顶层普通工具继续保持现有彩色状态投影。

实时 append时，每个 subagent event独立产生兼容的 rail片段；完整重绘时 `groupTranscriptRecords` 把同一 runId 的连续 records聚合为 `subagent_run` block，并根据终态补充完整状态。外层 start标题使用中性文案，避免已经进入 scrollback 的“running”状态无法原地改色；完成状态由末行表达。

宽度不足以容纳双层前缀时，renderer降级为单层标题和缩进内容。外层 `run_subagent` tool pair仍保留原始 result，但专属 renderer在已有对应 subagent run时隐藏重复正文，只显示紧凑返回状态或空投影。

### 9. Journal 使用现有 append_records，不提前持久化执行栈

Journal schema version保持现状，validator新增严格 subagent event校验。每个稳定事件通过普通 `append_records` 立即落盘；旧 session无需迁移。Resume replay后，renderer按 runId重建 rail；只有 start没有终态时派生“意外中断”显示，不修改 journal，也不自动续跑。

单独子 Agent journal方案会增加跨文件一致性、fork/reference路径和清理问题，因此不采用。把整个过程等到结束后一次写入又无法满足崩溃恢复和实时审计，因此采用主 journal增量事件。

## Risks / Trade-offs

- [获批的 Bash 仍可能写入任意状态] → 明确称为受控只读；未知命令必须经过共享审批流程，会话缓存仍按现有精确 Bash command语义匹配，并沿用 change history失效保护。
- [新增本地 records导致 runtime/app压缩索引偏移] → Handler声明通用 `pair_after_execute` commit mode，子事件通过 Port持有的共享 record sink同时追加两侧，外层 call/result在子运行后成对追加；增加索引一致性测试。
- [ToolHandler 获得过宽的 app 权限或形成层级循环] → Handler只依赖 `SubagentToolPort` 接口；端口由父 agent runtime按 run装配并仅通过 callbacks连接 app，`src/tools/` 不导入 `AppContext`；每次委派由 factory 创建专属子 runtime，避免父 `RunAgent` 形成自递归协议。
- [两个 runtime复制过多或共享层再次演变成隐式模板 runtime] → 只提取无角色语义的纯函数和数据投影；主/子 loop、工具执行、hook与callback顺序分别保留在各自入口，并以禁止 `runtimeOptions.kind` 分支和专属子 callback类型的测试约束边界。
- [大量子 Agent过程增大 journal和恢复成本] → 不保存 token或私有 reasoning，工具结果继续使用现有截断/offload；session preview可投影紧凑子运行摘要。
- [嵌套 rail在窄终端不可读] → 先扣除前缀宽度，复用 grapheme/ANSI安全布局；低于阈值时扁平降级。
- [通用 rail提炼或 muted tone影响现有顶层工具外观] → tone只由subagent嵌套调用显式启用；保留顶层Bash纯函数renderer契约和现有测试，新增等价输出与自定义主题回归测试。
- [父 provider一次返回多个工具调用时顺序复杂] → 子 Agent仍同步执行；每个 `run_subagent`完成后再处理下一个 tool call，按 provider返回顺序生成结果。
- [旧版本程序无法识别新 transcript role] → 新版本可读取全部旧 journal；包含 subagent role的新 journal不保证被旧二进制恢复，rollback时需使用升级版本或清除受影响会话索引后重新升级。
- [子 Agent模型循环或成本失控] → 子 Agent沿用主 Agent相同的 continuation 语义和用户取消边界，不增加专属 provider turn 上限；仍通过每父 run四次委派和禁止递归委派限制扇出。

## Migration Plan

1. 先加入 transcript类型、validator和 provider过滤，确保新本地 role即使出现也不会进入模型上下文。
2. 加入 registry裁剪、内置 explorer定义、普通 `run_subagent` handler、run-scoped Port、Bash policy和嵌套执行，并以无 UI callback的测试验证结果协议。
3. 加入 app SubagentRunContext、journal增量桥接和取消隔离。
4. 提炼 rail primitive并加入 subagent transcript/footer renderer，验证 live append、resume和resize。
5. 运行完整自动验证并由用户执行交互式 TUI检查。

Rollback 不需要迁移旧 session；回退代码前应注意旧二进制无法恢复包含新 role的 journal。实现若需安全回滚，可先禁用 `run_subagent` definition，保留新 role读取和过滤能力。

## Open Questions

无。可配置 Agent文件、并行调度和写入型子 Agent留待后续独立变更。

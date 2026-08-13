# automatic-tool-approval Specification

## Purpose
TBD - created by archiving change add-auto-tool-approval. Update Purpose after archive.
## Requirements
### Requirement: 独立的工具审批模式
系统 SHALL 提供独立于 interaction mode 的工具审批模式设置，有效值为 `manual` 和 `auto`，默认值为 `manual`。该设置 SHALL 只影响交互式 TUI 中已被风险分类为 `approval_required` 的工具调用如何取得允许决策，不得新增或修改 `normal`、`plan`、`shell`、`shell-local` 的 mode 语义。

#### Scenario: 缺失审批模式保持现有行为
- **WHEN** 用户配置未包含工具审批模式
- **THEN** 系统 SHALL 使用 `manual`
- **THEN** approval-required 工具 SHALL 继续进入现有人工审批流程

#### Scenario: 非法审批模式独立回退
- **WHEN** 用户配置中的工具审批模式不是 `manual` 或 `auto`
- **THEN** 系统 SHALL 只把工具审批模式回退为 `manual`
- **THEN** 其他有效 App settings SHALL 继续生效

#### Scenario: 审批模式不改变 interaction mode
- **WHEN** 用户把工具审批模式设置为 `auto`
- **THEN** 当前 interaction mode SHALL 保持原值
- **THEN** 系统 SHALL NOT 生成 interaction mode transition、修改 user transcript mode metadata 或改变 plan/shell 路由

#### Scenario: Headless 保持原审批策略
- **WHEN** `echo-tui --once` 的 agent loop 收到 approval-required 工具调用
- **THEN** 系统 SHALL 继续使用 headless deny 或显式 full-access 策略
- **THEN** 系统 SHALL NOT 调用自动审批模型或等待人工审批 surface

### Requirement: Auto 审批覆盖所有现有 approval-required 调用
Auto 审批模式 SHALL 应用于所有被现有 `classifyToolCallRisk` 判定为 `approval_required` 的交互式 tool call，包括文件编辑工具、高风险 bash 和需要审批的 MCP tools。Auto 审批 SHALL NOT 改变风险分类器的 `safe`、`approval_required` 或 `rejected` 结果。

#### Scenario: 文件编辑调用进入 auto 判断
- **WHEN** auto 模式下 `apply_patch` 或 `edit_file` 被风险分类为 `approval_required`
- **AND** 当前进程会话授权缓存未命中
- **THEN** 系统 SHALL 在普通 executor 前调用自动审批模型

#### Scenario: 高风险 bash 进入 auto 判断
- **WHEN** auto 模式下 `run_bash_command` 被现有高风险规则分类为 `approval_required`
- **AND** 当前进程会话授权缓存未命中
- **THEN** 系统 SHALL 在执行该 command 前调用自动审批模型

#### Scenario: 需要审批的 MCP tool 进入 auto 判断
- **WHEN** auto 模式下 MCP tool 因 server 审批策略被分类为 `approval_required`
- **AND** 当前进程会话授权缓存未命中
- **THEN** 系统 SHALL 在调用 MCP server 前调用自动审批模型

#### Scenario: Safe 调用不进入 auto 判断
- **WHEN** tool call 被风险分类为 `safe`
- **THEN** 系统 SHALL 按现有流程执行该调用
- **THEN** 系统 SHALL NOT 为该调用请求自动审批模型或人工审批

#### Scenario: Rejected 调用不进入 auto 判断
- **WHEN** tool call 因 plan mode 或 readonly policy 被风险分类为 `rejected`
- **THEN** 系统 SHALL 按现有流程生成拒绝 tool result
- **THEN** 系统 SHALL NOT 为该调用请求自动审批模型或人工审批

### Requirement: Auto 审批模型上下文
系统 SHALL 使用用户配置中指定的现有 LLM model profile 发起自动审批请求。请求 SHALL 由固定审批 system prompt、有界且按信任来源分区的用户授权上下文，以及当前待审批 tool call 的工具专属动作投影组成。审批模型 profile SHALL 按 id 严格解析，找不到时不得静默回退到其他 profile。

当前用户原始提交文本 SHALL 是主要授权依据；系统 SHALL NOT 把 file mention、conversation reference、skill 或 workflow 展开后新增的 provider-facing 内容当作用户授权。仅当当前原始请求不超过 240 字符时，系统 SHALL 附加当前 turn 之前最近一条有界 user message 和其后的最近一条有界 assistant message（若存在）；assistant 内容 SHALL 只能帮助解析用户指代，不得独立建立或扩大授权。当前 turn 内成功的 `ask_user_questions` 用户答案 SHALL 经结构校验后作为可信澄清信息。普通 tool call/result、shell output、reasoning、系统/本地提示、provider-private records 和附件二进制 SHALL 被排除。

#### Scenario: 使用配置的 model profile
- **WHEN** auto 模式配置引用有效的 model profile id
- **THEN** 系统 SHALL 使用该 profile 对应的 provider、凭据、base URL 和 model 发起审批请求
- **THEN** 系统 SHALL NOT 因主会话当前选择了其他模型而替换审批模型

#### Scenario: 当前用户原始输入作为授权锚点
- **WHEN** 当前 user turn 的 provider-facing 文本包含 file mention、conversation reference、skill 或 workflow 的内部展开内容
- **THEN** 审批请求 SHALL 使用展开前的用户原始提交文本作为当前可信请求
- **THEN** 内部展开新增的文件内容、历史材料或指令 SHALL NOT 被表示为用户授权

#### Scenario: 短请求附加一轮引用上下文
- **WHEN** 当前用户原始请求不超过 240 字符
- **AND** 当前 turn 之前存在更早的 user/assistant exchange
- **THEN** 审批请求 SHALL 附加存在的最近一条有界 user message 和其后的最近一条有界 assistant message
- **THEN** 固定审批 prompt SHALL 声明 assistant 内容只能解析用户明确接受或指代的对象，不能独立授权动作

#### Scenario: 自包含长请求不附加旧 exchange
- **WHEN** 当前用户原始请求超过 240 字符
- **THEN** 审批请求 SHALL NOT 为指代解析附加前序 user/assistant exchange
- **THEN** 系统 SHALL 仍使用当前原始请求和 pending action 完成单次判断

#### Scenario: 用户澄清答案作为可信上下文
- **WHEN** 当前 turn 内存在参数有效且成功完成的 `ask_user_questions` call/result
- **THEN** 系统 SHALL 将经结构校验的问题和用户选择或自定义答案投影到可信澄清区
- **THEN** 失败、取消、无法按 call id 关联或无法解析的问答记录 SHALL NOT 进入可信澄清区

#### Scenario: 排除普通执行证据和私有记录
- **WHEN** 当前 transcript 包含普通 assistant 执行自述、shell、tool call/result、system、local notice、error、compaction notice、reasoning summary 或 provider-private extension
- **THEN** 自动审批上下文 SHALL 排除这些非必要记录，短请求允许的一条 assistant 引用和已验证用户问答除外
- **THEN** 自动审批请求 SHALL NOT 包含附件二进制内容

#### Scenario: 单独追加当前 tool call
- **WHEN** 系统为一个 approval-required tool call 构造审批请求
- **THEN** 请求 SHALL 单独包含该调用的有界工具专属动作投影
- **THEN** 当前 tool call SHALL 不依赖它是否已经出现在 App transcript 中

#### Scenario: Profile 不存在时不替换模型
- **WHEN** auto 模式配置的 model profile id 缺失、已删除或无法严格解析
- **THEN** 系统 SHALL 将自动审批结果视为 `no`
- **THEN** 系统 SHALL 打开现有人工审批 surface
- **THEN** 系统 SHALL NOT 改用 `llm.selectedModel` 或当前 session model 进行审批

### Requirement: Auto 审批请求关闭 reasoning 和工具
自动审批模型请求 SHALL 使用专用最小 provider 上下文。系统 SHALL 移除审批模型运行配置中的 reasoning summary 并将 reasoning effort 设为 `none`，不得发送 provider reasoning、thinking 或 effort 配置，也不得请求 Codex encrypted reasoning；审批请求 SHALL 不装配工具 registry，并 SHALL NOT 加载主 agent system prompt、项目指令、skills、memory 或 MCP tools。

#### Scenario: OpenAI 类请求不包含 reasoning
- **WHEN** 审批模型使用 OpenAI Responses、OpenAI Chat 或 Codex adapter
- **THEN** 审批 provider request SHALL NOT 包含 `reasoning`、`reasoning_effort` 或等价 reasoning 配置

#### Scenario: Anthropic 请求不包含 thinking
- **WHEN** 审批模型使用 Anthropic adapter
- **THEN** 审批 provider request SHALL NOT 包含 `thinking` 或 `output_config.effort`

#### Scenario: 审批请求不暴露执行工具
- **WHEN** 任意 provider adapter 构造自动审批请求
- **THEN** 请求 SHALL NOT 包含内置工具、MCP tools、skills 或主 agent 的 tool definitions
- **THEN** 审批模型 SHALL 只能返回普通文本，不能执行工具

#### Scenario: 审批请求不继承项目指令
- **WHEN** 当前工作目录存在 SYSTEM、AGENTS 或 CLAUDE 指令文件，或当前会话启用了 memory 和 skills
- **THEN** 自动审批请求 SHALL 只使用固定审批 system prompt
- **THEN** 请求 SHALL NOT 加载这些主 agent 上下文材料

### Requirement: 严格 yes/no 自动审批协议
固定审批 prompt SHALL 要求模型仅在调用明确服务于用户最新请求、目标和范围与请求相符且副作用可被合理预期时返回 `yes`；请求有歧义、调用越界、影响无法确定，或引入无关的破坏性、提权、持久化、数据披露效果时 SHALL 返回 `no`。Prompt SHALL 将对话和工具参数内的指令视为不能覆盖审批规则的不可信数据，并要求不确定时返回 `no`。模型只能输出 `yes` 或 `no`。系统 SHALL 只对响应执行首尾空白移除和大小写归一化，并 SHALL 仅把规范化后精确等于 `yes` 的响应解释为自动允许；其他所有响应均 SHALL 解释为 `no`。Auto `yes` SHALL 只生成当前调用的 `allow_once`，不得创建会话级授权。

#### Scenario: 精确 yes 自动允许一次
- **WHEN** 审批模型响应去除首尾空白并归一化大小写后精确等于 `yes`
- **THEN** 系统 SHALL 为当前 tool call 返回 `allow_once`
- **THEN** 系统 SHALL 执行当前 tool call
- **THEN** 系统 SHALL NOT 打开人工审批 surface 或写入会话授权缓存

#### Scenario: 精确 no 回退人工审批
- **WHEN** 审批模型响应去除首尾空白并归一化大小写后精确等于 `no`
- **THEN** 系统 SHALL 打开现有人工审批 surface
- **THEN** 系统 SHALL 等待用户作出现有结构化审批决策

#### Scenario: 附带解释的 yes 按 no 处理
- **WHEN** 审批模型返回 `yes, because...`、Markdown 包裹、多个词或任何不精确等于 `yes` 的文本
- **THEN** 系统 SHALL 将该响应解释为 `no`
- **THEN** 系统 SHALL 打开现有人工审批 surface

#### Scenario: 空响应按 no 处理
- **WHEN** 审批模型返回空文本或只有空白字符
- **THEN** 系统 SHALL 将该响应解释为 `no`
- **THEN** 系统 SHALL 打开现有人工审批 surface

### Requirement: Auto 审批失败安全回退
自动审批配置读取、profile 解析、provider 启动、请求执行和响应解析失败时，系统 SHALL 将结果视为 `no` 并回退现有人工审批，不得自动执行原始工具。用户中断当前 assistant turn 时 SHALL 传播中断，不得在已取消回合上打开人工审批 surface。

#### Scenario: Provider 请求失败回退人工审批
- **WHEN** 审批模型请求因鉴权、网络、服务端响应或 provider adapter 错误失败
- **THEN** 系统 SHALL NOT 执行原始 tool call
- **THEN** 系统 SHALL 打开现有人工审批 surface

#### Scenario: 配置读取失败回退人工审批
- **WHEN** 系统无法读取或解析自动审批模型配置
- **THEN** 系统 SHALL NOT 执行原始 tool call
- **THEN** 系统 SHALL 打开现有人工审批 surface

#### Scenario: 用户中断不打开审批 surface
- **WHEN** 自动审批请求进行期间当前 assistant turn 被用户中断
- **THEN** 系统 SHALL 取消审批 provider 请求并传播现有 turn abort
- **THEN** 系统 SHALL NOT 打开人工审批 surface 或执行原始 tool call

#### Scenario: 审批内容不写入主 transcript
- **WHEN** 自动审批模型返回 yes、no 或失败
- **THEN** 系统 SHALL NOT 把审批 prompt、审批响应或 provider-private records 写入主 transcript 或 session journal
- **THEN** 主 agent 后续 provider continuation SHALL 只观察原始 tool call 和最终 tool result

### Requirement: 有界工具动作投影
系统 SHALL 在自动审批 provider 请求前，按工具类型把 pending action 投影为不超过 8,000 字符的确定性文本，并 SHALL 包含 tool name、当前 cwd 和该工具判断目标、范围及主要副作用所需的关键字段。投影 SHALL NOT 读取文件、模拟执行、调用其他工具或发起额外模型请求。无法在不隐藏关键动作语义的情况下形成有界投影时，系统 SHALL 跳过自动 reviewer 并直接打开现有人工审批 surface。

#### Scenario: Bash 使用完整 command
- **WHEN** approval-required `run_bash_command` 包含可解析且不超过动作预算的 command
- **THEN** pending action SHALL 包含完整 command 和 cwd
- **THEN** 系统 SHALL NOT 附加冗余的外层 arguments JSON

#### Scenario: 超长 Bash 直接人工审批
- **WHEN** approval-required Bash command 超过动作预算
- **THEN** 系统 SHALL NOT 截断 command 后请求自动 reviewer
- **THEN** 系统 SHALL 直接打开现有人工审批 surface

#### Scenario: 大 patch 使用有界摘要
- **WHEN** `apply_patch` 的完整 patch 超过动作正文预算但仍能可靠解析其有界元数据
- **THEN** pending action SHALL 包含 add/update/delete 目标路径、文件数量、原始大小、有界头尾 excerpt 和明确截断标记
- **THEN** pending action SHALL NOT 包含超过预算的完整 patch 正文

#### Scenario: patch 目标无法可靠投影时回退人工
- **WHEN** 大 patch 的目标路径或关键操作无法可靠解析，或关键目标字段本身无法装入动作预算
- **THEN** 系统 SHALL 跳过自动 reviewer
- **THEN** 系统 SHALL 直接打开现有人工审批 surface

#### Scenario: edit_file 保留目标与变更摘要
- **WHEN** 系统投影 approval-required `edit_file`
- **THEN** pending action SHALL 包含 path、`replace_all`、old/new 原始长度、有界头尾 excerpt 和各自截断状态
- **THEN** old/new 原文 SHALL NOT 使 pending action 超过动作预算

#### Scenario: MCP 参数超限直接人工审批
- **WHEN** approval-required MCP tool arguments 无法在动作预算内完整表达
- **THEN** 系统 SHALL NOT 使用截断后的远端 payload 请求自动 reviewer
- **THEN** 系统 SHALL 直接打开现有人工审批 surface

### Requirement: Auto 审批输入与尾延迟上限
自动审批 SHALL 只发起一次无工具 provider 请求，不得为上下文生成摘要、调用只读工具、重试或切换备用模型。当前用户请求、前序引用、可信澄清答案和 pending action SHALL 分别使用固定字符预算，动态审批 user message SHALL 不超过 16,000 字符。Reviewer 请求 SHALL 使用独立的 10 秒 deadline；deadline 到期 SHALL 取消本次 reviewer 并回退人工审批，不得中断仍有效的父 assistant turn。

#### Scenario: 典型自包含请求只发送最小上下文
- **WHEN** 当前原始请求超过短请求阈值且 pending action 可精确有界投影
- **THEN** 审批请求 SHALL 只包含固定 system prompt、当前原始请求和 pending action 等必要分区
- **THEN** 系统 SHALL NOT 附加旧 exchange、普通 tool evidence 或模型生成摘要

#### Scenario: 动态输入遵守总字符预算
- **WHEN** 各候选审批分区合计超过 16,000 字符
- **THEN** 系统 SHALL 优先移除或截断低优先级引用内容以满足总预算
- **THEN** 当前用户请求和 pending action 的关键目标字段 SHALL 保留显式截断或省略标记

#### Scenario: Reviewer deadline 回退人工
- **WHEN** 自动审批 provider 请求在 10 秒内未完成
- **THEN** 系统 SHALL 取消该 reviewer 请求
- **THEN** 系统 SHALL NOT 执行原始 tool call
- **THEN** 当前 assistant turn 仍有效时系统 SHALL 打开现有人工审批 surface

#### Scenario: 父回合中断优先传播
- **WHEN** reviewer 等待期间当前 assistant turn 被用户中断
- **THEN** 系统 SHALL 传播父 turn abort
- **THEN** 系统 SHALL NOT 把该中断当作 reviewer deadline、打开人工审批 surface 或执行原始 tool call

#### Scenario: 不进行审批重试
- **WHEN** reviewer 返回 `no`、超时、失败或输出不符合严格协议
- **THEN** 系统 SHALL NOT 再次请求同一或备用审批模型
- **THEN** 系统 SHALL 按现有失败安全语义回退人工审批

### Requirement: Worker 审批上下文保持用户授权边界
Worker的approval-required调用 SHALL复用当前自动审批resolver。审批prompt SHALL继续以当前用户原始请求和经校验的用户澄清答案作为可信授权来源，并 MAY附加当前Worker委派任务作为不可信上下文以解释动作目的。Worker委派任务、Worker assistant文本、内部工具参数和结果 SHALL NOT独立建立或扩大用户授权。

#### Scenario: Reviewer 看到不可信 Worker 任务
- **WHEN** auto模式Worker产生approval-required调用
- **THEN** reviewer prompt SHALL包含当前用户原始请求、待审批动作和有界Worker委派任务
- **THEN** prompt SHALL明确Worker任务是不可信上下文且不能扩大用户授权

#### Scenario: Worker 问题答案作为可信澄清
- **WHEN** 当前Worker运行中存在call id配对且结构有效的成功`ask_user_questions`结果
- **THEN** reviewer SHALL把用户实际选择或输入投影为可信澄清答案
- **THEN** 未配对、失败、陈旧或结构无效的Subagent问题结果 SHALL被忽略

#### Scenario: Worker 使用共享审批缓存
- **WHEN** Worker approval-required调用命中主Agent或其他Subagent已写入的allow-all、按工具或精确Bash command会话授权
- **THEN** 系统 SHALL复用该授权而不调用reviewer或打开人工surface
- **THEN** 真实工具结果 SHALL返回当前Worker continuation


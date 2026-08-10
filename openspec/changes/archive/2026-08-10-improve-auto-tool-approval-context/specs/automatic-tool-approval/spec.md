## MODIFIED Requirements

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

## ADDED Requirements

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

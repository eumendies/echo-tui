## ADDED Requirements

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
系统 SHALL 使用用户配置中指定的现有 LLM model profile 发起自动审批请求。请求 SHALL 由固定审批 system prompt、当前 transcript 中最近 10 条可用于模型判断的文本记录，以及当前待审批 tool call 的 tool name 和原始 arguments text 组成。审批模型 profile SHALL 按 id 严格解析，找不到时不得静默回退到其他 profile。

#### Scenario: 使用配置的 model profile
- **WHEN** auto 模式配置引用有效的 model profile id
- **THEN** 系统 SHALL 使用该 profile 对应的 provider、凭据、base URL 和 model 发起审批请求
- **THEN** 系统 SHALL NOT 因主会话当前选择了其他模型而替换审批模型

#### Scenario: 取最近 10 条可用记录
- **WHEN** 当前 transcript 包含超过 10 条 user、assistant、进入上下文的 shell、tool call 或 tool result 文本记录
- **THEN** 审批请求 SHALL 只包含筛选结果中最近的 10 条记录
- **THEN** 这些记录 SHALL 保持其原始先后顺序并带有可区分角色的纯文本标签

#### Scenario: 过滤本地和 provider-private 记录
- **WHEN** 当前 transcript 包含 system、local notice、error、compaction notice、reasoning summary、provider-private extension 或不进入上下文的 shell 记录
- **THEN** 自动审批上下文 SHALL 排除这些记录
- **THEN** 自动审批请求 SHALL NOT 包含附件二进制内容

#### Scenario: 单独追加当前 tool call
- **WHEN** 系统为一个 approval-required tool call 构造审批请求
- **THEN** 请求 SHALL 单独包含该调用的 tool name 和原始 arguments text
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

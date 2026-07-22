## MODIFIED Requirements

### Requirement: 内置 system prompt 注入
真实 LLM adapter SHALL 在每次默认真实 agent 调用中解析基础 system prompt，并将其作为 provider 请求上下文中的 transient `system` transcript record 注入。系统 SHALL 优先使用项目级 `SYSTEM.md`，其次使用用户级 `~/.echo/SYSTEM.md`，最后使用源码内置 prompt。`SYSTEM.md` SHALL 只替换基础文本；当前 cwd、AGENTS.md、skills 和 memory SHALL 继续追加到同一 system record。具体工具选择 SHALL 由请求中提供的工具 definitions 与任务上下文决定。

#### Scenario: 默认真实请求携带内置基础 prompt
- **WHEN** 用户提交普通消息并触发默认真实 agent
- **THEN** agent loop runtime SHALL 在传给底层 provider agent 的 records 开头注入一条 `system` record
- **THEN** 未发现有效 `SYSTEM.md` 时，该 system record 的基础文本 SHALL 来自源码内置 prompt
- **THEN** 该 system record SHALL 包含当前工作目录 cwd
- **THEN** OpenAI provider request input SHALL 包含该 system message

#### Scenario: 内置规则保持最小且不编排工具选择
- **WHEN** agent loop runtime 构造内置 system prompt
- **THEN** prompt SHALL 保留语言与回答风格、基于当前对话和工具结果、明确不确定性及非平凡多步骤 todo 生命周期规则
- **THEN** prompt SHALL NOT 指定具体工具的使用优先级或要求模型先判断工具是否必要
- **THEN** prompt SHALL NOT 包含通用凭据或敏感信息提醒

#### Scenario: 项目级 SYSTEM.md 覆盖用户级和内置基础 prompt
- **WHEN** 项目根目录存在非空可读的 `SYSTEM.md`
- **THEN** agent loop runtime SHALL 使用该文件内容作为基础 system prompt
- **THEN** runtime SHALL NOT 同时拼接用户级 `~/.echo/SYSTEM.md` 或源码内置基础文本

#### Scenario: 用户级 SYSTEM.md 覆盖内置基础 prompt
- **WHEN** 项目级 `SYSTEM.md` 不可用且 `~/.echo/SYSTEM.md` 非空可读
- **THEN** agent loop runtime SHALL 使用用户级文件内容作为基础 system prompt
- **THEN** runtime SHALL NOT 同时拼接源码内置基础文本

#### Scenario: SYSTEM.md 保留动态上下文 section
- **WHEN** agent loop runtime 使用任一 `SYSTEM.md` 覆盖基础 prompt
- **THEN** system record SHALL 继续包含当前 cwd
- **THEN** system record SHALL 继续按现有行为追加适用的 AGENTS.md、skills 和 memory section

#### Scenario: 无效 SYSTEM.md 回退
- **WHEN** 某个 `SYSTEM.md` 缺失、不是普通文件、不可读或规范化后为空
- **THEN** runtime SHALL 忽略该候选并尝试下一优先级来源
- **THEN** runtime SHALL 完整读取生效文件且 SHALL NOT 按字节数截断其内容

#### Scenario: JSON 用户配置不能覆盖 system prompt
- **WHEN** `~/.echo/config.json` 或模型 profile 中包含 `systemPrompt`、`prompt` 或类似字段
- **THEN** 默认真实 agent SHALL NOT 使用这些字段覆盖基础 system prompt
- **THEN** 默认真实 agent SHALL 继续使用按 `SYSTEM.md` 优先级解析出的基础 prompt

#### Scenario: system prompt 不进入本地 transcript ledger
- **WHEN** agent loop runtime 注入内置 system prompt
- **THEN** runtime SHALL NOT 通过 app callbacks 追加该 system record
- **THEN** runtime SHALL NOT 修改调用方传入的 `TranscriptRecord[]`
- **THEN** transcript persistence SHALL NOT 保存该内置 system prompt record

#### Scenario: tool continuation 保留已解析的 system prompt
- **WHEN** 模型产生 tool call 且 agent loop runtime 需要发起 continuation provider turn
- **THEN** continuation records SHALL 仍以同一条 system record 开头
- **THEN** 同一次 agent run SHALL 使用相同的基础 prompt 快照
- **THEN** runtime SHALL 在该 system record 后继续追加 assistant segment、tool_call 和 tool_result records

#### Scenario: OpenAI adapter 不拥有 prompt 来源策略
- **WHEN** OpenAI provider agent 构造 Responses request
- **THEN** OpenAI provider agent SHALL 只转换传入 records 中已有的 `system` record
- **THEN** OpenAI provider agent SHALL NOT 自行读取配置或生成额外 system prompt

### Requirement: 默认真实 agent 暴露 apply_patch 工具
真实 LLM adapter SHALL 在默认 tool registry 中暴露 `apply_patch` 工具，使模型可以通过 agent loop runtime 对文本文件执行 patch 编辑。OpenAI provider agent SHALL 继续只把 registry 中的 tool definitions 转换为 OpenAI function tools，不直接执行 patch 逻辑。内置 system prompt SHALL NOT 规定模型优先使用 `apply_patch` 或限制 bash 的适用任务。

#### Scenario: OpenAI 请求包含 apply_patch tool schema
- **WHEN** 默认真实 agent 初始化 tool registry 并构造 OpenAI request
- **THEN** OpenAI request tools SHALL 包含 `apply_patch` function tool definition
- **THEN** OpenAI request tools SHALL 继续包含 `run_bash_command` function tool definition

#### Scenario: agent loop runtime 执行 apply_patch tool call
- **WHEN** 底层 provider agent 返回名为 `apply_patch` 的 tool call
- **THEN** agent loop runtime SHALL 通过 tool executor 查找并执行 `apply_patch` handler
- **THEN** runtime SHALL 将 handler 返回的 tool result 追加为 `tool_result` record
- **THEN** runtime SHALL 使用包含该 tool result 的 continuation records 继续请求模型

### Requirement: 默认真实 agent 暴露 glob 工具
真实 LLM adapter SHALL 在默认 tool registry 中暴露 `glob` 工具，使模型可以通过 agent loop runtime 按路径模式发现本地文件。OpenAI provider agent SHALL 继续只把 registry 中的 tool definitions 转换为 OpenAI function tools，不直接执行 glob 逻辑。内置 system prompt SHALL NOT 规定 glob、grep、read_files、apply_patch 或 bash 的选择优先级。

#### Scenario: OpenAI 请求包含 glob tool schema
- **WHEN** 默认真实 agent 初始化 tool registry 并构造 OpenAI request
- **THEN** OpenAI request tools SHALL 包含 `glob` function tool definition
- **THEN** OpenAI request tools SHALL 继续包含 `run_bash_command`、`apply_patch`、`grep` 和 `read_files` function tool definitions

#### Scenario: agent loop runtime 执行 glob tool call
- **WHEN** 底层 provider agent 返回名为 `glob` 的 tool call
- **THEN** agent loop runtime SHALL 通过 tool executor 查找并执行 `glob` handler
- **THEN** runtime SHALL 将 handler 返回的 tool result 追加为 `tool_result` record
- **THEN** runtime SHALL 使用包含该 tool result 的 continuation records 继续请求模型

### Requirement: 默认真实 agent 暴露 web_fetch 工具
真实 LLM adapter SHALL 在默认 tool registry 中暴露 `web_fetch` 工具，使模型可以通过 agent loop runtime 读取一个明确 HTTP(S) URL 的远程文本内容。OpenAI provider agent SHALL 继续只把 registry 中的 tool definitions 转换为 OpenAI function tools，不直接执行 web fetch 逻辑。内置 system prompt SHALL NOT 规定 web_fetch 或其他本地工具的选择优先级。

#### Scenario: OpenAI 请求包含 web_fetch tool schema
- **WHEN** 默认真实 agent 初始化 tool registry 并构造 OpenAI request
- **THEN** OpenAI request tools SHALL 包含 `web_fetch` function tool definition
- **THEN** OpenAI request tools SHALL 继续包含 `run_bash_command`、`apply_patch`、`glob`、`grep` 和 `read_files` function tool definitions

#### Scenario: agent loop runtime 执行 web_fetch tool call
- **WHEN** 底层 provider agent 返回名为 `web_fetch` 的 tool call
- **THEN** agent loop runtime SHALL 通过 tool executor 查找并执行 `web_fetch` handler
- **THEN** runtime SHALL 将 handler 返回的 tool result 追加为 `tool_result` record
- **THEN** runtime SHALL 使用包含该 tool result 的 continuation records 继续请求模型

## ADDED Requirements

### Requirement: 默认真实 agent 暴露 web_fetch 工具
真实 LLM adapter SHALL 在默认 tool registry 中暴露 `web_fetch` 工具，使模型可以通过 agent loop runtime 读取一个明确 HTTP(S) URL 的远程文本内容。OpenAI provider agent SHALL 继续只把 registry 中的 tool definitions 转换为 OpenAI function tools，不直接执行 web fetch 逻辑。

#### Scenario: OpenAI 请求包含 web_fetch tool schema
- **WHEN** 默认真实 agent 初始化 tool registry 并构造 OpenAI request
- **THEN** OpenAI request tools SHALL 包含 `web_fetch` function tool definition
- **THEN** OpenAI request tools SHALL 继续包含 `run_bash_command`、`apply_patch`、`glob`、`grep` 和 `read_files` function tool definitions

#### Scenario: agent loop runtime 执行 web_fetch tool call
- **WHEN** 底层 provider agent 返回名为 `web_fetch` 的 tool call
- **THEN** agent loop runtime SHALL 通过 tool executor 查找并执行 `web_fetch` handler
- **THEN** runtime SHALL 将 handler 返回的 tool result 追加为 `tool_result` record
- **THEN** runtime SHALL 使用包含该 tool result 的 continuation records 继续请求模型

#### Scenario: system prompt 引导明确 URL 读取优先使用 web_fetch
- **WHEN** 默认真实 agent 注入内置 system prompt
- **THEN** system prompt SHALL 引导模型在读取明确远程 URL 内容时优先使用 `web_fetch`
- **THEN** system prompt SHALL 保留 `glob` 用于本地路径发现、`grep` 用于内容搜索、`read_files` 用于已知路径读取、`apply_patch` 用于常规文本编辑、bash 用于验证和确有必要的命令执行

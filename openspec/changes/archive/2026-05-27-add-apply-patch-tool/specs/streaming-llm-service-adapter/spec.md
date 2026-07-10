## ADDED Requirements

### Requirement: 默认真实 agent 暴露 apply_patch 工具
真实 LLM adapter SHALL 在默认 tool registry 中暴露 `apply_patch` 工具，使模型可以通过 agent loop runtime 对文本文件执行 patch 编辑。OpenAI provider agent SHALL 继续只把 registry 中的 tool definitions 转换为 OpenAI function tools，不直接执行 patch 逻辑。

#### Scenario: OpenAI 请求包含 apply_patch tool schema
- **WHEN** 默认真实 agent 初始化 tool registry 并构造 OpenAI request
- **THEN** OpenAI request tools SHALL 包含 `apply_patch` function tool definition
- **THEN** OpenAI request tools SHALL 继续包含 `run_bash_command` function tool definition

#### Scenario: agent loop runtime 执行 apply_patch tool call
- **WHEN** 底层 provider agent 返回名为 `apply_patch` 的 tool call
- **THEN** agent loop runtime SHALL 通过 tool executor 查找并执行 `apply_patch` handler
- **THEN** runtime SHALL 将 handler 返回的 tool result 追加为 `tool_result` record
- **THEN** runtime SHALL 使用包含该 tool result 的 continuation records 继续请求模型

#### Scenario: system prompt 引导常规文件修改优先使用 apply_patch
- **WHEN** 默认真实 agent 注入内置 system prompt
- **THEN** system prompt SHALL 引导模型对常规源码、测试和文档修改优先使用 `apply_patch`
- **THEN** system prompt SHALL 保留 bash tool 用于观察、搜索、验证和确有必要的命令执行

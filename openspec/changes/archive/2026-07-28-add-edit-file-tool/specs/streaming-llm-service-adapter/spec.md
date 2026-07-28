## ADDED Requirements

### Requirement: provider 使用配置选择文件编辑工具 schema
真实 LLM adapter SHALL 只转换当前默认 registry 中已注册的文件编辑工具 definition，不得在 adapter 内硬编码补充 `apply_patch` 或 `edit_file`。当归一化模式为 `edit_file` 时，OpenAI Responses、OpenAI Chat、Anthropic 和 Codex provider-visible tools SHALL 包含 `edit_file` schema 而不包含 `apply_patch` schema；默认或 `apply_patch` 模式 SHALL 保持既有 `apply_patch` 暴露行为。

#### Scenario: edit_file 模式构造 provider request
- **WHEN** `tools.fileEdit.mode` 为 `edit_file`，且真实 agent 准备 provider request
- **THEN** request tools SHALL 包含要求 `path`、`old_string` 和 `new_string` 的 `edit_file` function tool definition
- **THEN** request tools SHALL NOT 包含 `apply_patch` function tool definition
- **THEN** 其他已注册本地工具和 MCP tools SHALL 继续按既有 adapter 规则转换

#### Scenario: apply_patch 模式保持现有 schema
- **WHEN** 文件编辑模式缺失、非法或显式为 `apply_patch`
- **THEN** request tools SHALL 包含现有 `apply_patch` function tool definition
- **THEN** request tools SHALL NOT 包含 `edit_file` function tool definition

#### Scenario: runtime 执行 edit_file tool call
- **WHEN** provider 在 `edit_file` 模式下返回名为 `edit_file` 的 tool call
- **THEN** agent loop runtime SHALL 通过普通 tool executor 执行已注册 handler
- **THEN** runtime SHALL 将真实 result 追加为匹配 call id 与工具名的 `tool_result` record
- **THEN** provider continuation SHALL 接收原始 result text，而不是 TUI diff 投影

#### Scenario: 配置切换不改变历史 continuation 事实
- **WHEN** transcript 已包含历史 `apply_patch` 或 `edit_file` call/result records，且后续 assistant run 使用另一文件编辑模式
- **THEN** provider adapter SHALL 继续按其既有 transcript 转换规则保留历史匹配 call/result
- **THEN** 当前 request 的可调用工具 definition SHALL 只包含当前模式选中的文件编辑工具


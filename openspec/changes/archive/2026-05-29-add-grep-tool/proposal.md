## Why

当前模型需要搜索源码时只能通过 `run_bash_command` 手写 `rg` 命令，容易出现 shell quoting、参数拼接、输出过大和结果格式不稳定的问题。新增 `grep` 工具可以把常规文本搜索变成结构化、受限、provider-neutral 的本地能力，并和 `read_files` / `apply_patch` 形成稳定的“搜索 → 读取 → 编辑”链路。

## What Changes

- 新增默认本地工具 `grep`，底层调用本地 ripgrep（`rg`）执行文本搜索，但不通过 shell 拼接命令。
- 输入保持简洁：`pattern` 必填，`paths` / `glob` / `literal` / `case_sensitive` 可选。
- 第一版不暴露 `offset` / `limit`；只通过内部 `DEFAULT_MAX_MATCHES` 限制返回匹配数量。
- 默认把 `literal: null` 解释为固定字符串搜索，避免模型搜索普通代码片段时被正则特殊字符绊倒；显式 `literal: false` 时才使用 regex。
- 返回结构化匹配结果，包括 path、line、column、line text、returned matches、has_more 和截断状态。
- 保持 `ToolExecutionResult`、transcript persistence 和 agent loop continuation schema 不变。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `local-tool-execution`: 增加 `grep` 本地文本搜索工具的默认注册、输入语义、ripgrep 调用边界、结果格式、错误语义和匹配数量限制。

## Impact

- 新增 `src/tools/grep-tool-handler.ts`，并在默认 tool registry 中注册。
- 更新 OpenAI tool schema 相关测试、工具执行测试和默认工具列表预期。
- 更新内置 system prompt、本地工具文档和架构说明，明确 `grep`、`read_files`、`apply_patch`、`run_bash_command` 的职责边界。
- 运行环境需要可执行的 `rg`；若缺失，工具返回明确失败结果，不实现 JS fallback。

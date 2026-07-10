## Why

当前多个内置工具把执行日志、入参回显、默认参数和调试 metadata 一并写入 `tool_result.text`，这些文本会进入后续 provider 上下文并消耗 token。需要把 tool result 优化为“模型下一步决策所需信息”，减少无助于推理的字段，同时保留失败、分页、截断等关键状态。

## What Changes

- 精简 provider-visible 的内置 tool result 文本，避免常态回显已存在于 tool call arguments 的入参。
- 对 `read_files`、`grep`、`glob`、`web_fetch`、`web_search`、`run_bash_command`、`apply_patch` 的成功结果采用更紧凑的输出格式。
- 对 todo 工具结果去除全量 todo 状态重复回传，只返回变更确认；完整 todo 状态继续通过 runtime todo suffix 注入。
- 对 `ask_user_questions` 成功结果去除重复的问题全文和 option description，保留答案索引、选择标签和自定义文本。
- 保留失败原因、用户可修复提示、`has_more`、截断、timeout、非零退出码、低质量搜索警告等模型继续工作所需信号。
- 本次变更暂不优化 MCP tool result 格式。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `local-tool-execution`: 优化内置本地工具的 provider-visible result 文本，减少冗余字段和执行日志式输出。
- `ask-user-questions-tool`: 优化用户回答 tool result JSON，避免重复回传已在问题请求中出现的完整题目和选项描述。
- `session-todo-management`: 优化 todo 工具 result JSON，避免与 runtime todo suffix 重复传递完整 todo 状态。

## Impact

- 影响 `src/tools/` 下内置 tool handler 的 result formatter。
- 影响 `src/tools/todo-tool-handler.ts` 与 `src/tools/ask-user-questions-tool-handler.ts` 的 JSON result 格式。
- 影响 todo tool 专属 renderer 对新旧 JSON 格式的兼容解析。
- 不改变 provider tool schema、tool call 参数、`ToolExecutionResult` 结构化字段、MCP tool adapter、approval 流程或 transcript converter 的基本注入机制。
- 需要更新相关 Node test，覆盖紧凑格式、异常格式、分页/截断提示和旧 transcript 渲染兼容。

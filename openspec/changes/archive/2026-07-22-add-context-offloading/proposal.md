## Why

当前 Bash、MCP、Web Fetch 和 PDF 文本提取等工具在结果超过上限时会直接丢弃被截断内容，模型只能看到不完整结果，既可能错过 Bash 尾部的失败结论，也无法按需回读 Web 文本、MCP 返回值或已提取的 PDF 文本。需要把可采集的大结果转存到本地文件，并只向上下文返回符合工具语义的短预览和文件路径，从而降低上下文占用且保留按需取用能力。

## What Changes

- 新增本地 tool result offloading：大结果写入当前项目分区下的持久文件，模型可通过现有文件读取工具按路径继续读取。
- 模型可见结果保持简洁，只在截断位置插入统一的 `[tool result truncated: <path>]` 标记，不增加额外 metadata 字段。
- 按工具语义选择预览方向：Web Fetch 和默认 MCP 文本保留开头并在末尾放置标记；Bash 保留尾部并在开头放置标记。
- Bash 共享 runner 默认在采集输出时写入 offload 文件并维护 bounded 尾部预览，避免模型可见结果无限增长；shell ctx 复用该行为，shell-local 则完整保存在仅本地 transcript 中。
- `read_files` 的 PDF 已提取文本在最终结果超过独立的 64 KiB 模型可见阈值时保存完整格式化结果，只返回 PDF metadata、开头预览和统一路径标记；普通文件读取的总输出上限、PDF 文件大小与提取硬上限保持不变。
- 保留各工具既有硬安全上限、超时、取消和错误语义；offload 写入失败时安全退回现有截断行为，不中断工具调用。
- `read_files`、`grep`、`glob` 和 `web_search` 继续使用现有分页、数量上限或收窄查询语义，不因本变更默认收集无限结果。

## Capabilities

### New Capabilities
- `context-offloading`: 定义大工具结果的本地文件转存、按工具语义生成预览、统一截断标记、路径回读和失败降级行为。

### Modified Capabilities
- `local-tool-execution`: 将 Bash 超限输出从直接丢弃改为落盘并返回尾部预览及统一路径标记。
- `mcp-tool-integration`: 将超大 MCP 文本结果转存到文件，并返回开头预览及统一路径标记。
- `shell-mode`: 让 shell ctx 通过共享 Bash runner 使用输出落盘和尾部预览语义，同时让 shell-local 保留完整本地输出。

## Impact

- 主要影响 `src/tools/bash-command-runner.ts`、`src/tools/bash-tool-handler.ts`、`src/tools/web-fetch-tool-handler.ts`、`src/tools/read-files/`、`src/mcp/tool-adapter.ts`、`src/app/state/turn-context.ts` 和默认工具装配路径。
- 新增用户级项目分区中的 tool result 文件存储，不向工作区写入临时或缓存文件。
- `ToolExecutionResult` 的模型可见文本格式在超限场景下发生变化，但现有 `truncated` 结构化状态、tool call id、tool name 和 provider continuation 配对保持兼容。
- 不引入第三方依赖；继续使用 Node.js 文件系统、流和现有 `read_files` / `grep` 工具。

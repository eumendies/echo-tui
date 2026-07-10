## Why

当前默认工具已经支持按内容搜索和按已知路径读取文件，但模型在“不知道目标文件具体路径”时仍需要退回 `bash` 执行 `find`、`ls` 或 `rg --files`。这会让常见代码定位流程依赖自由 shell 命令，输出格式也不如现有工具稳定。

新增 `glob` 文件发现工具可以把“按文件名或路径模式找文件”收敛到受限、本地、结构化的 tool 边界，并与 `read_files`、`grep`、`apply_patch` 形成更清晰的观察到编辑链路。

## What Changes

- 新增默认本地工具 `glob`，按 glob pattern 和可选搜索根返回匹配文件路径。
- `glob` 使用受限输出：无匹配视为成功，过多结果截断并提示收窄 pattern 或 paths。
- `glob` 遵循现有路径安全边界：相对路径按 cwd 解析，允许绝对路径和 `..`，拒绝 NUL 和 `.git` 内部路径。
- 默认工具 registry 暴露 `glob`，真实 OpenAI 请求可发送该 function tool schema。
- 内置 system prompt 引导模型在“按路径模式发现文件”时优先使用 `glob`，而不是普通 bash 列目录命令。
- 不引入目录浏览型 `list_dirs` 能力；`glob` 只返回文件路径。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-tool-execution`: 增加 `glob` 本地文件发现工具的输入、输出、路径安全、截断和错误语义。
- `streaming-llm-service-adapter`: 默认真实 agent 的工具暴露和内置提示词增加 `glob` 使用边界。

## Impact

- 影响 `src/tools/`：新增 glob handler，并接入默认 tool registry。
- 影响 `src/agent/system-prompt.ts`：更新默认工具使用提示。
- 影响测试：扩展工具 registry、schema 和 glob handler 行为覆盖。
- 影响文档和 OpenSpec：同步本地工具架构说明与相关 capability delta。
- 不新增运行时 npm 依赖；优先复用本机 `rg --files`，并保持 spawn 参数数组调用方式。

## Why

当前模型读取已知文件内容主要依赖 `run_bash_command` 拼接 `cat`、`sed` 等 shell 命令，输出缺少统一分页、大小限制和错误格式，容易造成上下文膨胀或 shell 误用。新增 `read_files` 工具可以提供结构化、受限、可扩展的本地文件读取入口，并为未来图片、PDF 等非文本资源读取保留能力边界。

## What Changes

- 新增默认本地工具 `read_files`，接收 `files` 数组，每项包含 `path` 以及可选 `offset` / `limit`。
- 第一版实现文本文件读取：按行分页返回 UTF-8 文本内容、路径、行数、是否还有更多内容和截断状态。
- 对图片、PDF 或其他暂不支持的非文本资源返回明确的 unsupported metadata；`offset` / `limit` 仅对文本读取生效，未来非文本 reader 可安全忽略这些字段。
- 保持 `ToolExecutionResult`、transcript/session persistence、agent loop continuation 语义不变。
- 默认 registry 暴露 `read_files`，OpenAI tool schema 可随默认工具列表发送给模型。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-tool-execution`: 增加 `read_files` 本地文件读取工具的注册、输入、文本读取、错误和限制语义。

## Impact

- 影响 `src/tools/`：新增 `read_files` tool handler，并接入默认 tool registry。
- 影响 `src/agent/` 测试预期：默认工具列表新增 `read_files`，OpenAI tool conversion 继续使用既有 provider-neutral definition。
- 影响 `test/tools/`：增加文件读取成功、分页、批量、错误、非文本 fallback、路径限制和规模限制测试。
- 不引入新 npm 依赖，不改变现有 bash/apply_patch 工具 contract。

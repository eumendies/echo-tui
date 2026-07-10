## 1. 工具 handler 与输入校验

- [x] 1.1 新增 `read_files` tool handler 模块，导出工具名称和 `createReadFilesToolHandler()`。
- [x] 1.2 定义 strict tool schema：`files` array 必填，file item 包含 `path` string 以及可选 `offset` / `limit` number。
- [x] 1.3 实现参数归一化：校验 `files`、`path`、`offset`、`limit`，应用默认 offset 和输出规模上限。
- [x] 1.4 实现路径解析和拒绝规则：相对路径按 cwd、允许绝对路径和 `..`，拒绝 NUL 与 `.git` 内部路径。

## 2. 文件读取与结果格式

- [x] 2.1 实现文本文件 reader：读取 UTF-8 内容，按 0-based `offset` 与 `limit` 返回行切片。
- [x] 2.2 生成每个文件的 result envelope，包含 path、absolute path、kind/media metadata、offset、limit、total lines 或 unknown、returned lines、has_more 和 content。
- [x] 2.3 实现非文本/暂不支持媒体 fallback：返回 metadata 与 unsupported 错误，不输出二进制内容，且不因 offset/limit 本身失败。
- [x] 2.4 实现批量读取语义：按输入顺序处理多个文件，允许成功结果和失败详情共存，任一文件失败时整体 `ok: false`。
- [x] 2.5 实现大小限制和截断标记：限制 files 数量、单文件本次返回内容 bytes 和总输出 bytes，并在 result 中标记 `truncated`。

## 3. 注册与 agent 集成

- [x] 3.1 将 `read_files` 注册到默认 tool registry，保持自定义 registry 行为不变。
- [x] 3.2 更新默认工具列表和 OpenAI request/tool conversion 相关测试预期。
- [x] 3.3 确认 `ToolExecutionResult`、transcript persistence 和 agent loop continuation 不需要 schema 变更。

## 4. 测试与文档

- [x] 4.1 增加工具执行测试：单文件读取、offset/limit 分页、has_more、批量读取和部分失败。
- [x] 4.2 增加错误/边界测试：无效参数、缺失文件、目录路径、NUL、`.git`、超限文件、非文本 unsupported 和输出截断。
- [x] 4.3 更新本地工具相关文档或架构说明，说明 `read_files` 与 bash/apply_patch 的职责边界。
- [x] 4.4 按仓库要求运行 `npm run typecheck`、`npm test`、`find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 4.5 运行 `npx -y @fission-ai/openspec@latest validate --all --strict`，确认 change 和主规格有效。

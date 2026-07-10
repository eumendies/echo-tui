## Why

`read_files` 当前返回文件内容时只提供 `offset`、`limit` 和返回行数等分页 metadata，模型在解释、引用或准备后续 patch 时仍需要自行数行，容易出现定位偏差。为提升代码阅读和修改链路的可靠性，需要在工具结果中直接呈现真实文件行号。

## What Changes

- `read_files` 的文本文件结果 SHALL 在内容块中为每一行添加真实的 1-based 文件行号。
- `read_files` 的分页 metadata SHALL 明确返回片段对应的 `start_line` 和 `end_line`，便于模型和用户理解 `offset` 与文件行号之间的关系。
- 行号 SHALL 仅作为工具结果展示/回传辅助信息，不改变文件实际内容、路径校验、分页读取、截断和非文本文件处理语义。
- 更新 read_files 相关测试，覆盖完整读取、分页读取和空文件/空片段等边界行为。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-tool-execution`: 修改 `read_files` 文本结果契约，使文本内容包含真实文件行号和片段起止行 metadata。

## Impact

- 影响 `src/tools/read-files-tool-handler.ts` 的文本结果格式化逻辑。
- 影响 `test/tools/tool-execution.test.js` 中对 `read_files` 输出文本的断言。
- 影响 `openspec/specs/local-tool-execution/spec.md` 对 `read_files` 行为的主规格要求。
- 不新增运行时依赖，不改变 provider tool schema。

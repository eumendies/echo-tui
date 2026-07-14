## Why

四个 memory tools 当前落入通用 tool renderer，会在 transcript 和 footer pending preview 中直接展示 arguments/result JSON，既冗长又难以理解。Memory 操作需要像 `use_skill` 一样使用面向用户的动作摘要，并仅在读取或失败时展示真正有价值的结果。

## What Changes

- 为 `add_memory`、`read_memory`、`update_memory` 和 `remove_memory` 增加专属 tool message renderer。
- 使用统一的记忆动作词汇：`Remembering`、`Recalling`、`Revising` 和 `Forgetting`，按 user/agent、catalog/item 目标生成可读调用摘要。
- `add_memory`、`update_memory` 和 `remove_memory` 成功时只显示 tool call 摘要，失败时追加 bounded failure result。
- `read_memory` 成功时把 user 或 agent memory contents 投影为分点列表；user memory 同样不展示 on/off、id、时间戳或其他 JSON 元数据。
- Footer pending preview 与 transcript 使用同一套 memory call 摘要，避免执行前短暂显示 raw JSON。
- 无法解析 arguments/result 时使用不含 raw JSON 的安全 memory 摘要；原始 transcript、tool result 和 provider continuation 保持不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tool-message-rendering`: 增加四个 memory tools 的调用摘要、pair-aware result 展示、列表投影、安全降级和宽度约束。

## Impact

- 渲染分派：`src/render/tool-message-renderer.ts`
- 新增专属投影模块：`src/render/tool-message-renderers/memory.ts`
- 复用现有工具前缀状态、换行、截断和 theme 能力，不修改 memory tool handler 或 transcript schema
- 自动化测试：`test/render/app-renderer.test.js`，覆盖成功、失败、pending、user/agent read 列表、malformed 数据和窄终端
- 不新增依赖，不改变工具参数、执行结果、审批、持久化或 provider-visible 内容。

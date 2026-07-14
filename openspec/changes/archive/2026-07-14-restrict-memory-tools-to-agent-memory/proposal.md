## Why

现有 memory tools 同时操作 user memory 与 agent memory，导致 `type`、`target` 及其余参数形成多层条件组合，增加 provider schema、参数校验和渲染分支的复杂度。同时，允许 agent 写入被描述为“用户提供”的 user memory，会模糊两类 memory 的所有权与信任语义。

## What Changes

- **BREAKING**：`read_memory`、`add_memory`、`update_memory` 和 `remove_memory` 改为仅操作 agent memory，公开参数与成功结果移除冗余的 memory `type` discriminator。
- **BREAKING**：agent 不再通过 memory tools 读取、添加、更新或删除 user memory；user memory 仅由用户通过 `/memory` 管理，并继续作为每轮自动注入的用户固定背景。
- 用户要求 agent“记住”信息时，agent 使用具有合适 global/project scope 和语义 catalog 的 agent memory，而不是写入 user memory。
- memory tool 的校验、审批摘要、终端投影和测试移除 user/agent 分支，保留 agent catalog/item 行为。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-memory`：memory tools 的公开契约改为仅操作 agent catalog 和 item，并移除 `type` 参数与 user memory 读取模式。
- `user-memory`：移除 agent 经 memory tools 修改 user memory 的能力，明确 user memory 仅由 `/memory` 管理。
- `tool-message-rendering`：memory tool 投影改为只处理 agent catalog/item 参数，不再投影 user memory tool 调用与结果。

## Impact

- 影响 `src/tools/memory-tool-handler.ts` 的工具 schema、执行分派与 user memory store 依赖。
- 影响 memory mutation 审批摘要与 `src/render/tool-message-renderers/memory.ts` 的参数投影。
- 影响 memory tool、agent registry、renderer 及相关集成测试。
- 需要同步更新 user memory、agent memory、工具渲染规范和架构文档；不迁移或删除现有 `~/.echo/memories.json` 与 agent memory 文件。

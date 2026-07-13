## Why

Agent memory 的 catalog 和 item 目前只能新增、编辑或删除，无法像 user memory 一样临时停用。用户需要在不丢失持久内容的前提下控制 catalog 是否参与 provider prompt，以及 item 是否可由 agent 按需读取。

## What Changes

- 为 agent memory catalog 和 item 增加持久化的 `enabled` 状态，新建对象默认启用。
- 保持 agent memory 存储 `version: 1`，直接扩展开发期文件格式；缺少 `enabled` 的旧开发文件不做兼容或迁移。
- Provider prompt 只投影已启用的有效 catalog；禁用的 project catalog 不参与同名覆盖，因此可回退到已启用的 global catalog。
- `read_memory` 拒绝读取禁用 catalog，并只返回已启用的 item；显式读取禁用 scope 时不回退其他 scope。
- `/memory` 的 agent catalog 和 item 列表增加启停状态展示与 Space 切换，行为与 user memory 管理一致。
- 保持 `add_memory`、`update_memory` 和 `remove_memory` 的公开 tool schema 不变；agent memory 启停仅由本地 `/memory` 管理。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-memory`: 扩展 catalog/item 存储结构、有效 catalog 解析、provider prompt 投影和 `read_memory` 读取语义。
- `user-memory`: 扩展 `/memory` 管理 surface，使 agent catalog 和 item 支持启停操作。
- `command-host-runtime`: 为 `/memory` handler 增加受控的 agent catalog/item 启停能力。

## Impact

- 类型与存储：`src/types/memory.ts`、`src/memory/agent-memory-store.ts`
- Provider 上下文：`src/agent/agent-loop-runtime.ts`、`src/agent/system-prompt.ts` 的现有 catalog 投影数据流
- Memory 工具：`src/tools/memory-tool-handler.ts` 的 agent `read_memory` 执行路径
- `/memory` 管理：`src/app/command/command-host.ts`、`src/types/command.ts`、`src/commands/memory-command-handler.ts`、`src/render/footer/memory-surface.ts`
- 自动化测试：agent memory store、memory tool、agent runtime、command host 和 `/memory` command/render 测试
- 不新增运行时依赖，不修改 mutation tool 审批策略或公开 schema。

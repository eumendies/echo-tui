## Why

当前 `/usage` 虽能展示每日总量，但用户无法从某天的异常用量继续定位由哪些配置 provider 和模型产生。先汇总模型再查看其每日趋势，也不符合以“某天”为入口排查用量的路径。

现有 usage event 已记录 provider 类型和模型标识，因此可以在不收集额外敏感数据、也不迁移既有账本的前提下，提供按模型维度的本地统计。

## What Changes

- 保持 `/usage` 默认按日期展示每日 token usage，并让用户使用方向键选择日期、按 Enter 进入该日的各模型用量。
- 各模型行按配置 provider ID 与模型标识聚合并显示为 `provider_id/model`；新 event 持久化 provider ID，历史 event 回退使用 provider 类型作为前缀。
- 扩展 usage store 的查询/聚合能力，以支持按单日聚合各 provider/模型组合。
- 扩大 usage surface 的最大宽度；在窄终端中仍按现有 footer 安全布局规则折叠次要列，保持表格可读且不产生额外自动换行。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `usage-command`: 扩展 `/usage` 从仅按日展示，变为支持选择日期并下钻查看当日 provider/模型聚合的只读 usage surface。

## Impact

- 受影响模块：`src/types/usage.ts`、`src/persistence/usage-store.ts`、`src/types/command.ts`、`src/commands/usage-command-handler.ts`、`src/render/footer/usage-surface.ts`，以及它们的测试。
- usage JSONL event 新增可选、非敏感的 `providerId` 字段；现有 schema version 与历史文件保持兼容，不迁移历史文件，也不增加 provider 请求、第三方依赖或敏感数据持久化。
- `/usage` 仍是本地只读 command，不应写入 transcript 或改变 assistant turn 生命周期。

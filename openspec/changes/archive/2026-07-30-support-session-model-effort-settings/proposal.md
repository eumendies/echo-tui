## Why

当前 `/model`、`/effort` 和 composer 模型调节会改写用户级 LLM 配置，导致一个 TUI session 的选择立即影响其他 session。模型与推理等级本质上是当前对话的运行偏好，应在保留全局默认值的同时允许每个 session 独立选择并在恢复后继续生效。

## What Changes

- 保留 `~/.echo/config.json` 中的 `llm.selectedModel` 和 model profile `reasoning.effort` 作为新 session 的全局默认值。
- 为持久化 session 增加独立的当前 model/effort settings sidecar，只保存当前值，不把选择历史写入 transcript journal。
- 将 `/model`、`/effort` 和 composer model tuning 的确认行为改为更新当前 session，而不是改写用户级 LLM 配置。
- 新 session 在内存中从最新全局默认值初始化；首次持久化时保存 settings。`/clear` 创建的新会话重新采用全局默认值，`/resume` 恢复目标 session 的 settings。
- 将当前 session 的 model profile id 和可选 effort override 传入每轮 agent 调用，并保持显式 skill 单次 override 的更高优先级。
- 对旧 session、缺失 sidecar 和已删除 model profile 提供兼容回退，不迁移或污染 transcript journal。

## Capabilities

### New Capabilities
- `session-model-settings`: 定义 session 粒度 model/effort 的初始化、当前值持久化、恢复、回退和 agent 生效语义。

### Modified Capabilities
- `composer-model-tuning`: 将确认 model/effort 的行为从全局配置事务改为当前 session settings 更新，并调整持久化边界。
- `app-context-state-container`: 让 `ModelContext` 缓存和更新当前 session 的有效 model/effort，同时保持配置刷新、实例隔离和渲染热路径约束。

## Impact

- 主要影响 `src/app/state/model-context.ts`、`src/app/state/app-context.ts`、session 创建/恢复编排、模型命令端口和 assistant turn 参数合并。
- 新增 session settings 的类型与原子 sidecar store；现有 `{session-id}.jsonl` journal 格式和 replay 操作保持不变。
- `readLlmConfig`、`AgentSessionInput.modelProfileId` 和 `reasoningEffortOverride` 的既有 per-run override seam 将被复用；provider adapter 无需改变。
- `/config` 仍管理 provider、model profile、全局默认 model 和 profile 默认 effort，不新增项目级配置。
- 需要更新 model/effort、session persistence、resume/clear、配置热刷新、skill override 和 headless 边界的自动化测试与文档。

## Why

当前所有 skill invocation 都使用全局当前模型，用户无法让代码审查、文档处理或轻量任务固定使用更适合的模型。需要在现有 `/skills` 管理入口中提供低成本的逐 skill 模型选择，并将切换严格限制在用户显式 slash 调用的单次 agent turn 内。

## What Changes

- 扩展 `/skills` surface：每个 skill 展示模型策略，使用 Left/Right 在“当前模型”和已配置 model profiles 之间循环，不增加下拉列表或二级菜单。
- 扩展 skill root 的 `skills.json` 状态，在保留 enabled/disabled 管理的同时持久化按 skill 名称记录的 model profile override；未配置时动态跟随全局当前模型。
- 用户通过 `/<skill-name> [arguments...]` 显式调用 skill 时，将该 skill 的有效 model profile 作为单次执行覆盖传入 agent runtime，不修改全局 `llm.selectedModel`。
- 指定的 model profile 已不存在时回退到当前模型，避免 skill 因配置变化而不可用。
- 模型自主调用 `use_skill` 时不读取 skill model override，也不在 tool continuation 中切换模型。
- 保留 `/skills` 的批量草稿语义：Space 切换启停、Left/Right 切换模型、Enter 统一保存、Esc 放弃全部修改。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `skill-system`: 增加逐 skill 模型策略的持久化与 `/skills` 左右键交互，并让显式 slash skill invocation 支持单 turn 模型覆盖，同时保持自主 `use_skill` 的模型行为不变。

## Impact

- `src/skills/`：skill 状态 schema、读取/写入和 manager 投影。
- `src/commands/skills-command-handler.ts`、`src/render/footer/skills-surface.ts`、`src/types/command.ts`：模型选项、左右键草稿交互和行内展示。
- `src/commands/skill-invocation-command-handler.ts`、`src/app/main.ts`、`src/app/assistant-turn-runner.ts`：显式 invocation 的 typed 单次模型覆盖传递。
- `src/config/llm-config.ts`、`src/agent/agent-loop-runtime.ts`、`src/types/agent.ts`：按 model profile ID 解析单次 runtime 配置，不改写全局选择。
- skill state、command handler、surface rendering、slash invocation、agent runtime 和配置解析测试需要更新；不引入第三方依赖。

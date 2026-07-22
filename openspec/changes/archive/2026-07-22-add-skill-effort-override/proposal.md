## Why

`/skills` 已支持为 direct slash skill invocation 固定 model profile，但无法在不复制 model profile 的情况下为单个 skill 调整推理等级。为让偏速度或偏深度的 skill 能独立表达执行策略，需要补充按 skill 配置的 effort override，并保持普通 turn 与自主 `use_skill` 行为不受影响。

## What Changes

- 在 skill source root 的 `skills.json` 中持久化可选的按 skill reasoning effort override，并兼容现有状态文件。
- 在 `/skills` 单层 surface 中同时展示模型和 effort 策略，以 Tab/Shift+Tab 切换活动字段、Left/Right 调整当前字段。
- 提供“模型默认”动态 effort 策略，并与显式 `none`、`minimal`、`low`、`medium`、`high`、`xhigh` 区分。
- direct slash skill invocation 在单个 agent turn 内合并 model profile 与 effort override，不修改全局模型配置，也不影响后续 turn。
- status line 和本地 notice 反映当前 slash skill turn 的实际模型与 effort override；模型自主调用 `use_skill` 时不应用该策略。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `skill-system`: 扩展 skill 策略持久化、`/skills` 行内管理和 direct slash invocation 的单 turn 覆盖行为，使其支持 reasoning effort。

## Impact

- 影响 skill 状态读取、写入和内存类型，包括 `src/skills/` 与共享 skill/command 类型。
- 影响 `/skills` command session 状态、输入事件处理、footer surface 渲染及窄终端裁剪。
- 影响 direct slash invocation 到 assistant turn、agent session、agent setup 和 LLM 配置解析之间的 per-turn override 传递。
- 影响运行中 status line、本地 notice 以及对应的 command、render、skill state、agent runtime 自动化测试。
- 不新增第三方依赖，不改变 provider 凭据存储，也不修改全局 `llm.selectedModel`。

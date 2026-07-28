## Why

启用的 skill 数量或 description 过长时，常驻 system prompt 的 skill catalog 会无上限占用模型上下文，尤其会显著挤压小 context window 模型的消息预算。需要按模型窗口提供可配置的 catalog 预算，在保留 skill 可发现性的同时限制 description 占用。

## What Changes

- 为 provider-facing skill catalog 增加按 context window 比例计算的 token 预算，默认占窗口 2%。
- 完整 catalog 未超过预算时保持现有 prompt 不变；超过预算时保留全部 skill 名称，并以公平的动态 description 上限截断长描述。
- 截断 description 时保留首尾内容和省略标记，尽量同时保留能力说明与末尾的排除、路由规则。
- 当固定 header 和全部 skill 名称已经超过预算时，退化为 names-only catalog，而不从 provider catalog 中删除 skill。
- 在 `/config`“常规”Tab 增加 技能列表上下文占比上限设置，允许用户按百分比调节，并让 TUI 与 headless assistant run 使用同一归一化配置。
- `/context` 的 Skills 分类继续反映该轮实际注入的投影后 catalog token 占用。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `skill-system`: skill catalog 常驻注入增加 context-window-aware 预算、description 截断、names-only 退化和单轮稳定性要求。
- `config-surface-settings`: 常规设置增加 技能列表上下文占比上限的读取、校验、保存、即时刷新和 TUI/headless 生效语义。

## Impact

- 影响 `src/skills/skill-catalog-prompt.ts`、agent loop runtime、system prompt 装配和 context usage 估算。
- 扩展 app settings、agent session 输入、AppContext 设置刷新和 `/config` 常规设置 surface/handler。
- 不修改 SKILL.md 原始 metadata、`/skills` 展示、slash suggestion description 或 `use_skill` 加载结果。
- 不新增第三方依赖；token 预算沿用现有本地估算器。

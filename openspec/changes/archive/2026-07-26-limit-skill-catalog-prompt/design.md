## Context

当前 runtime 将所有 enabled skill 的 `name` 和完整 `description` 格式化为短 catalog，并在每次 provider request 的 system prompt 中常驻注入。catalog token 数已经单独计入 `/context` 的 Skills 分类，但其大小没有与当前模型的 context window 建立预算关系；skill 数量增加或单条 description 很长时，会持续挤压消息和工具结果的可用上下文。

Skill registry 同时服务 `/skills`、slash suggestions、`use_skill` 错误提示和 provider catalog，因此不能在 discovery 层破坏或覆盖原始 description。预算投影必须只发生在 provider prompt 边界，并在一次 agent loop 的所有 continuation 中保持稳定。

## Goals / Non-Goals

**Goals:**

- 按当前模型 context window 和用户配置比例限制 provider-facing skill catalog 的估算 token 占用。
- 预算足够时保持现有 prompt 字节级不变；预算不足时保留全部 skill 名称并公平压缩长 description。
- 让 TUI、headless、`/context` usage 和 `/config` 使用一致的配置与投影口径。
- 保持原始 skill metadata、完整正文按需加载和管理 UI 不受影响。

**Non-Goals:**

- 不根据当前 user request 动态选择、排序或隐藏 skill。
- 不调用 LLM 总结 description，也不引入 provider tokenizer 或第三方依赖。
- 不限制 `use_skill` 加载后的 SKILL.md 正文；该正文继续由现有上下文和压缩机制管理。
- 不把预算与当前对话已使用 token 或剩余窗口动态绑定。

## Decisions

### 1. 将比例定义为完整 catalog 的上下文预算

新增归一化设置 `skillCatalogContextRatio`，持久化到 `skills.catalogContextRatio`，默认 `0.02`，有效范围 `0.01` 至 `0.10`。单轮预算为：

```text
budgetTokens = floor(contextWindow × skillCatalogContextRatio)
```

比较对象是完整 skill catalog 的估算 token，而不是整个 provider request 或当前剩余窗口。这样同一 agent loop 的 system prompt 不会随着 conversation 增长而突然改变，也能保持 provider prompt cache 前缀稳定。

备选方案是基于当前总上下文占用触发截断；该方案会使 tool continuation 中的 catalog 内容变化，故不采用。

### 2. 在 prompt 边界创建不可变 catalog projection

由 skill catalog prompt 模块提供纯函数投影，输入完整 enabled catalog、context window 和配置比例，返回：

- `mode`: `full`、`truncated` 或 `names_only`
- provider-facing catalog entries 或等价 prompt 文本
- `budgetTokens`
- `originalTokens`
- `estimatedTokens`

runtime 初始化单次 run state 时创建一次 projection，后续 provider continuation 复用同一结果。Skill registry、SkillManager、`/skills`、slash suggestions 和 `use_skill` 继续持有完整 description。

直接在 registry 中截断会污染非 provider 消费者；每次构造 system prompt 时重新读取配置则会破坏单轮稳定性，因此均不采用。

### 3. 使用统一动态 cap 公平截断 description

当完整 prompt 超过预算时，通过二分搜索找到最大的统一 `perDescriptionTokenCap`，使格式化后的 prompt 估算 token 不超过预算：

- 原 description 小于 cap 时保持不变。
- 超过 cap 时按约 70% 头部、30% 尾部保留，并在中间插入显式的 `[…description truncated…]` 标记，让模型能区分程序截断与原文省略号。
- 截断按 Unicode code point 或 grapheme-safe 方式执行，不切断 surrogate pair。
- 最终以完整格式化 prompt 再次估算，确保固定 header、skill name、分隔符和省略标记都计入预算。

统一 cap 相当于水位线：短 description 不受影响，异常长 description 不会按原始占比继续独占预算。只保留头部的方案容易丢失 description 末尾常见的“不负责”及跨 skill 路由规则，因此采用首尾保留。

### 4. 固定开销超过预算时退化为 names-only

系统始终保留全部 enabled skill 名称，避免某个 skill 因预算不足而完全不可发现。如果仅 header、格式和所有名称已经超过预算，则移除所有 description 并返回 `names_only`；此时预算是 soft limit，系统不再删除或截断 skill name 来伪造满足预算。

基于关键词选择部分 skill 的方案可能在真正需要某个 skill 前先将其隐藏，属于独立的 request-aware routing 能力，本变更不采用。

### 5. 配置作为单轮 session snapshot 传入 runtime

TUI 的 AppContext 在创建 agent session 时同时快照自动压缩阈值和 skill catalog 比例；headless 未提供 session override 时由 runtime 读取同一 app settings 默认值。`/config` 保存或配置 watcher 刷新后，新比例从下一次 assistant run 生效，当前 active run 不变化。

Skill catalog 比例变化会使最近一次 `/context` breakdown 失去当前配置语义，因此刷新时清空旧 context usage；无需重绘 transcript。`/context` 的 Skills token 使用 projection 的 `estimatedTokens`，继续参与 provider usage 总量校准。

### 6. `/config` 常规页面显式展示百分比预算

“常规”Tab 新增“技能列表上下文占比上限”行，以百分比显示并通过 Left/Right 按 1% 调节。保存动作继续原子更新 `~/.echo/config.json` 并保留其他 root 节点。缺失或非法值独立回退默认 2%，不阻断 TUI 或 headless。

## Risks / Trade-offs

- [本地 token estimator 与真实 provider tokenizer 存在误差] → 使用项目现有统一估算器保证预算判断和 `/context` 分类口径一致，并将该比例视为安全预算而非 provider 硬限制。
- [截断中间内容可能降低 skill 路由准确率] → 保留 description 首尾、保持短描述完整，并始终保留所有 skill 名称；鼓励 skill 作者将核心能力和排除规则放在描述首尾。
- [极大量 skill 的名称固定开销也可能超过预算] → 明确退化为 names-only soft limit，不静默删除 skill；未来若需要可另行设计分层 catalog 或 request-aware 检索。
- [配置变化后 system prompt 与旧 usage 快照不一致] → 设置刷新时清理 context usage，且只在下一次 run 初始化 projection。
- [二分搜索重复格式化 catalog] → 该计算只在每次 agent run 初始化时执行，skill 数量和字符串规模有限，不进入 token streaming 或 render 热路径。

## Migration Plan

1. 扩展 app settings 的默认值、严格校验、容错读取和原子保存；旧配置缺少字段时自动使用 2%。
2. 增加纯 skill catalog projection，并在 runtime 初始化时接入，不改变 registry 数据结构和磁盘 skill 文件。
3. 扩展 TUI session snapshot、设置刷新和 `/config` 常规页面。
4. 用 projection 后 token 更新 Skills usage 估算，并补充 full/truncated/names-only 与 TUI/headless 测试。

回滚时可移除 projection 和新设置读取；用户配置中遗留的 `skills.catalogContextRatio` 会作为未知字段被旧版本保留或忽略，不需要数据迁移。

## Open Questions

无。默认比例、范围和首尾截断策略在本设计中固定，后续可通过独立 change 调整产品默认值或引入 request-aware skill 检索。

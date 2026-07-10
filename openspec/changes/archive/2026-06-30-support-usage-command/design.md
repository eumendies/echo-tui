## Context

当前系统已有 provider usage 的短链路：provider adapter 在 stream 完成时返回 `ProviderUsage`，agent loop 将 `usageInputTokens` 转为 `ContextUsage`，app 只把它作为当前进程内状态用于 status line 和 `/context`。这条链路的语义是“最近一次请求的上下文窗口占用”，不会持久化，也不会记录输出 token。

`/usage` 的目标不同：它是跨会话、跨天的用量账本，需要在每次真实 provider usage 到达时追加一条小型结构化事件，再由 command surface 读取并聚合。用户提供的 UI demo 展示了适合终端的形态：累计 header、可平移日期窗口、每日堆叠柱状图、cached/fresh input/output 图例和紧凑关闭提示。实现时应吸收这个信息架构，但使用项目现有 footer command surface、主题 token、输入事件和安全宽度约束。

## Goals / Non-Goals

**Goals:**
- 记录真实 provider 返回的 token usage，并按本地日期聚合为每日用量。
- 在 `/usage` 中展示累计输入、输出、缓存命中、缓存命中率和每日堆叠柱状图。
- 区分缓存命中输入、缓存创建输入、未命中输入和输出 token；显示层将缓存相关输入和未命中输入表达清楚。
- 支持日期窗口横向平移，并在 footer 高度和宽度受限时保持布局稳定。
- 保持 `/context` 最近一次上下文占用语义不变。

**Non-Goals:**
- 不计算费用金额，不内置 provider 定价表。
- 不上传或同步用量数据。
- 不把 prompt、响应文本、工具参数、API key、headers 或 provider 请求体写入 usage 账本。
- 不追溯解析旧 transcript 或 debug log 来补齐历史 usage。
- 不引入数据库或第三方 TUI 依赖。

## Decisions

### 1. 使用独立 append-only usage store，而不是 transcript session 字段

每次真实 provider usage 到达时追加一条 usage event。事件存放在用户级 echo_tui 数据目录下的 usage 分区，建议按月份拆分 JSONL 文件，读取时按日期范围扫描少量文件并聚合。

理由：
- usage 是账本事实，不应随 `/clear`、`/resume`、session 删除或 transcript 压缩改变。
- append-only JSONL 容易测试、容易人工检查，单条写入失败也不会破坏 transcript。
- 按月分文件能避免 `/usage` 为了展示最近若干天读取无限增长的单文件。

备选方案：
- 写入 transcript record：会污染对话历史，并让 provider converter 继续过滤新 role。
- 写入 session JSON：跨 session 聚合困难，且清空或恢复 session 会让用量语义变模糊。

### 2. provider usage 先归一化，再派生显示分类

扩展 `ProviderUsage` 为 provider-neutral 结构，包含：
- `inputTokens`: provider 报告的输入总量。
- `cacheReadInputTokens`: 命中缓存的输入量。
- `cacheCreationInputTokens`: 写入或创建缓存的输入量。
- `outputTokens`: 输出量。

账本事件派生：
- `cachedInputTokens = cacheReadInputTokens`
- `cacheCreationInputTokens` 单独保留，方便后续展示或调试。
- `uncachedInputTokens = max(0, inputTokens - cacheReadInputTokens)`

这里把“缓存创建输入”计入未命中输入，因为它仍是本次需要处理并可能计费的输入；但账本保留原始字段，未来 surface 可以单独拆出“cache write”。

### 3. 在 agent loop 成功收到 usage 后记录账本

usage 记录发生在 agent loop 已收到 provider turn result 且未被 abort 的路径上。没有 usage 的 provider turn 不写入账本，但不影响响应完成。工具 continuation 中如果模型多次请求 provider，每次 provider 返回 usage 都追加一条事件；每日聚合自然包含整轮对话内的所有 provider calls。

事件应带上非敏感上下文：时间戳、本地日期、provider agent type、模型名、interaction mode、cwd hash、可选 session id、token 字段和 context window。cwd hash 用于未来按项目过滤，但默认 `/usage` 可以先展示当前项目或全局视图，具体实现以 command surface 数据来源保持清晰为准。

### 4. `/usage` surface 复用 footer command surface 体系

新增 `UsageCommandSurface`，由 command handler 维护 `offset`、可见日期窗口和聚合数据。按键语义建议：
- Left/Right 或等价方向事件：窗口向前/向后移动一天。
- PageUp/PageDown：按当前窗口大小移动。
- Home/End：跳到最早/最新窗口。
- Esc/Enter：关闭 surface。

渲染吸收 demo 的结构：
- 顶部标题卡片。
- 累计 header：输入、输出、缓存命中、命中率、总量。
- 日期跨度行：显示当前窗口日期范围、可见天数和左右隐藏天数。
- 每日堆叠柱状图：底部为缓存命中输入，中间为未命中输入，顶部为输出；按全部聚合天中的峰值缩放，平移时高度可比较。
- footer 图例和按键提示。

实现上不照搬 demo 的 ANSI 常量和 raw-mode loop；renderer 应使用现有 `FooterTheme`、`safeRenderWidth`、`constrainLayoutTail`、`InputEvent` 和 command runtime。

### 5. 空数据和缺字段要显式降级

没有 usage 事件时，`/usage` 打开 info 或 usage empty surface，说明暂无记录，不启动 agent 请求，也不追加 transcript。provider 缺少某个 usage 字段时按 0 处理；如果缺少输入和输出总量，则不写账本事件，避免把无事实的请求显示为 0 token。

## Risks / Trade-offs

- [Risk] 不同 provider 对 cached tokens 和 cache creation 的计费语义不完全一致。→ Mitigation：账本保存 provider-neutral 字段和原始分类含义，surface 只承诺 token 数和缓存命中率，不承诺费用。
- [Risk] JSONL 写入失败可能让 `/usage` 少记一次请求。→ Mitigation：usage store 写入失败不影响 assistant turn；可通过 debug 或测试覆盖失败隔离。
- [Risk] output token 字段在某些兼容 provider 中缺失。→ Mitigation：缺失字段按 0 聚合，并保证输入统计仍可用。
- [Risk] 长期 JSONL 文件增长。→ Mitigation：按月分文件，并让 `/usage` 默认读取有限日期范围。
- [Risk] surface 在窄终端下柱状图和标签拥挤。→ Mitigation：限制最小卡片宽度、动态减少可见天数、裁剪次要标签，并沿用 footer 高度窗口化。

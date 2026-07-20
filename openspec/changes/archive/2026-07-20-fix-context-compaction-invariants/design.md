## Context

上下文摘要通过当前 `ProviderAgent.runTurn` 发起，但 provider agent 持有普通 turn 使用的完整配置与工具 registry，因此摘要请求会继承工具 schema 和 reasoning 参数。自动压缩完成后，runtime 只更新 `compactionState`，app 的 `onCompacted` callback 则调用 `applyCompaction` 向持久化 records 追加 `compaction_notice`；两侧 record 数量在同一 run 内由此产生偏差，后续压缩计算出的数组索引无法准确映射到持久化 records。

当前 session 使用 append-only `TranscriptRecord[]` 和数值型 `activeStartIndex`，本次变更需要保持该数据模型和普通 agent turn 行为不变。

## Goals / Non-Goals

**Goals:**

- 摘要请求继续复用当前模型和 provider client，但不发送工具定义或当前 reasoning 配置。
- 普通 agent turn 继续发送已注册工具和用户配置的 reasoning 参数。
- 自动压缩后 runtime record region 与 app transcript 保持相同的 record 坐标系，使同一 run 内多次压缩得到的 `activeStartIndex` 可直接持久化。
- 用 provider 请求级测试和连续压缩测试覆盖上述不变量。

**Non-Goals:**

- 不引入独立摘要模型、输出 token 上限或新的用户配置。
- 不把 `activeStartIndex` 迁移为 record id，也不修改 session schema。
- 不改变压缩阈值、边界算法、notice 文案和 `/compact` 交互。

## Decisions

### 决策 1：用显式布尔选项标记摘要请求

在 `AgentTurnOptions` 增加可选的 `isCompaction: boolean`。`generateCompactionSummary` 发起请求时显式设为 `true`，各 provider adapter 在构造请求时据此：

- 不读取或转换工具 registry，不发送 `tools`、`tool_choice`、`parallel_tool_calls` 等工具参数；
- 不发送当前配置派生的 Responses `reasoning`、Chat `reasoning_effort`、Anthropic `thinking/output_config` 或 Codex `reasoning` 参数；
- prompt cache key 也以空工具定义计算，保持请求内容与 cache routing 一致。

普通调用不设置该选项，沿用现有行为。当前只有普通请求和压缩请求两种语义，布尔名称比单成员 purpose literal 更直接；相比创建第二套 provider agent，该方案也不重复 client/config 装配，并能让自动和手动压缩共享同一语义。

### 决策 2：共享构造并双写 compaction notice

提供纯函数 `createCompactionNoticeRecord(compaction)` 统一 notice role 和文案。自动压缩完成后，runtime 把 notice 追加到 `recordRegion`，再通过现有 callback 让 app 使用同一 factory 追加并持久化 notice。

notice 继续被 provider converter、token 估算和摘要输入过滤，因此 runtime 追加只用于维持数组坐标，不改变模型可见上下文。手动 `/compact` 没有持续运行的 `recordRegion`，只需让 app 的 `applyCompaction` 复用 factory。

相比维护额外的 runtime-to-persisted offset，该方案直接恢复现有“两个 append-only 数组平行”的架构不变量，改动和后续推理成本更低。

## Risks / Trade-offs

- [部分模型在省略 reasoning 参数后仍可能使用服务端默认推理] → 本次保证不继承用户配置的 reasoning 参数，不尝试发送跨 provider 不兼容的显式禁用值。
- [runtime 中增加 notice 会影响固定 K 条边界的 record 计数] → 持久化 records 原本已包含相同 notice；双写让当前 run 与 resume 行为一致，且 notice 不进入 provider 或摘要。
- [新增 request option 可能遗漏某个 provider] → 为 OpenAI Responses、OpenAI Chat、Anthropic、Codex 分别增加请求构造断言。

## Context

`/usage` 从本地 JSONL 账本读取 usage event 并按 `localDay` 聚合，已有的每日表格是用户进入用量分析的正确入口。模型维度应服务于某个日期的归因，而不是取代日期入口。每条 event 已有 `providerType` 与 `model`；配置解析层还能提供非敏感的 provider 配置 ID，但该 ID 尚未被写入 usage 账本。

该 command 是允许 assistant turn 期间打开的本地只读 surface。实现必须继续遵守 append-only transcript、ANSI footer 安全宽度与最大行数约束，且不能为统计引入新的 provider 请求、交互输入或持久化敏感内容。

## Goals / Non-Goals

**Goals:**

- 在保持 `/usage` 默认按日期视图和既有账本兼容性的前提下，让用户选择某个日期并查看该日的模型归因。
- 让模型行以配置 provider ID 和模型标识的 `provider_id/model` 形式展示，避免同一 adapter 下不同 provider 配置混淆。
- 在宽度受限时保持 footer 稳定、可导航和可关闭。
- 为聚合与 command 状态建立可由 Node 内置测试覆盖的纯函数边界。

**Non-Goals:**

- 不增加日期范围、项目、provider 或模型的额外交互筛选器；日期选择仅用于下钻当前每日列表中的一项。
- 不估算费用、货币成本、限额、速率或 provider 账单数据。
- 不重写历史文件，不合并不同配置 provider 下碰巧同名的模型，也不尝试为历史 event 反推 provider ID。
- 不提供跨日期模型总览、二维“日期 × 所有模型”矩阵、导出能力或图形化全屏仪表盘。

## Decisions

### 使用 provider 配置 ID 与模型标识的二元组作为聚合身份

新 event 的按模型聚合键为 `(providerId, model)`，显示为 `providerId/model`。provider ID 是用户配置中 provider 目录的稳定、非敏感标识，能区分同一 adapter 下使用不同 Base URL 或账户的配置。缺少 `providerId` 的历史 event 以 `(providerType, model)` 聚合并显示为 `providerType/model`，以保持可读和向后兼容。

备选方案是只按 `model` 字符串或 adapter `providerType` 聚合；前者会错误合并 provider，后者不能区分多个同类型 provider 配置，故不采用。将模型名称映射为规范型号也不采用，因为会引入维护目录与历史兼容问题。

### 在运行时记录 provider ID，并在读取时按单日模型聚合

`LlmConfig` 在配置解析时携带 provider ID；主 agent、subagent、引用总结和自动审批 reviewer 写 usage event 时透传该 ID。event 的 `providerId` 为可选字段，schema version 保持不变。usage store 在已过滤的 event 流上通过 `fromDay` 与 `toDay` 相同的条件聚合当日模型；聚合分别累加输入、缓存命中输入、缓存创建输入、未命中输入、输出、总量和 event 数，缓存命中率与总 token 占比按聚合值计算。

历史 event 缺少 provider ID，但已有 `providerType` 和 `model`；读取时按后者回退即可。备选方案是升级 schema 或重写历史账本；它们不能可靠推导旧 provider ID，且会增加迁移风险，故不采用。

### 以日期选择和单日模型明细实现两层 surface 状态

`UsageCommandSurface` 和 handler 数据显式表达 `daily`、`dayModels` 两种视图：

- `daily`：展示全部记录的按日合计，维护选中日期与可见日期窗口；
- `dayModels`：使用选中日期过滤 event，展示当日按 provider ID/模型聚合、按总 token 降序排列的模型行，并维护模型可见窗口。

用户在日期列表中通过方向键、PageUp/PageDown、Home/End 选择并保持选中日期可见，通过 Enter 下钻。当日模型明细使用方向键、PageUp/PageDown、Home/End 滚动；Esc 或 Backspace 返回保留日期选择的列表，`q` 在任意视图关闭，日期列表的 Esc 关闭 command。

备选方案是保留跨日期模型总览，或将每个模型的日期行展开在同一个表中。前者偏离按日排查路径，后者会在模型和日期都较多时超出 footer 的行、列边界，因此不采用。

### 使用渐进式列投影适配终端宽度

usage surface 最大卡片宽度由 82 列增至 112 列，以容纳较长的 `provider_id/model` 身份与完整用量列。当日模型明细的完整行包含该身份、输入、输出、缓存、命中率、总 token、event 数和相对总量条。渲染器根据安全可用宽度依次移除趋势条、event 数、缓存与命中率等次要信息，但必须保留模型身份、总 token 以及输入和输出数值。日期列表沿用既有每日表格的列裁剪规则，并增加选中日期标记。

备选方案是固定宽度截断整张表或提供水平滚动。前者会掩盖关键数值，后者会增加 footer 交互和状态复杂度，故不采用。

## Risks / Trade-offs

- [provider ID 或模型标识很长，模型数量很多] → 对身份标签安全截断，模型明细使用窗口滚动，不尝试在单屏显示全部行。
- [既有 JSONL 含异常或旧行] → 延续当前逐行容错和 schema 校验；无效行不参与任何按日或按模型统计。
- [同一模型在不同 provider 配置下出现] → 新 event 以 `(providerId, model)` 分开统计，历史 event 回退到 `(providerType, model)`。
- [新增 providerId 导致旧账本行被拒绝] → 字段保持可选，行校验接受缺失值并在聚合时使用稳定回退。
- [新增状态使导航回归] → 将布局窗口计算和索引钳制提取为纯函数，覆盖默认按天、日期选择、下钻、返回、小尺寸和空数据场景。
- [全量读取在账本长期增长后变慢] → 本变更继续采用现有全量读取模型；若实际观测到性能问题，再单独提议范围过滤或索引，不提前引入缓存一致性问题。

## Migration Plan

发布时直接读取既有 JSONL 文件；无需数据迁移。升级后 `/usage` 默认仍显示此前的按日合计，选择日期后即可查看该日模型明细；新写入的 event 将额外携带 provider ID。

若需要回滚，只移除新查询和 UI 状态即可；因为没有写入新 schema 或修改历史数据，旧版本仍能读取原账本。

## Open Questions

无。第一版只支持在当前每日列表中选择日期；日期范围筛选与费用估算在有明确产品需求时另行提案。

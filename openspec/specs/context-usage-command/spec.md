# context-usage-command Specification

## Purpose
定义 `/context` 本地 slash command、provider context usage 分类估算，以及只读 context usage 详情 surface 的行为。
## Requirements
### Requirement: `/context` command 展示详细 context usage
系统 SHALL 提供 `/context` slash command，用于展示最近一次真实 provider request 的 context usage 详情。详情 SHALL 包含 used tokens、context window、窗口占用百分比，以及按 System prompt、Tools、Messages、Reasoning 顶层分类组织的 token breakdown；Memory 与 Skills SHALL 作为 System prompt 的子项展示。

#### Scenario: 显示最近 provider usage 详情
- **WHEN** app 已收到最近一次真实 provider context usage
- **AND** 用户提交 `/context`
- **THEN** 系统 SHALL 打开 context usage 详情 surface
- **AND** surface SHALL 显示 used tokens 和 context window
- **AND** surface SHALL 显示窗口占用百分比
- **AND** surface SHALL 显示 System prompt、Tools、Messages、Reasoning 的顶层分类占用
- **AND** surface SHALL 在 System prompt 下显示非零的 Memory 与 Skills 子项
- **AND** System prompt 的展示 token 数 SHALL 等于底层 System prompt、Memory 与 Skills segment 的 token 数之和

#### Scenario: 无 provider usage 时提示不可用
- **WHEN** app 尚未收到真实 provider context usage
- **AND** 用户提交 `/context`
- **THEN** 系统 SHALL 显示暂无 context usage 的提示
- **AND** 系统 SHALL NOT 使用本地实时估算冒充 provider usage
- **AND** 系统 SHALL NOT 追加 transcript record

#### Scenario: context command 不触发 agent 请求
- **WHEN** 用户提交 `/context`
- **THEN** command runtime SHALL 将该输入视为本地命令消费
- **AND** app SHALL NOT 将 `/context` 作为 user message 提交给 agent
- **AND** app SHALL NOT 因该命令启动 provider request

### Requirement: context usage 分类计算
系统 SHALL 基于最近一次 provider request 快照估算 context usage 分类占用，并 SHALL 将分类 token 校准到 provider 返回的真实 `usageInputTokens` 总量。分类 token 总和 SHALL 等于该次 usage 的 used tokens。

#### Scenario: 分类总和等于 provider used tokens
- **WHEN** provider 返回 `usageInputTokens`
- **AND** 系统生成 context usage breakdown
- **THEN** 所有分类 segment 的 tokens 总和 SHALL 等于 `usageInputTokens`
- **AND** context usage 的 used tokens SHALL 等于 `usageInputTokens`

#### Scenario: system prompt、memory 和 skill catalog 分别计入对应分类
- **WHEN** agent loop 为 provider request 注入内置 system prompt、用户 memory、实际选中的展开或折叠 agent memory prompt 和 skill catalog
- **THEN** 系统 SHALL 将用户 memory 与该轮 agent memory prompt 以外的内置 system prompt 估算 tokens 归入 System prompt 分类
- **AND** 系统 SHALL 将用户 memory 与该轮实际注入的完整 agent memory prompt 估算 tokens 归入 Memory 分类
- **AND** 系统 SHALL 将 skill catalog 的估算 tokens 归入 Skills 分类

#### Scenario: 工具定义和工具历史计入 Tools
- **WHEN** provider request 包含可用工具定义
- **THEN** 系统 SHALL 将工具定义估算 tokens 归入 Tools 分类
- **AND** provider-visible `tool_call` 与 `tool_result` 历史 SHALL 归入 Tools 分类
- **AND** `read_memory` 返回的 catalog 内容 SHALL 作为普通 tool result 归入 Tools 分类

#### Scenario: 用户、assistant 消息和 shell 上下文计入 Messages
- **WHEN** provider request 包含 user records、压缩摘要注入消息或进入上下文的 shell records
- **OR** provider request 包含 assistant text records
- **THEN** 系统 SHALL 将这些内容归入 Messages 分类
- **AND** `includeInContext: false` 的 shell records SHALL NOT 计入 Messages 分类
- **AND** tool call records SHALL NOT 归入 Messages 分类

#### Scenario: provider reasoning carry-over 计入 Reasoning
- **WHEN** provider request 包含 provider-visible reasoning carry-over records
- **THEN** 系统 SHALL 将这些 records 归入 Reasoning 分类
- **AND** 本地 `reasoning_summary` records SHALL NOT 计入 Reasoning 分类

### Requirement: context usage 详情 surface
系统 SHALL 使用只读 command surface 展示 context usage 详情。该 surface SHALL 采用 demo 风格的终端卡片、窗口占用 gauge、顶层分类 composition bar、颜色 swatch 和层级分类明细，并 SHALL 可通过用户按键关闭。

#### Scenario: 详情 surface 展示层级分类元素
- **WHEN** `/context` 打开详情 surface
- **THEN** surface SHALL 显示带标题的 context 卡片
- **AND** surface SHALL 显示整体窗口占用 gauge
- **AND** surface SHALL 显示由 System prompt、Tools、Messages、Reasoning 非零顶层分类组成的 composition bar
- **AND** composition bar 的分类 token 总和 SHALL 等于 used tokens
- **AND** surface SHALL 显示每个非零顶层分类的颜色 swatch、token 数和占 used tokens 百分比
- **AND** surface SHALL 使用缩进或树形连接符将非零 Memory 与 Skills 显示为 System prompt 子项
- **AND** Memory 与 Skills SHALL NOT 在 composition bar 中作为独立顶层区段重复展示
- **AND** Memory 与 Skills 子项 SHALL 显示 token 数且 SHALL NOT 显示可与父项相加的全局百分比

#### Scenario: 用户关闭 context surface
- **WHEN** context usage 详情 surface 正在显示
- **AND** 用户按下关闭键或任意非中断键
- **THEN** 系统 SHALL 关闭该 surface 并回到普通 composer footer
- **AND** 系统 SHALL NOT 修改 transcript records

#### Scenario: 小终端下保持 footer 布局安全
- **WHEN** context usage 详情 surface 在较小 terminal rows 或 columns 下渲染
- **THEN** surface SHALL 遵循 footer 的安全宽度和最大行数约束
- **AND** surface SHALL NOT 因写满最后一列触发额外自动换行
- **AND** surface SHALL 在需要裁剪分类明细时先省略 Memory 与 Skills 子项，再省略 usage 总览或顶层分类信息
- **AND** surface MAY 继续裁剪次要留白或明细行以保持布局稳定


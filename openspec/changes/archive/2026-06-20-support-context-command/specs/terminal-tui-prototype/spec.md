## MODIFIED Requirements

### Requirement: status line 显示真实 context usage
普通输入态 status line SHALL 在存在真实 provider context usage 时显示最近一次 provider request 的 input token usage 和当前模型 context window。该显示 SHALL 作为 segmented status line 的 context segment 呈现，并 SHALL 使用短文本片段；该 usage 的语义仍为最近一次真实 provider usage，而不是本地实时估算。系统 SHALL 保留该 usage 的详细 breakdown 供 `/context` 命令展示，但 status line SHALL 继续只显示短文本总览。

#### Scenario: status line 显示最近 usage
- **WHEN** app 已收到真实 provider context usage
- **AND** footer 处于普通输入态且没有 command、approval 或 user-question surface
- **THEN** status line SHALL 显示 context usage segment
- **THEN** context usage segment SHALL 包含 used tokens 和 context window
- **THEN** context usage segment SHALL 使用 `ctx <used>/<window>` 或等价短文本表达，例如 `ctx 18.2k/128k`

#### Scenario: 没有真实 usage 时不显示 context usage
- **WHEN** app 尚未收到真实 provider context usage
- **THEN** status line SHALL 保持既有模型、effort、目录和 mode 显示
- **THEN** status line SHALL NOT 显示本地估算 context usage

#### Scenario: command surface 替换 status line
- **WHEN** command surface、tool approval surface 或 user-question surface 正在显示
- **THEN** footer SHALL 继续使用该 surface 自身内容替换普通 composer/status line 区域
- **THEN** context usage SHALL NOT 额外显示为独立行

#### Scenario: status line 不展示详细 breakdown
- **WHEN** app 已收到带分类 breakdown 的真实 provider context usage
- **AND** footer 处于普通输入态且没有 command、approval 或 user-question surface
- **THEN** status line SHALL 继续仅显示 context usage 短文本总览
- **AND** status line SHALL NOT 展示 System prompt、Skills、Tools、Messages 或 Reasoning 的分类明细

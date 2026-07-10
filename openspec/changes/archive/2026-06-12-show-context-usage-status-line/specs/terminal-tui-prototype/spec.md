## ADDED Requirements

### Requirement: status line 显示真实 context usage
普通输入态 status line SHALL 在存在真实 provider context usage 时显示最近一次 provider request 的 input token usage 和当前模型 context window。该显示 SHALL 使用短文本片段，并 SHALL 明确表达这是最近一次真实 usage，而不是本地实时估算。

#### Scenario: status line 显示最近 usage
- **WHEN** app 已收到真实 provider context usage
- **AND** footer 处于普通输入态且没有 command、approval 或 user-question surface
- **THEN** status line SHALL 显示 context usage 片段
- **THEN** context usage 片段 SHALL 包含 used tokens 和 context window
- **THEN** context usage 片段 SHALL 表达最近一次 provider request 语义，例如 `ctx last 18.2k/128k`

#### Scenario: 没有真实 usage 时不显示 context usage
- **WHEN** app 尚未收到真实 provider context usage
- **THEN** status line SHALL 保持既有模型、项目、mode 和 key hint 显示
- **THEN** status line SHALL NOT 显示本地估算 context usage

#### Scenario: command surface 替换 status line
- **WHEN** command surface、tool approval surface 或 user-question surface 正在显示
- **THEN** footer SHALL 继续使用该 surface 自身内容替换普通 composer/status line 区域
- **THEN** context usage SHALL NOT 额外显示为独立行

#### Scenario: status line 保持单行裁剪
- **WHEN** status line 包含 context usage 且终端宽度不足以显示完整内容
- **THEN** status line SHALL 继续按现有安全宽度裁剪为单行
- **THEN** footer SHALL NOT 因 context usage 产生额外换行

#### Scenario: token 数使用紧凑格式
- **WHEN** status line 渲染 context usage
- **THEN** token 数小于 1000 时 SHALL 直接显示整数
- **THEN** token 数大于等于 1000 时 SHALL 使用紧凑 `k` 格式显示

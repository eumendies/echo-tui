## ADDED Requirements

### Requirement: 查询 OpenCode Go 订阅用量
当活动 provider 的 baseURL 命中 OpenCode Go 服务(hostname 为 `opencode.ai` 且路径以 `/zen/go/` 开头,覆盖 `opencode-go`、`opencode-go-responses`、`opencode-go-anthropic` 三个预设)时,系统 SHALL 使用活动 config 的 API key 以 Bearer 方式查询 `GET https://opencode.ai/zen/go/v1/usage`,并 SHALL 把响应归一化为 5 小时、每周、每月三个配额窗口的窗口名、状态、百分比与重置时间。查询与解析过程 MUST NOT 在错误信息中暴露 API key 或原始敏感响应。baseURL 未命中时系统 SHALL NOT 发起该请求。

#### Scenario: 成功查询三个配额窗口
- **WHEN** 活动 provider baseURL 命中 OpenCode Go 且 usage endpoint 返回有效数据
- **THEN** 系统 SHALL 使用 Bearer API key 发起请求
- **AND** 查询结果 SHALL 包含各窗口的窗口名、状态、百分比与重置时间
- **AND** 窗口顺序 SHALL 固定为 rolling、weekly、monthly,未知窗口键排在已知键之后

#### Scenario: 非 OpenCode Go provider 不发起用量请求
- **WHEN** 活动 provider baseURL 未命中 OpenCode Go
- **AND** 用户提交 `/status`
- **THEN** 系统 SHALL NOT 请求 usage endpoint
- **AND** status surface SHALL NOT 显示 OpenCode Go 用量区域

#### Scenario: 响应残缺时整块降级
- **WHEN** usage endpoint 返回非成功状态、响应不是有效 JSON,usage 对象缺失,或任一窗口缺少有效的 status、percent、resetsAt
- **THEN** 该用量查询 SHALL 判为不可用并向 status surface 提供经过脱敏的错误摘要
- **AND** 系统 SHALL NOT 追加 transcript error
- **AND** status surface SHALL 保留其余运行状态信息

#### Scenario: 百分比规范到闭区间
- **WHEN** 某窗口的 percent 数值超出 0 至 100 的范围
- **THEN** 系统 SHALL 把百分比规范到 0 至 100 的闭区间后再进入展示层

### Requirement: status surface 展示 OpenCode Go 用量
OpenCode Go 用量可用时,status surface SHALL 分别以进度条展示 5 小时、每周、每月三个配额窗口,并 SHALL 同时展示数值百分比与重置时间;已用达到或超过 100% 的窗口 SHALL 以警示色呈现。查询期间和不可用时 SHALL 展示对应状态文本,行为与 Codex 用量区域一致。

#### Scenario: 渲染三个配额窗口
- **WHEN** OpenCode Go 用量查询成功
- **THEN** surface SHALL 为每个窗口渲染一条按已用百分比缩放的进度条
- **AND** 每个窗口 SHALL 显示数值百分比和重置时间
- **AND** 未知的窗口名 SHALL 以原始名称展示

#### Scenario: 查询期间与不可用状态
- **WHEN** `/status` surface 已打开且 OpenCode Go 用量查询尚未结束,或查询失败
- **THEN** surface SHALL 立即显示已取得的本地运行状态
- **AND** OpenCode Go 用量区域 SHALL 展示查询中或经过脱敏的不可用状态文本
- **AND** 查询完成仍处于同一个 status session 时 surface SHALL 更新为成功或不可用状态

#### Scenario: 忽略已关闭 surface 的迟到结果
- **WHEN** 用户在 OpenCode Go 用量查询完成前关闭或替换 status surface
- **THEN** 迟到的查询结果 SHALL NOT 重新打开或覆盖当前 command surface
- **AND** 迟到结果 SHALL NOT 修改 transcript records

# status-command Specification

## Purpose
TBD - created by archiving change add-status-codex-usage. Update Purpose after archive.
## Requirements
### Requirement: `/status` command 展示当前运行状态
系统 SHALL 提供精确匹配的 `/status` slash command，并 SHALL 在只读 command surface 中展示当前目录、生效的 AGENTS.md 来源、有效 memory 摘要、当前 model/provider 和 session id。该命令 SHALL NOT 展示 context token 占用。

#### Scenario: 展示当前运行状态
- **WHEN** 用户提交 `/status`
- **THEN** 系统 SHALL 打开 status command surface
- **AND** surface SHALL 展示当前工作目录
- **AND** surface SHALL 展示当前请求会采用的 AGENTS.md 文件来源
- **AND** surface SHALL 展示启用的用户 memory 数量和有效 agent memory catalog 摘要
- **AND** surface SHALL 展示当前 model 和 provider
- **AND** surface SHALL 展示当前 session id，尚未创建持久化 session 时 SHALL 显示稳定的未创建状态
- **AND** surface SHALL NOT 展示 context used tokens、context window 或 context 分类占用

#### Scenario: status command 保持本地只读语义
- **WHEN** 用户提交 `/status`
- **THEN** command runtime SHALL 将输入作为本地命令消费
- **AND** 系统 SHALL NOT 将 `/status` 作为 user message 提交给 agent
- **AND** 系统 SHALL NOT 追加 transcript record

#### Scenario: 拒绝额外参数
- **WHEN** 用户提交带额外参数的 `/status` 输入
- **THEN** 系统 SHALL NOT 将其匹配为 `/status` command
- **AND** slash command 解析 SHALL 保持与其他纯命令一致的精确匹配语义

### Requirement: 查询 Codex OAuth 限额用量
当当前 provider 为 Codex OAuth 时，系统 SHALL 使用现有 Codex OAuth 凭据解析与刷新能力查询 Codex usage endpoint，并 SHALL 将响应归一化为 5 小时主窗口和每周次窗口的已用百分比与重置时间。查询与解析过程 MUST NOT 暴露 access token、refresh token、账号标识或原始敏感响应。

#### Scenario: 成功查询两个限额窗口
- **WHEN** 当前 provider 为 Codex OAuth
- **AND** usage endpoint 返回有效的主窗口与次窗口数据
- **THEN** 系统 SHALL 使用 Bearer access token 发起请求
- **AND** 存在 account id 时请求 SHALL 携带 Codex 账号 header
- **AND** 查询结果 SHALL 包含 5 小时窗口和每周窗口的已用百分比与重置时间
- **AND** 已用百分比 SHALL 被规范到 0 至 100 的闭区间

#### Scenario: 服务未提供每周窗口
- **WHEN** 当前 provider 为 Codex OAuth
- **AND** usage endpoint 返回有效主窗口但 `secondary_window` 为 null 或缺失
- **THEN** 系统 SHALL 保留 5 小时窗口的可用进度
- **AND** status surface SHALL 将每周窗口显示为暂无数据
- **AND** 系统 SHALL NOT 将整个 Codex 用量区域判为查询失败

#### Scenario: 查询前刷新过期凭据
- **WHEN** 当前 Codex OAuth access token 已过期且存在 refresh token
- **AND** 用户提交 `/status`
- **THEN** 系统 SHALL 复用现有凭据刷新流程取得可用 access token
- **AND** 系统 SHALL 使用刷新后的凭据查询用量

#### Scenario: 非 Codex provider 不发起用量请求
- **WHEN** 当前 provider 不是 Codex OAuth
- **AND** 用户提交 `/status`
- **THEN** 系统 SHALL NOT 请求 Codex usage endpoint
- **AND** status surface SHALL NOT 显示 Codex 用量区域

#### Scenario: 用量查询失败时降级
- **WHEN** Codex 凭据不可用、网络请求失败、服务返回非成功状态或响应缺少有效窗口数据
- **THEN** status surface SHALL 保留其他运行状态信息
- **AND** Codex 用量区域 SHALL 显示经过脱敏的不可用摘要
- **AND** 系统 SHALL NOT 追加 transcript error
- **AND** 系统 SHALL NOT 因查询失败退出 TUI 或修改 transcript records

### Requirement: status surface 以进度条展示 Codex 用量
系统 SHALL 使用 footer command surface 展示 status 数据。Codex 用量可用时，surface SHALL 分别使用带填充轨道的进度条展示 5 小时和每周窗口，并 SHALL 同时展示数值百分比与重置时间；查询期间和不可用时 SHALL 展示对应状态文本。

#### Scenario: 渲染 Codex 用量进度条
- **WHEN** Codex 用量查询成功
- **THEN** surface SHALL 为 5 小时窗口渲染一条按已用百分比缩放的进度条
- **AND** surface SHALL 为每周窗口渲染一条按已用百分比缩放的进度条
- **AND** 每个窗口 SHALL 显示数值百分比和重置时间
- **AND** 进度条 SHALL 使用当前主题颜色并区分填充部分与剩余轨道

#### Scenario: 查询期间显示加载状态
- **WHEN** `/status` surface 已打开且 Codex 用量查询尚未结束
- **THEN** surface SHALL 立即显示已取得的本地运行状态
- **AND** Codex 用量区域 SHALL 显示查询中状态
- **AND** 查询完成后仍处于同一个 status session 时 surface SHALL 更新为成功或不可用状态

#### Scenario: 忽略已关闭 surface 的迟到结果
- **WHEN** 用户在 Codex 用量查询完成前关闭或替换 status surface
- **THEN** 迟到的查询结果 SHALL NOT 重新打开或覆盖当前 command surface
- **AND** 迟到结果 SHALL NOT 修改 transcript records

#### Scenario: 关闭 status surface
- **WHEN** status surface 正在显示
- **AND** 用户按下 Esc、Enter 或 `q`
- **THEN** 系统 SHALL 关闭该 surface 并回到普通 composer footer
- **AND** 系统 SHALL NOT 修改 transcript records

#### Scenario: 小终端下保持布局安全
- **WHEN** status surface 在较小 terminal rows 或 columns 下渲染
- **THEN** surface SHALL 遵循 footer 的安全宽度和最大行数约束
- **AND** surface SHALL NOT 因写满最后一列触发额外自动换行
- **AND** surface MAY 裁剪路径、memory 摘要或重置时间，但 MUST 保留两个可用窗口的标签、进度和百分比

### Requirement: 查询 OpenCode Go 订阅用量
当活动 provider 的 baseURL 命中 OpenCode Go 服务(hostname 为 `opencode.ai` 且路径以 `/zen/go/` 开头，覆盖 `opencode-go`、`opencode-go-responses`、`opencode-go-anthropic` 三个预设)时，系统 SHALL 使用活动 config 的 API key 以 Bearer 方式查询 `GET https://opencode.ai/zen/go/v1/usage`，并 SHALL 把响应归一化为 5 小时、每周、每月三个配额窗口的窗口名、状态、百分比与重置时间。查询与解析过程 MUST NOT 在错误信息中暴露 API key 或原始敏感响应。baseURL 未命中时系统 SHALL NOT 发起该请求。

#### Scenario: 成功查询三个配额窗口
- **WHEN** 活动 provider baseURL 命中 OpenCode Go 且 usage endpoint 返回有效数据
- **THEN** 系统 SHALL 使用 Bearer API key 发起请求
- **AND** 查询结果 SHALL 包含各窗口的窗口名、状态、百分比与重置时间
- **AND** 窗口顺序 SHALL 固定为 rolling、weekly、monthly，未知窗口键排在已知键之后

#### Scenario: 非 OpenCode Go provider 不发起用量请求
- **WHEN** 活动 provider baseURL 未命中 OpenCode Go
- **AND** 用户提交 `/status`
- **THEN** 系统 SHALL NOT 请求 usage endpoint
- **AND** status surface SHALL NOT 显示 OpenCode Go 用量区域

#### Scenario: 响应残缺时整块降级
- **WHEN** usage endpoint 返回非成功状态、响应不是有效 JSON，usage 对象缺失，或任一窗口缺少有效的 status、percent、resetsAt
- **THEN** 该用量查询 SHALL 判为不可用并向 status surface 提供经过脱敏的错误摘要
- **AND** 系统 SHALL NOT 追加 transcript error
- **AND** status surface SHALL 保留其余运行状态信息

#### Scenario: 百分比规范到闭区间
- **WHEN** 某窗口的 percent 数值超出 0 至 100 的范围
- **THEN** 系统 SHALL 把百分比规范到 0 至 100 的闭区间后再进入展示层

### Requirement: status surface 展示 OpenCode Go 用量
OpenCode Go 用量可用时，status surface SHALL 分别以进度条展示 5 小时、每周、每月三个配额窗口，并 SHALL 同时展示数值百分比与重置时间；已用达到或超过 100% 的窗口 SHALL 以警示色呈现。查询期间和不可用时 SHALL 展示对应状态文本，行为与 Codex 用量区域一致。

#### Scenario: 渲染三个配额窗口
- **WHEN** OpenCode Go 用量查询成功
- **THEN** surface SHALL 为每个窗口渲染一条按已用百分比缩放的进度条
- **AND** 每个窗口 SHALL 显示数值百分比和重置时间
- **AND** 未知的窗口名 SHALL 以原始名称展示

#### Scenario: 查询期间与不可用状态
- **WHEN** `/status` surface 已打开且 OpenCode Go 用量查询尚未结束，或查询失败
- **THEN** surface SHALL 立即显示已取得的本地运行状态
- **AND** OpenCode Go 用量区域 SHALL 展示查询中或经过脱敏的不可用状态文本
- **AND** 查询完成仍处于同一个 status session 时 surface SHALL 更新为成功或不可用状态

#### Scenario: 忽略已关闭 surface 的迟到结果
- **WHEN** 用户在 OpenCode Go 用量查询完成前关闭或替换 status surface
- **THEN** 迟到的查询结果 SHALL NOT 重新打开或覆盖当前 command surface
- **AND** 迟到结果 SHALL NOT 修改 transcript records


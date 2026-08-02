## MODIFIED Requirements

### Requirement: 压缩后的请求投影
系统 SHALL 在存在压缩状态时按「system prompt + 摘要消息 + 活跃区间」投影 provider 请求。摘要 SHALL 作为一条 `user` 消息置于内置 system prompt 之后、活跃区间之前。活跃区间 SHALL 为 `records[activeStartIndex:]`，按现有转换规则投影。无压缩状态时 SHALL 退化为现有「system prompt + 全部记录」投影。当当前 session 的 journal 源路径可用时，摘要消息 SHALL 附加该 `source_file` 绝对路径，并提示模型仅在需要精确细节时使用现有 `read_files` 工具分页读取该文件；路径不可用（如 headless 单轮运行）时 SHALL 只注入摘要本身。

#### Scenario: 存在压缩状态时注入摘要并切片
- **WHEN** session 存在压缩状态且发起 provider 请求
- **THEN** provider input SHALL 在 system prompt 之后包含一条携带摘要文本的 `user` 消息
- **THEN** provider input SHALL 只包含 `records[activeStartIndex:]` 投影出的记录，而不是全部记录

#### Scenario: 存在源路径时注入回读提示
- **WHEN** session 存在压缩状态、发起 provider 请求且当前 session 的 journal 源路径可用
- **THEN** 摘要消息 SHALL 附带 `source_file: <绝对路径>` 行
- **THEN** 摘要消息 SHALL 提示模型仅在需要精确细节时使用现有 `read_files` 工具分页读取该文件
- **THEN** 系统 SHALL NOT 注册或暴露新的专用会话读取工具

#### Scenario: 源路径不可用时只注入摘要
- **WHEN** session 存在压缩状态、发起 provider 请求且当前 session 无 journal 源路径（如 headless 单轮运行）
- **THEN** 摘要消息 SHALL NOT 包含 `source_file` 行或回读提示
- **THEN** 摘要消息 SHALL 继续包含摘要文本本身

#### Scenario: 无压缩状态时退化为全量投影
- **WHEN** session 不存在压缩状态且发起 provider 请求
- **THEN** provider input SHALL 包含全部可发送记录
- **THEN** provider input SHALL NOT 包含摘要消息

## ADDED Requirements

### Requirement: 路径解析收敛于 app 层
系统 SHALL 在 app 层根据当前 cwd 与 session id 实时计算当前 session journal 的绝对路径，并通过 `AgentSessionInput` 的可选字段传给 agent runtime。该路径 SHALL NOT 被持久化进 `CompactionState` 或任何 journal 操作；headless 单轮运行没有 transcript store，SHALL NOT 提供该字段。

#### Scenario: 交互式运行提供源路径
- **WHEN** 交互式 TUI 中当前 session 已创建且 app 组装 agent session
- **THEN** `AgentSessionInput` SHALL 携带指向当前 session journal 的绝对路径
- **THEN** 该路径 SHALL 由 transcript store 的 session 文件路径规则派生

#### Scenario: headless 单轮运行不提供源路径
- **WHEN** 通过 `--once` 以 headless 模式运行且没有 transcript store
- **THEN** `AgentSessionInput` SHALL NOT 携带源路径字段
- **THEN** 压缩行为 SHALL 不因路径缺失而改变摘要生成或边界计算

#### Scenario: 路径不写入持久化状态
- **WHEN** 任意压缩发生且 app 层已计算出源路径
- **THEN** journal 中的 `set_compaction` 操作与 `CompactionState` 结构 SHALL 保持不变
- **THEN** 源路径 SHALL 只出现在 provider-facing 摘要消息中
- **THEN** 可见的 `compaction_notice` 记录 SHALL 保持既有文本，不包含源路径

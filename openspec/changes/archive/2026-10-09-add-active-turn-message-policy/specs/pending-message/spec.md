## MODIFIED Requirements

### Requirement: Active assistant turn 期间可排队一条用户输入
系统 SHALL 在 active assistant turn 占用 response lock 时，允许用户通过 Enter 接收一条非空 composer 输入，但显式声明可在 active assistant turn 期间启动且当前命中的 slash command SHALL 优先立即执行而不进入待处理状态。当前 turn 的消息策略为 `pending` 时，其他输入 SHALL 保持本规范的待发送语义；策略为 `steer` 时，普通用户消息 SHALL 遵循 `active-turn-steering` 规范，而需要 idle 路由的 slash command、skill invocation 或 shell 输入 SHALL 仍进入 pending。pending 和尚未提交的 steer 输入 SHALL 共用一个独立 transient 单槽，准备中的 steer 输入也占用该槽。排队时 SHALL 消费当时的 composer 草稿，但 SHALL NOT 追加 transcript record、启动新的 provider request 或把 pending 输入注入当前 assistant turn。

#### Scenario: 响应期间排队非空普通草稿
- **WHEN** active assistant turn 正在 thinking、streaming、执行工具或等待 continuation，且该 turn 使用 `pending`
- **AND** composer 包含不匹配响应期可用命令的非空输入且当前没有待处理消息
- **AND** 用户按 Enter
- **THEN** 系统 SHALL 保存一条待发送原始文本
- **THEN** 系统 SHALL 清空当时的 composer 草稿并允许用户继续编辑
- **THEN** 当前 transcript 和正在运行的 provider request SHALL 不包含该待发送输入

#### Scenario: 响应期可用命令不进入单槽
- **WHEN** active assistant turn 正在运行
- **AND** composer 输入命中显式声明响应期可用的 slash command
- **AND** 用户按 Enter
- **THEN** 系统 SHALL 立即启动对应 command handler
- **THEN** 系统 SHALL NOT 把该命令保存为待发送输入

#### Scenario: 空 composer 不创建待发送消息
- **WHEN** active assistant turn 仍在运行且 composer 为空
- **AND** 用户按 Enter
- **THEN** 系统 SHALL NOT 创建待处理消息
- **THEN** 系统 SHALL NOT 追加 user transcript record 或启动新的 provider request

#### Scenario: 普通排队消息保留接收时选择
- **WHEN** 用户按 pending 策略以 plan 或 normal 提交普通消息，随后为下一条输入选择其他 mode
- **THEN** 已接收普通消息下一轮发送时 SHALL 保持自身接收时的 mode
- **THEN** 系统 SHALL NOT 将其改为后来选择的 shell 命令或覆盖其 mode

#### Scenario: 单槽已有消息时不覆盖
- **WHEN** active assistant turn 仍在运行且已经存在一条 pending 或未提交 steer 消息
- **AND** 用户在 composer 输入另一条不匹配响应期可用命令的草稿后按 Enter
- **THEN** 系统 SHALL 保留原待处理消息不变
- **THEN** 系统 SHALL 保留当前 composer 草稿不变
- **THEN** 系统 SHALL NOT 创建第二条待处理消息

#### Scenario: 已有单槽不阻止响应期命令
- **WHEN** active assistant turn 仍在运行且已经存在一条待处理消息
- **AND** 用户提交显式声明响应期可用的 slash command
- **THEN** 系统 SHALL 立即启动该命令
- **THEN** 原待处理消息 SHALL 保持不变

#### Scenario: 非 assistant response lock 不借用待发送队列
- **WHEN** 系统处于 shell command、手动 compact、MCP bootstrap 或 conversation reference preparation 状态且没有 active assistant turn
- **AND** 用户按 Enter
- **THEN** 系统 SHALL 遵循该状态已有的提交或阻止语义
- **THEN** 系统 SHALL NOT 因该 Enter 创建 pending message

#### Scenario: steer 策略不把下一轮命令转换为提示词
- **WHEN** active assistant turn 使用 `steer`
- **AND** 用户提交需要 idle 处理的本地 slash command、direct skill invocation 或 shell 输入
- **AND** 待处理单槽为空
- **THEN** 系统 SHALL 保存为 pending 并在当前 turn 结束后按正常路由处理
- **THEN** 系统 SHALL NOT 抢占当前模型或改变当前运行的模型、模式和工具权限

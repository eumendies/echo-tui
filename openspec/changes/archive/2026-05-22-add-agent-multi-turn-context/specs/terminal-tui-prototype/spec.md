## ADDED Requirements

### Requirement: agent 多轮 transcript 上下文
系统 SHALL 在普通用户消息提交时，把当前 transcript records 作为 agent 输入，使模型能够看到当前会话中已经提交并完成的上下文。当前 transcript SHALL 是本地会话事实源；app 层 SHALL NOT 额外维护一份同构 agent message history。

#### Scenario: 第二轮普通消息携带历史上下文
- **WHEN** 当前 transcript records 已包含一轮 user / assistant 对话，且用户提交第二轮普通消息
- **THEN** 系统 SHALL 先把第二轮 user record 追加到当前 transcript
- **THEN** 系统 SHALL 使用包含第一轮 user、第一轮 assistant 和第二轮 user 的 transcript records 调用 agent
- **THEN** 系统 SHALL NOT 只把第二轮用户文本传给 agent

#### Scenario: resume 后继续对话携带恢复上下文
- **WHEN** 用户通过 `/resume` 恢复某个 session 后继续提交普通消息
- **THEN** 系统 SHALL 使用恢复出的 transcript records 加上本轮 user record 调用 agent
- **THEN** 系统 SHALL NOT 为恢复动作本身追加额外 prompt record

#### Scenario: clear 后上下文断开
- **WHEN** 用户通过 `/clear` 确认清空 transcript 后提交新的普通消息
- **THEN** 系统 SHALL 使用清空后的当前 transcript records 调用 agent
- **THEN** 系统 SHALL NOT 把 `/clear` 前旧 session 的 records 传给 agent

### Requirement: transcript error role
系统 SHALL 支持 `error` transcript role 表示本地错误反馈。`error` record SHALL 作为 transcript 的可见、可持久化记录参与 session 恢复，但 SHALL NOT 被视为 assistant 回复发送给 agent。

#### Scenario: agent 失败追加 error record
- **WHEN** agent 在 thinking 或 streaming 期间失败
- **THEN** 系统 SHALL 清空 pending preview 并释放 response lock
- **THEN** 系统 SHALL 追加一条 `role: 'error'` 的 transcript record 作为可见反馈
- **THEN** 该 record 文本 SHALL 不包含敏感配置值

#### Scenario: error record 可恢复可显示
- **WHEN** 包含 `error` record 的 session 被持久化并通过 `/resume` 恢复
- **THEN** 系统 SHALL 恢复该 `error` record
- **THEN** transcript 渲染 SHALL 为该 `error` record 提供可见投影

## MODIFIED Requirements

### Requirement: 真实 assistant 生命周期
系统 SHALL 支持真实 assistant response 生命周期：用户普通消息提交后进入 thinking 状态，随后以真实模型服务返回的文本增量更新 streaming preview，并在成功完成后提交最终 assistant block。fake assistant MAY 作为测试或显式开发注入实现，但 CLI 默认普通对话 SHALL 使用真实 LLM adapter，且 agent SHALL 接收当前 transcript records 作为多轮上下文输入。

#### Scenario: thinking 状态先于 streaming
- **WHEN** 用户普通消息被提交并启动 assistant response
- **THEN** footer pending preview SHALL 在首个真实文本增量到达前显示 assistant thinking 状态

#### Scenario: streaming 展示真实文本增量
- **WHEN** 真实 LLM adapter 接收到文本增量
- **THEN** footer pending preview SHALL 按 adapter 提供的完整 draft 更新 streaming 文本
- **THEN** streaming 文本 SHALL 来自真实模型服务，而不是固定回显用户原始提交内容

#### Scenario: 完成后提交 assistant transcript
- **WHEN** 真实 LLM adapter 成功完成响应
- **THEN** pending preview SHALL 被清空，并且完成后的 assistant 消息 SHALL 被追加到 transcript

#### Scenario: 失败后释放响应锁
- **WHEN** 真实 LLM adapter 在 thinking 或 streaming 期间失败
- **THEN** pending preview SHALL 被清空
- **THEN** assistant response lock SHALL 被释放
- **THEN** 系统 SHALL 追加一条本地 `error` transcript record 作为可见反馈

#### Scenario: 测试注入 fake agent 不改变 CLI 默认行为
- **WHEN** 测试通过 `createApp(options).runAgent` 注入 fake 或 stub agent
- **THEN** app SHALL 按相同 callbacks contract 处理 thinking、streaming 和 completion
- **THEN** CLI 默认普通对话行为 SHALL 由真实 LLM adapter 提供
- **THEN** 注入的 fake 或 stub agent SHALL 接收当前 transcript records，而不是单个用户文本字符串

### Requirement: transcript 视觉标记
系统 SHALL 使用轻量符号和克制颜色区分 transcript 中的用户消息、assistant 消息、本地 error 消息和 pending assistant，而不是在 transcript 中显示 `user:`、`assistant:` 或 `error:` 文本标签。用户消息的整行背景 SHALL 在渲染投影阶段按当前终端宽度计算。

#### Scenario: 用户消息使用轻量前缀
- **WHEN** 用户消息被追加到 transcript
- **THEN** 该消息 SHALL 使用与 composer prompt 一致的 `>` 作为前缀，并使用覆盖整条消息行的灰色背景与 assistant 消息区分

#### Scenario: 用户消息 resize 后背景覆盖当前宽度
- **WHEN** 用户消息已经追加到 transcript 且终端随后变窄或变宽
- **THEN** 用户消息 SHALL 基于当前终端宽度重新渲染，灰色背景 SHALL 覆盖重新 wrap 后每一行的当前渲染宽度

#### Scenario: assistant 完成消息使用独立前缀
- **WHEN** assistant 消息完成并追加到 transcript
- **THEN** 该消息 SHALL 使用 `◆` 或等价符号作为前缀，并使用与用户消息不同的视觉样式

#### Scenario: error 消息使用独立可见投影
- **WHEN** 本地 error record 被追加或恢复到 transcript
- **THEN** 该消息 SHALL 使用区别于 user 和 assistant 的轻量可见样式
- **THEN** 该消息 SHALL NOT 显示为 `assistant` 回复

#### Scenario: transcript 不显示文字角色标签
- **WHEN** user、assistant 或 error 消息被渲染为 transcript block
- **THEN** transcript SHALL NOT 显示 `user:`、`assistant:` 或 `error:` 作为消息前缀

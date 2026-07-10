## ADDED Requirements

### Requirement: 本地 slash 命令与真实 adapter 隔离
系统 SHALL 保持本地 slash 命令与真实 LLM adapter 隔离。命中本地 slash handler 的输入 SHALL 继续由 command runtime 处理，而不是提交给真实 agent；纯 `/model` SHALL 打开只读模型信息面板，展示当前真实模型配置或安全配置错误，且不修改真实模型配置。

#### Scenario: 本地 slash 命令不启动真实 agent
- **WHEN** 用户提交纯 `/help`、`/model`、`/clear` 或 `/resume` 且命中对应本地 slash handler
- **THEN** 系统 SHALL 由 slash command runtime 处理该输入
- **THEN** 系统 SHALL NOT 调用真实 LLM adapter

#### Scenario: /model 显示当前真实模型信息
- **WHEN** 用户提交纯 `/model` 且当前 `~/.echo/config.json` 中存在有效的 `llm.model`
- **THEN** 系统 SHALL 打开只读 `info` command surface
- **THEN** 该面板 SHALL 展示当前生效的模型名
- **THEN** 系统 SHALL NOT 修改真实 LLM adapter 的模型配置

#### Scenario: /model 显示安全配置错误
- **WHEN** 用户提交纯 `/model` 但当前模型配置缺失、无效或无法读取
- **THEN** 系统 SHALL 打开只读 `info` command surface
- **THEN** 该面板 SHALL 展示可操作的安全错误摘要
- **THEN** 错误内容 SHALL NOT 包含敏感字段值

## MODIFIED Requirements

### Requirement: transcript 内容记录与重绘快照分离
系统 SHALL 将 transcript 的内容记录与 ANSI 渲染结果分离：已提交消息内容只追加记录，渲染层可以根据当前终端尺寸重新生成当前 app snapshot 的可见输出。

#### Scenario: 用户提交只追加内容记录
- **WHEN** 用户使用 Enter 提交 composer 内容
- **THEN** 应用 SHALL 追加一个 user transcript record，并且不修改更早的 transcript record 内容

#### Scenario: assistant 完成只追加内容记录
- **WHEN** assistant response 完成流式输出
- **THEN** 应用 SHALL 追加一个 assistant transcript record，内容为完成后的 assistant 输出

#### Scenario: resize 从当前状态重建快照
- **WHEN** 终端宽度变化
- **THEN** 应用 SHALL 基于已有 transcript records、当前 terminal size 和 footer state 重新生成当前 app snapshot 的渲染输出

### Requirement: append-only transcript
系统 SHALL 把已提交的用户消息和已完成的 assistant 消息作为 append-only transcript content records 处理，同时允许渲染层重算这些 records 在当前 app snapshot 中的可见投影。

#### Scenario: 用户提交追加 transcript record
- **WHEN** 用户使用 Enter 提交 composer 内容
- **THEN** 应用 SHALL 向 transcript records 追加一个用户消息记录，并且不修改更早的 transcript record 内容

#### Scenario: assistant 完成后追加 transcript record
- **WHEN** assistant response 完成流式输出
- **THEN** 应用 SHALL 追加一个 assistant 消息记录，内容为完成后的 assistant 输出

#### Scenario: 历史 transcript 内容不被修改
- **WHEN** footer 在输入、streaming 或 resize 期间重绘
- **THEN** 已提交的 transcript record 内容 SHALL 保持不变，但其在当前 app snapshot 中的可见渲染 SHALL 可以按当前宽度重新计算

#### Scenario: destructive recovery 不改变消息事实内容
- **WHEN** terminal columns 变化触发 destructive recovery
- **THEN** 应用 MAY 清 screen 和 scrollback 并重绘消息，但 SHALL NOT 改写已提交 transcript record 的事实内容

### Requirement: 提交和响应锁
系统 SHALL 使用 Enter 提交输入区内容，并在 assistant response 活跃期间禁止第二次提交。本地 slash 命令属于本地 command runtime 行为，不启动真实 assistant 生命周期；其他带额外文本的输入仍按普通 user message 处理。

#### Scenario: Enter 提交非空普通内容
- **WHEN** 用户在 composer 内容非空、没有 active assistant response，且提交内容未命中本地 slash handler 时按下 Enter
- **THEN** 应用 SHALL 追加用户消息块、清空 composer，并启动真实 assistant response

#### Scenario: 纯 /help 进入本地帮助 overlay
- **WHEN** 用户在没有 active assistant response 时提交内容精确等于 `/help`
- **THEN** 系统 SHALL 进入 help overlay 状态，而不是启动真实 assistant response

#### Scenario: 带后缀文本的 /help 仍作为普通消息提交
- **WHEN** 用户提交内容以 `/help` 开头但还带有其他字符
- **THEN** 系统 SHALL 将该内容视为普通 user message 提交，而不是进入 help overlay

#### Scenario: 空内容 Enter 不提交
- **WHEN** 用户在 composer 内容为空时按下 Enter
- **THEN** 应用 SHALL 保持 transcript 不变，并继续停留在输入模式

#### Scenario: response 进行中阻止新的提交与 slash 帮助
- **WHEN** assistant 正在 thinking 或 streaming
- **THEN** 按下 Enter SHALL NOT 启动另一个 assistant response
- **THEN** 提交纯 `/help` 也 SHALL NOT 进入 help overlay

### Requirement: transcript 会话持久化
系统 SHALL 按当前工作目录把 transcript records 持久化到用户级 `~/.echo/echo_tui/` 存储目录中。持久化 SHALL 只覆盖已提交的 transcript records，不覆盖 composer 内容、pending preview、command session 或用于 Up/Down 回溯的 input history。

#### Scenario: 普通 user record 提交后保存 session
- **WHEN** 用户提交一条普通消息且该消息被追加为 user transcript record
- **THEN** 系统 SHALL 在当前工作目录对应的存储分区中创建或更新当前 session
- **THEN** 保存内容 SHALL 包含该 user transcript record

#### Scenario: assistant 完成后保存 session
- **WHEN** assistant response 完成并追加 assistant transcript record
- **THEN** 系统 SHALL 更新当前 session 的 records 和 `updatedAt`
- **THEN** 保存内容 SHALL 包含完成后的 assistant transcript record

#### Scenario: assistant 失败反馈保存 session
- **WHEN** 真实 assistant response 失败并追加本地 assistant 错误 record
- **THEN** 系统 SHALL 更新当前 session 的 records 和 `updatedAt`
- **THEN** 保存内容 SHALL 包含该错误反馈 record

#### Scenario: 按当前工作目录分区保存
- **WHEN** 应用在某个 cwd 中保存 transcript session
- **THEN** 系统 SHALL 将 session 保存到 `~/.echo/echo_tui/` 下对应该 cwd 的项目分区
- **THEN** 系统 SHALL NOT 把会话历史文件写入当前项目目录

#### Scenario: 持久化不保存 input history
- **WHEN** 系统保存 transcript session
- **THEN** 保存内容 SHALL NOT 包含当前进程的 input history

### Requirement: mock assistant 生命周期
系统 SHALL 支持真实 assistant response 生命周期：用户普通消息提交后进入 thinking 状态，随后以真实模型服务返回的文本增量更新 streaming preview，并在成功完成后提交最终 assistant block。fake assistant MAY 继续作为测试或显式开发注入实现，但 CLI 默认普通对话 SHALL 使用真实 LLM adapter。

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
- **THEN** 系统 SHALL 追加一条本地 assistant 错误消息作为可见反馈

#### Scenario: 测试注入 fake agent 不改变 CLI 默认行为
- **WHEN** 测试通过 `createApp(options).runAgent` 注入 fake 或 stub agent
- **THEN** app SHALL 继续按相同 callbacks contract 处理 thinking、streaming 和 completion
- **THEN** CLI 默认普通对话行为 SHALL 仍由真实 LLM adapter 提供

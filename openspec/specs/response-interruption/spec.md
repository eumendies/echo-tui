# response-interruption Specification

## Purpose
定义用户在 assistant response 活跃期间通过 Esc 中断当前模型回答的外部行为，包括中断优先级、transcript 结果、迟到回调隔离，以及本地中断提示与 provider input 的隔离。
## Requirements
### Requirement: Esc 中断当前 assistant response
系统 SHALL 在 assistant response 活跃期间支持用户按 Esc 中断当前回答。中断 SHALL 停止当前 pending preview 和 spinner，释放 response lock，并允许用户继续编辑和提交下一条输入。若当前存在优先级更高的交互 surface，例如工具授权、用户问题请求、file picker 或 slash command session，Esc SHALL 继续由该 surface 消费，而不是中断整个 assistant response。若存在 transient 待发送消息，Esc SHALL 先移除该消息且保持当前 assistant turn 运行；消息移除后的下一次 Esc 才进入既有中断处理。中断判定 SHALL 基于当前 active assistant turn 和取消信号，不得仅限于 thinking 或 streaming pending 状态。

#### Scenario: thinking 阶段按 Esc 中断
- **WHEN** assistant response 已启动且仍处于 thinking pending 状态
- **AND** 用户按下 Esc，且没有 active command session、tool approval、file picker、user question request 或待发送消息
- **THEN** 系统 SHALL 请求取消当前 assistant turn
- **THEN** 系统 SHALL 清空 thinking pending preview 并停止 spinner
- **THEN** 系统 SHALL 释放 response lock，使用户可以继续输入和提交新消息

#### Scenario: streaming 阶段按 Esc 中断
- **WHEN** assistant response 正在 streaming 文本增量
- **AND** 用户按下 Esc，且没有 active command session、tool approval、file picker、user question request 或待发送消息
- **THEN** 系统 SHALL 请求取消当前 assistant turn
- **THEN** 系统 SHALL 清空 streaming pending preview 并停止 spinner
- **THEN** 系统 SHALL 释放 response lock，使用户可以继续输入和提交新消息

#### Scenario: tool execution 阶段按 Esc 中断
- **WHEN** assistant response 正在等待工具授权后的工具执行、工具结果或下一轮 continuation
- **AND** 用户按下 Esc，且没有 active command session、tool approval、file picker、user question request 或待发送消息
- **THEN** 系统 SHALL 请求取消当前 assistant turn
- **THEN** 系统 SHALL 停止当前 pending preview 和 spinner
- **THEN** 系统 SHALL 释放 response lock，使用户可以继续输入和提交新消息

#### Scenario: 等待 provider 返回阶段按 Esc 中断
- **WHEN** assistant response 正在等待 provider 请求返回，且当前没有可见文本增量
- **AND** 用户按下 Esc，且没有 active command session、tool approval、file picker、user question request 或待发送消息
- **THEN** 系统 SHALL 请求取消当前 assistant turn
- **THEN** 系统 SHALL 释放 response lock，使用户可以继续输入和提交新消息

#### Scenario: 高优先级 surface 消费 Esc
- **WHEN** tool approval、user question request、file picker 或 active command session 正在显示
- **AND** 用户按下 Esc
- **THEN** 输入事件 SHALL 交给该 active surface 的既有事件处理逻辑
- **THEN** 系统 SHALL NOT 直接因为该 Esc 中断整个 assistant response

#### Scenario: 待发送消息先消费 Esc
- **WHEN** active assistant response 仍在运行且没有更高优先级 surface
- **AND** 当前存在一条待发送消息
- **AND** 用户按下 Esc
- **THEN** 系统 SHALL 移除该待发送消息并保持当前 assistant turn 运行
- **THEN** 系统 SHALL NOT 因该次 Esc 追加 partial assistant 或中断提示 record

#### Scenario: 移除待发送消息后再次 Esc 中断 response
- **WHEN** 待发送消息已因前一次 Esc 移除
- **AND** assistant response lock 仍由同一个 active assistant turn 占用
- **AND** 用户再次按下 Esc，且没有新的高优先级 surface 或待发送消息
- **THEN** 系统 SHALL 请求取消当前 assistant turn
- **THEN** 系统 SHALL 执行既有中断收尾

#### Scenario: surface 关闭后再次 Esc 中断 response
- **WHEN** user question request 或 tool approval surface 因 Esc 关闭
- **AND** assistant response lock 仍由同一个 active assistant turn 占用
- **AND** 用户再次按下 Esc，且没有新的高优先级 surface 或待发送消息
- **THEN** 系统 SHALL 请求取消当前 assistant turn
- **THEN** 系统 SHALL 执行既有中断收尾

### Requirement: 中断后的 transcript 结果
系统 SHALL 将用户主动中断与模型失败区分开。若中断前已经产生 partial assistant draft，系统 SHALL 先将该 partial draft 追加为 assistant transcript record；无论是否存在 partial draft，系统 SHALL 追加本地中断提示 record。中断提示 SHALL 可见、可持久化、可恢复，但 SHALL NOT 被视为 assistant 回复或错误反馈。

#### Scenario: 中断时保留 partial assistant
- **WHEN** assistant response 已经产生非空 partial draft
- **AND** 用户按 Esc 中断当前回答
- **THEN** 系统 SHALL 追加一条 assistant transcript record 保存该 partial draft
- **THEN** 系统 SHALL 追加一条本地中断提示 record，说明模型回答已被中断
- **THEN** 系统 SHALL NOT 追加 `error` transcript record 表示本次用户主动中断

#### Scenario: 中断时没有 partial assistant
- **WHEN** assistant response 尚未产生文本增量
- **AND** 用户按 Esc 中断当前回答
- **THEN** 系统 SHALL NOT 追加空 assistant transcript record
- **THEN** 系统 SHALL 追加一条本地中断提示 record，说明模型回答已被中断
- **THEN** 系统 SHALL NOT 追加 `error` transcript record 表示本次用户主动中断

#### Scenario: 恢复 session 后显示中断提示
- **WHEN** 包含本地中断提示 record 的 session 被持久化并通过 `/resume` 恢复
- **THEN** 系统 SHALL 恢复该本地中断提示 record
- **THEN** transcript 渲染 SHALL 为该 record 提供区别于 user、assistant 和 error 的克制可见投影

### Requirement: 中断后的迟到回调隔离
系统 SHALL 防止已中断 assistant turn 的迟到回调污染当前 UI 或后续 assistant turn。中断后，属于旧 turn 的 token、tool call、tool result 或 complete 回调 SHALL 不得更新 pending preview、追加 transcript record 或释放/占用后续 turn 的 response lock。

#### Scenario: 中断后迟到 token 被忽略
- **WHEN** 用户按 Esc 中断当前 assistant response
- **AND** 被中断的旧 turn 随后仍触发 token callback
- **THEN** 系统 SHALL 忽略该迟到 token callback
- **THEN** 该 callback SHALL NOT 更新当前 pending preview 或追加 transcript record

#### Scenario: 新 turn 不被旧 complete 污染
- **WHEN** 用户按 Esc 中断 turn A 后提交 turn B
- **AND** turn A 随后触发 complete callback
- **THEN** 系统 SHALL 忽略 turn A 的迟到 complete callback
- **THEN** turn A 的最终文本 SHALL NOT 追加到 turn B 的 transcript 生命周期中

### Requirement: 中断提示不进入 provider input
本地中断提示 record SHALL 只用于本地 UI、持久化和恢复。系统 SHALL NOT 将该 record 转换为 OpenAI provider input，也 SHALL NOT 将其计入上下文压缩的 provider token 估算。

#### Scenario: OpenAI input 跳过中断提示
- **WHEN** transcript records 包含本地中断提示 record
- **THEN** OpenAI transcript converter SHALL NOT 将该 record 放入 provider input
- **THEN** 后续普通 user / assistant / tool records SHALL 继续按既有顺序参与转换

#### Scenario: 上下文压缩估算跳过中断提示
- **WHEN** agent loop runtime 估算上下文长度或执行压缩边界计算
- **THEN** 本地中断提示 record SHALL 不作为 provider 输入内容计入 token 估算
- **THEN** 本地中断提示 record SHALL 不阻止其他可发送 records 参与压缩规则

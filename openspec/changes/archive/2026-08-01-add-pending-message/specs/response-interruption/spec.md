## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: agent 取消信号传播
真实 LLM adapter 的 app-facing agent contract SHALL 支持可选取消信号。一次 agent run 收到取消信号后，agent loop runtime SHALL 停止发起新的 provider turn 或后续 continuation，并 SHALL 以可识别的中断结果结束本次 run，而不是把用户主动中断伪装成模型服务失败。

#### Scenario: agent run 接收取消信号
- **WHEN** app 层启动一次 agent run 并提供取消信号
- **THEN** agent loop runtime SHALL 将该取消信号传递给底层 provider agent
- **THEN** provider agent SHALL 能在本次 provider turn 中观察该取消信号

#### Scenario: 已取消时不发起 provider turn
- **WHEN** agent loop runtime 准备发起 provider turn 前发现取消信号已触发
- **THEN** runtime SHALL NOT 调用底层 provider agent 的 `runTurn`
- **THEN** runtime SHALL 以可识别的中断结果结束本次 run

#### Scenario: provider turn 返回后中断阻止 continuation
- **WHEN** 底层 provider agent 返回 tool calls 或 assistant draft 后，取消信号已经触发
- **THEN** agent loop runtime SHALL NOT 继续执行新的 tool call 或发起新的 provider continuation turn
- **THEN** runtime SHALL 以可识别的中断结果结束本次 run

### Requirement: OpenAI provider 支持取消 streaming 请求
OpenAI provider agent SHALL 在发起 Responses API 流式请求时支持可选取消信号。取消信号触发后，provider SHALL 尽力取消底层 SDK streaming 请求，并以可识别的中断结果结束当前 provider turn。

#### Scenario: OpenAI SDK 请求携带取消信号
- **WHEN** OpenAI provider agent 执行 `runTurn` 且调用方提供取消信号
- **THEN** provider SHALL 将该取消信号传递给 OpenAI SDK responses create 调用
- **THEN** SDK 请求 SHALL 能响应该取消信号

#### Scenario: OpenAI stream 被取消时不作为服务失败
- **WHEN** OpenAI streaming 请求因调用方取消信号触发而中断
- **THEN** OpenAI provider agent SHALL 以可识别的中断结果结束当前 turn
- **THEN** provider SHALL NOT 将该用户主动中断包装为普通模型服务失败或 stream incomplete 失败

### Requirement: fake provider 支持取消 thinking 与 streaming
fake provider SHALL 支持可选取消信号，并在 thinking delay 与逐字符 streaming delay 期间响应取消。取消后 fake provider SHALL 停止产生后续 token callback，并以可识别的中断结果结束当前 provider turn。

#### Scenario: fake thinking 阶段取消
- **WHEN** fake provider 正处于首个 token 前的 thinking delay
- **AND** 取消信号触发
- **THEN** fake provider SHALL 停止等待并结束当前 provider turn
- **THEN** fake provider SHALL NOT 产生 token callback 或 complete 结果

#### Scenario: fake streaming 阶段取消
- **WHEN** fake provider 已经产生部分 token callback 并继续逐字符 streaming
- **AND** 取消信号触发
- **THEN** fake provider SHALL 停止产生后续 token callback
- **THEN** fake provider SHALL 以可识别的中断结果结束当前 provider turn

### Requirement: 中断不强制终止已启动本地工具
本次变更 SHALL 不要求 agent loop runtime 强制终止已经启动的本地工具执行。取消信号触发后，runtime SHALL 在下一次可观察边界停止后续 provider/tool-loop 进展；但已经交给 tool executor 的工具调用 MAY 按既有工具执行语义完成。

#### Scenario: 工具启动前取消阻止工具执行
- **WHEN** agent loop runtime 已收到 provider 返回的 tool call
- **AND** 在调用 tool executor 前取消信号已经触发
- **THEN** runtime SHALL NOT 调用 tool executor 执行该 tool call
- **THEN** runtime SHALL 以可识别的中断结果结束本次 run

#### Scenario: 工具执行中取消不要求强杀
- **WHEN** agent loop runtime 已经调用 tool executor 执行某个本地工具
- **AND** 用户随后触发取消信号
- **THEN** 本次变更不要求 runtime 强制终止该已经启动的工具进程
- **THEN** 工具执行完成后 runtime SHALL NOT 因此继续发起新的 provider continuation turn

## MODIFIED Requirements

### Requirement: Agent loop runtime 编排真实工具循环
真实 LLM adapter SHALL 通过 provider-neutral agent loop runtime 编排 function tool call loop。该 runtime SHALL 保持现有 `RunAgent(records, callbacks)` app contract，接收一个底层 provider agent 作为依赖，并负责读取 LLM 配置、创建默认 tool registry、创建 tool executor、执行本地工具、维护 continuation `TranscriptRecord[]`，直到底层 provider agent 返回无 tool call 的最终 assistant 文本、发生错误或调用方取消当前 turn。对于需要用户授权的工具调用，runtime SHALL 在执行工具前通过 app callback 获取授权决策；用户拒绝时 SHALL 不执行工具，并 SHALL 生成拒绝 tool result 参与 continuation。runtime SHALL 将 run 级取消信号传递给 provider turn、自动压缩摘要请求和 tool executor，并在 provider、compaction、approval、user question、tool execution 与 continuation 边界检查该信号。

#### Scenario: 取消信号传递到 provider 和工具运行时
- **WHEN** agent loop runtime 在 provider turn、tool call 或 continuation 编排期间持有取消信号
- **THEN** runtime SHALL 将该信号继续传递给底层 provider turn
- **THEN** runtime SHALL 将该信号传递给自动上下文压缩摘要请求
- **THEN** runtime SHALL 将该信号传递给 tool executor

#### Scenario: 取消后停止工具 continuation
- **WHEN** agent loop runtime 在 provider turn、tool call 或 continuation 编排期间观察到取消信号已触发
- **THEN** runtime SHALL NOT 发起新的 provider continuation turn
- **THEN** runtime SHALL NOT 调用 final complete callback 把该 turn 伪装成成功完成
- **THEN** runtime SHALL 允许 app 层按用户主动中断路径收尾

#### Scenario: 已启动工具 best-effort 取消
- **WHEN** agent loop runtime 已经启动本地工具执行
- **AND** 取消信号随后触发
- **THEN** runtime SHALL 依赖 tool executor 和 handler 对该信号进行 best-effort 取消
- **THEN** runtime SHALL 在工具 await 返回后再次检查取消信号
- **THEN** runtime SHALL NOT 要求不可取消工具必须被同步强制终止

#### Scenario: 默认真实路径通过 loop runtime 调用 OpenAI agent
- **WHEN** CLI 默认真实 adapter 处理普通用户消息
- **THEN** 系统 SHALL 通过 agent loop runtime 调用底层 OpenAI provider agent
- **THEN** `main.ts` SHALL NOT 直接创建 tool registry 或 tool executor
- **THEN** app 层看到的 agent contract SHALL 仍是 `RunAgent(records, callbacks)`

#### Scenario: loop runtime 加载配置和工具运行时
- **WHEN** agent loop runtime 开始一次 `RunAgent` 调用
- **THEN** runtime SHALL 读取当前 LLM 配置
- **THEN** runtime SHALL 使用该配置创建默认 tool registry 和 tool executor
- **THEN** runtime SHALL 使用同一配置和 tool registry 初始化底层 provider agent
- **THEN** runtime SHALL NOT 在后续 `runTurn` 调用中把 provider 私有运行态作为参数传回底层 provider agent

### Requirement: 发请求前上下文压缩检查
agent loop runtime SHALL 在构造 provider 请求前执行上下文压缩检查。当预估上下文长度超过当前模型上下文窗口阈值且记录足以压缩时，runtime SHALL 先同步生成结构化摘要、更新并落盘压缩状态，再继续本轮 provider 请求；否则 SHALL 直接按现有流程发送请求。压缩 SHALL 在发请求前同步完成，不得改写完整 `records[]`。若调用方提供 turn-level 取消信号，压缩摘要请求 SHALL 使用同一个取消信号；取消后 SHALL NOT 落盘未完成或迟到的压缩结果。

#### Scenario: 超阈值时先压缩再发请求
- **WHEN** agent loop runtime 即将发起 provider 请求且预估上下文长度超过窗口阈值且记录足以压缩
- **THEN** runtime SHALL 先同步生成结构化摘要并更新压缩状态
- **THEN** runtime SHALL 在压缩状态落盘后再发起本轮 provider 请求
- **THEN** runtime SHALL NOT 删除或改写完整 `records[]`

#### Scenario: 未超阈值时直接发请求
- **WHEN** agent loop runtime 即将发起 provider 请求且预估上下文长度未超过窗口阈值
- **THEN** runtime SHALL NOT 触发压缩
- **THEN** runtime SHALL 按现有流程发起 provider 请求

#### Scenario: 压缩摘要请求携带取消信号
- **WHEN** agent loop runtime 触发自动上下文压缩
- **AND** 当前 assistant turn 具有取消信号
- **THEN** runtime SHALL 将该取消信号传递给摘要生成 provider 请求
- **THEN** 摘要请求 SHALL 能响应用户 Esc 中断

#### Scenario: 压缩取消不落盘摘要
- **WHEN** 自动上下文压缩摘要请求期间用户按 Esc 中断当前 assistant turn
- **THEN** runtime SHALL 取消或忽略该摘要请求结果
- **THEN** runtime SHALL NOT 写入新的压缩状态
- **THEN** runtime SHALL NOT 继续发起原计划的 provider 请求

## ADDED Requirements

### Requirement: Tool executor 接收 turn-level 取消信号
工具执行层 SHALL 支持调用方传入可选 turn-level 取消信号。tool executor SHALL 将该信号传给工具 handler；handler 支持取消时 SHALL 用该信号停止底层工作，handler 不支持取消时 SHALL 保持既有业务结果格式。

#### Scenario: bash tool 响应 turn-level 取消
- **WHEN** `run_bash_command` tool handler 正在执行本地命令
- **AND** turn-level 取消信号触发
- **THEN** handler SHALL 将取消信号传递给共享 bash runner
- **THEN** bash runner SHALL 按既有进程终止策略尽力停止该命令

#### Scenario: web 工具组合 timeout 和 turn abort
- **WHEN** `web_fetch`、`web_search` 或等价 web tool 正在等待网络结果
- **AND** 工具有自身 timeout 且调用方提供 turn-level 取消信号
- **THEN** handler SHALL 使用任一信号触发都能取消底层请求的组合取消语义
- **THEN** timeout 语义和用户 Esc 中断语义 SHALL 均保持有效

#### Scenario: 快速本地工具忽略可选信号
- **WHEN** 某个快速本地工具 handler 不需要异步取消能力
- **AND** tool executor 传入取消信号
- **THEN** handler MAY 忽略该信号并保持既有返回格式
- **THEN** runtime SHALL 在 handler 返回后继续检查取消信号

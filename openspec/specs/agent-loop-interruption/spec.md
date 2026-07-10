# agent-loop-interruption Specification

## Purpose
定义 active assistant turn 在任意 agent loop 阶段的中断语义、异步取消边界、工具 best-effort 取消以及中断后的工具记录完整性。

## Requirements

### Requirement: Esc 可中断任意 active agent loop 阶段
系统 SHALL 在 assistant turn 仍为 active 且占用 response lock 时允许用户通过 Esc 请求中断当前 agent loop。中断判定 SHALL 基于 active assistant turn identity 和 turn-level 取消信号，而不是基于当前 footer pending kind 是否为 thinking 或 streaming。

#### Scenario: 等待 provider 返回期间按 Esc
- **WHEN** assistant turn 已启动并正在等待 provider request 返回
- **AND** 当前没有 active command session、tool approval、file picker 或 user question request
- **AND** 用户按下 Esc
- **THEN** 系统 SHALL 触发当前 assistant turn 的取消信号
- **THEN** 系统 SHALL 释放 response lock 并允许用户继续输入

#### Scenario: 工具执行期间按 Esc
- **WHEN** assistant turn 已进入 tool execution 阶段且 response lock 仍由该 turn 占用
- **AND** 当前没有更高优先级 surface 正在处理输入
- **AND** 用户按下 Esc
- **THEN** 系统 SHALL 请求中断当前 assistant turn
- **THEN** runtime SHALL 不再发起后续 provider continuation

#### Scenario: continuation 等待期间按 Esc
- **WHEN** 工具结果已经返回且 agent loop 正准备或正在等待下一次 provider continuation
- **AND** 用户按下 Esc
- **THEN** 系统 SHALL 请求中断当前 assistant turn
- **THEN** runtime SHALL 停止该 continuation loop 并执行既有中断收尾

### Requirement: agent loop 取消边界
agent loop runtime SHALL 在每个可观察异步边界检查 turn-level 取消信号，确保取消后不再推进后续 tool/provider loop。取消边界至少覆盖 provider 请求、自动压缩摘要请求、工具授权等待、用户问题等待、工具执行和下一轮 continuation 之前。

#### Scenario: provider turn 返回后发现已取消
- **WHEN** provider turn await 返回
- **AND** turn-level 取消信号已经触发
- **THEN** runtime SHALL NOT 处理该 provider turn 的 tool calls 或 final assistant complete
- **THEN** runtime SHALL 结束当前 agent loop 的推进

#### Scenario: 工具返回后发现已取消
- **WHEN** tool executor await 返回
- **AND** turn-level 取消信号已经触发
- **THEN** runtime SHALL NOT 基于该工具结果发起下一次 provider request
- **THEN** runtime SHALL NOT 追加新的 assistant final answer

#### Scenario: 自动压缩返回后发现已取消
- **WHEN** 自动上下文压缩摘要请求返回
- **AND** turn-level 取消信号已经触发
- **THEN** runtime SHALL NOT 落盘新的压缩状态
- **THEN** runtime SHALL NOT 继续发起原计划的 provider request

### Requirement: 工具取消 best-effort
系统 SHALL 将 turn-level 取消信号传递给 tool executor 和支持取消的工具 handler。支持取消的长耗时工具 SHALL 尽快响应取消；不支持即时取消的工具 MAY 自然返回，但 runtime SHALL 在返回后遵守取消边界并停止 continuation。

#### Scenario: 可取消工具收到 Esc
- **WHEN** `run_bash_command`、`web_fetch`、`web_search` 或等价长耗时工具正在执行
- **AND** 用户按 Esc 中断当前 assistant turn
- **THEN** tool handler SHALL 接收到同一个 turn-level 取消信号
- **THEN** 工具 SHALL 尽力停止底层工作并返回或抛出可识别的取消结果

#### Scenario: 不可取消工具迟到返回
- **WHEN** 某个工具无法立即响应取消并在 assistant turn 已中断后才返回
- **THEN** runtime SHALL 识别当前 turn 已取消
- **THEN** runtime SHALL NOT 使用该迟到结果继续请求 provider
- **THEN** 迟到结果 SHALL NOT 污染后续 assistant turn 的 response lock

### Requirement: 中断后不产生孤儿工具记录
系统 SHALL 避免因 Esc 中断在 transcript 中留下只有 `tool_call` 而没有对应 `tool_result` 的孤儿工具调用记录。已经成对完成并作为可见事实追加的工具记录 MAY 保留；未完成工具调用 SHALL 以 pending preview 清理和本地中断提示结束。

#### Scenario: tool call pending 时中断
- **WHEN** agent loop 已显示或准备显示工具调用 pending preview
- **AND** 对应工具尚未产生 tool result
- **AND** 用户按 Esc 中断当前 assistant turn
- **THEN** 系统 SHALL 清理该工具 pending preview
- **THEN** 系统 SHALL NOT 追加缺少 tool result 的孤儿 `tool_call` transcript record

#### Scenario: 已完成工具记录在中断后保留
- **WHEN** 某个工具调用已经产生并追加了匹配的 `tool_call` 和 `tool_result` records
- **AND** 用户随后按 Esc 中断后续 continuation
- **THEN** 系统 MAY 保留这些已完成工具 records 作为 transcript 事实
- **THEN** 系统 SHALL NOT 再发起基于这些 records 的新 provider continuation

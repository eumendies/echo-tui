## MODIFIED Requirements

### Requirement: 高频 pending 更新使用统一活动刷新时钟
系统 SHALL 在 assistant 文本流和 shell 实时输出期间，把高频 token 或 output chunk 合并到最新 pending 状态，并由与 thinking/working 动效共享的单一周期刷新时钟投影终端。单个高频事件 SHALL NOT 直接触发额外 footer redraw；结构性状态变化 SHALL 继续即时绘制。对 shell 实时输出，活动刷新 tick SHALL 在把新增稳定输出行确定到终端历史区的同时重绘 footer 未确定尾部，二者 SHALL 合并为同一次终端写入。

#### Scenario: 多个 assistant token 在一个周期内合并
- **WHEN** active assistant turn 在相邻活动刷新 tick 之间收到多个文本增量
- **THEN** 系统 SHALL 累积这些增量形成最新 assistant draft
- **THEN** 系统 SHALL NOT 为每个文本增量分别调用 footer redraw
- **THEN** 下一个活动刷新 tick SHALL 绘制包含全部已到达增量的最新 pending preview

#### Scenario: 多个 shell output chunk 在一个周期内合并
- **WHEN** active shell command 在相邻活动刷新 tick 之间产生多个 stdout 或 stderr chunk
- **THEN** 系统 SHALL 累积这些 chunk 形成最新 shell 输出状态
- **THEN** 系统 SHALL NOT 为每个 chunk 分别调用 footer redraw
- **THEN** 下一个活动刷新 tick SHALL 把新增的已稳定完整行确定到终端历史区，并在 footer 保留未确定尾部

#### Scenario: 结构性事件即时刷新
- **WHEN** 响应进入 tool call、approval、user question、assistant segment、shell 命令提交、完成、失败或中断状态
- **THEN** 系统 SHALL 不等待后续 token 或 shell chunk 才更新对应 surface、transcript 或最终 footer
- **THEN** 结构性事件处理 SHALL 取消或隔离任何可能覆盖新状态的旧高频刷新回调

#### Scenario: 活动完成早于首次周期 tick
- **WHEN** assistant response 或 shell command 在首次活动刷新 tick 前完成
- **THEN** 系统 SHALL 通过最终 record append 或等价同步 redraw 显示最终内容
- **THEN** 系统 SHALL NOT 因停止活动刷新时钟而丢失最后收到的文本或 shell 输出

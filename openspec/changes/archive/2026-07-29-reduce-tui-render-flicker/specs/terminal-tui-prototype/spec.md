## ADDED Requirements

### Requirement: 高频 pending 更新使用统一活动刷新时钟
系统 SHALL 在 assistant 文本流和 shell 实时输出期间，把高频 token 或 output chunk 合并到最新 pending 状态，并由与 thinking/working 动效共享的单一周期刷新时钟投影 footer。单个高频事件 SHALL NOT 直接触发额外 footer redraw；结构性状态变化 SHALL 继续即时绘制。

#### Scenario: 多个 assistant token 在一个周期内合并
- **WHEN** active assistant turn 在相邻活动刷新 tick 之间收到多个文本增量
- **THEN** 系统 SHALL 累积这些增量形成最新 assistant draft
- **THEN** 系统 SHALL NOT 为每个文本增量分别调用 footer redraw
- **THEN** 下一个活动刷新 tick SHALL 绘制包含全部已到达增量的最新 pending preview

#### Scenario: 多个 shell output chunk 在一个周期内合并
- **WHEN** active shell command 在相邻活动刷新 tick 之间产生多个 stdout 或 stderr chunk
- **THEN** 系统 SHALL 累积这些 chunk 形成最新 shell output preview
- **THEN** 系统 SHALL NOT 为每个 chunk 分别调用 footer redraw
- **THEN** 下一个活动刷新 tick SHALL 绘制包含全部已到达 chunk 的最新 pending preview

#### Scenario: 结构性事件即时刷新
- **WHEN** 响应进入 tool call、approval、user question、assistant segment、完成、失败或中断状态
- **THEN** 系统 SHALL 不等待后续 token 或 shell chunk 才更新对应 surface、transcript 或最终 footer
- **THEN** 结构性事件处理 SHALL 取消或隔离任何可能覆盖新状态的旧高频刷新回调

#### Scenario: 活动完成早于首次周期 tick
- **WHEN** assistant response 或 shell command 在首次活动刷新 tick 前完成
- **THEN** 系统 SHALL 通过最终 record append 或等价同步 redraw 显示最终内容
- **THEN** 系统 SHALL NOT 因停止活动刷新时钟而丢失最后收到的文本或 shell 输出

### Requirement: 普通 footer redraw 单次写入完整帧
系统 SHALL 在一次普通 footer redraw 中，将旧 footer 清理、新 footer 布局输出和逻辑光标恢复组合为一个连续 ANSI 序列，并通过单次 `output.write()` 写出该帧。该调整 SHALL 保持现有 footer 定位、高度清理、光标可见性和当前终端运行语义。

#### Scenario: 已有 footer 时重绘只写出一次
- **WHEN** renderer 已记住上一帧 footer 且收到新的 footer layout
- **THEN** 本次普通 footer redraw SHALL 只调用一次 `output.write()`
- **THEN** 该次写入 SHALL 同时包含旧 footer 清理序列和新 footer 可见内容

#### Scenario: 新 footer 比旧 footer 更矮
- **WHEN** 新 footer layout 的高度小于 remembered footer 高度
- **THEN** 单次 redraw SHALL 清理旧 footer 的全部可见行
- **THEN** 新 footer 以下 SHALL NOT 残留旧 pending preview、surface 或 status line 内容

#### Scenario: 重绘后恢复 composer 光标
- **WHEN** 新 footer layout 要求显示 composer 光标
- **THEN** 单次 redraw 完成后的光标 SHALL 位于新 layout 的逻辑行列
- **THEN** 光标 SHALL 在完整帧写出末尾恢复可见

#### Scenario: command surface 保持隐藏光标
- **WHEN** 新 footer layout 表示当前 command surface 不显示文本光标
- **THEN** 单次 redraw SHALL 在清理和绘制期间保持光标隐藏
- **THEN** 完整帧写出末尾 SHALL NOT 错误恢复可见光标

#### Scenario: 独立清除 footer
- **WHEN** 调用方要求移除 footer 而不立即绘制新 layout
- **THEN** renderer SHALL 使用一次 `output.write()` 清除 remembered footer
- **THEN** renderer SHALL 重置 remembered footer 高度和光标位置

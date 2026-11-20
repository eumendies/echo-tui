# output-rate-metering Specification

## Purpose
定义流式输出 token 速率的采集口径、本地浮点估算与滑动窗口算法、assistant turn 归属判定、
重试与中断边界、精度声明，以及主会话与 BTW 的多 owner 隔离。
## Requirements
### Requirement: 流式增量上报
provider 层 SHALL 提供一个与"可见 assistant 正文"解耦的增量上报回调，每当模型流式输出一段原始文本就上报该段文本，SHALL NOT 携带草稿全量、SHALL NOT 承诺跨 provider 的分片边界一致。

该回调 SHALL 覆盖以下三类输出：assistant 正文、reasoning 摘要或思考文本，以及工具调用的参数分片。三个内置 provider adapter SHALL 全部接入：

- OpenAI Chat SHALL 在正文 delta、reasoning delta 和 `tool_calls[].function.arguments` 分片累积处上报。
- Anthropic SHALL 在 text delta、thinking delta 和 `input_json_delta.partial_json` 分片累积处上报。
- OpenAI Responses SHALL 在正文 delta、reasoning 摘要 delta 处上报，并 SHALL 监听工具调用参数分片事件以上报该阶段输出。

上报 SHALL 是纯观察行为：SHALL NOT 改变 provider 请求、SHALL NOT 改变工具调用提取路径、SHALL NOT 影响流完成判定与重试决策。未知或畸形事件 SHALL 被忽略，SHALL NOT 抛出错误中断流。

#### Scenario: 正文增量上报
- **WHEN** provider 流返回一段 assistant 正文文本
- **THEN** adapter SHALL 上报该段文本一次
- **THEN** 既有 assistant 正文草稿与会话记录 SHALL 保持既有行为

#### Scenario: reasoning 增量上报
- **WHEN** provider 流返回一段 reasoning 摘要或思考文本
- **THEN** adapter SHALL 上报该段文本
- **THEN** 既有 reasoning 预览与完成边界 SHALL 保持既有行为

#### Scenario: 工具参数分片上报
- **WHEN** 模型正在流式生成工具调用参数
- **THEN** adapter SHALL 上报每一段参数分片
- **THEN** 最终工具调用 SHALL 仍由既有提取路径一次性构建，参数内容与之前完全一致

#### Scenario: 畸形事件不影响流
- **WHEN** 上报路径收到结构不符合预期的流事件
- **THEN** adapter SHALL 跳过该事件的上报
- **THEN** 流消费、错误分类与重试行为 SHALL 保持不变

### Requirement: 本地 token 估算与滑动窗口速率
系统 SHALL 把上报文本换算为本地 token 估算值，并维护只含时间戳与估算 token 数的样本序列。换算 SHALL 复用现有字符启发式估算，SHALL NOT 引入独立系数。

速率 SHALL 以最近 3000 毫秒的滑动窗口计算：丢弃窗口外的样本，窗口内估算 token 总量除以窗口实际跨度秒数，并四舍五入为整数。实际跨度 SHALL 取"当前时刻减去最早有效样本时刻"与 1000 毫秒中的较大值，避免首个样本到达瞬间产生异常高的瞬时值。窗口内没有样本时速率为 `0`。

该速率 SHALL 明确是本地估算值，SHALL NOT 被声明为 provider 精确计数，也 SHALL NOT 用于计费、token 预算、context 估算或 usage 统计。

#### Scenario: 窗口内持续出词
- **WHEN** 最近 3 秒内持续观测到 token 增量
- **THEN** 速率 SHALL 反映窗口内的估算 token 除以实际跨度
- **THEN** 数值 SHALL 为四舍五入后的整数

#### Scenario: 出词结束后归零
- **WHEN** 连续超过 3000 毫秒没有新的样本
- **THEN** 后续读取的速率 SHALL 为 `0`
- **THEN** 过期样本 SHALL 从序列中淘汰，序列 SHALL NOT 无限增长

#### Scenario: 首个样本不产生尖峰
- **WHEN** 一次上报在极短时间内到达且此前没有样本
- **THEN** 计算跨度 SHALL 至少按 1000 毫秒处理
- **THEN** 速率 SHALL NOT 因极小分母而出现数量级异常

#### Scenario: 估算值不进入统计口径
- **WHEN** 系统记录了若干速率样本
- **THEN** 该估算 SHALL NOT 被写入 usage store、transcript record 或 context usage 快照
- **THEN** `/usage` 与 `/context` 的数值 SHALL 保持来自 provider 真实 usage 的既有语义

### Requirement: assistant turn 归属与生命周期
速率 SHALL 只归属于活跃的 assistant turn。系统 SHALL 在 assistant turn 开始时重置样本序列，并在 turn 结束、失败或中断后停止投影速率。

attempt 级重试 SHALL NOT 重置样本序列，避免重试期间速率闪断。工具本地执行仍属于 assistant turn，期间窗口无新样本，速率 SHALL 为 `0`。

非 assistant turn 的本地活动 SHALL NOT 产生速率投影，包括 shell 与 shell-local 命令执行、MCP 初始化、会话引用准备和手动压缩。

#### Scenario: turn 开始时重置
- **WHEN** 一个新的 assistant turn 开始
- **THEN** 样本序列 SHALL 被清空
- **THEN** 该 turn 的速率 SHALL NOT 受上一 turn 样本影响

#### Scenario: 工具执行期间为零
- **WHEN** assistant turn 正在本地执行工具且没有新的 provider 输出
- **THEN** 速率 SHALL 为 `0`
- **THEN** turn 的 working 计时 SHALL 继续推进

#### Scenario: 重试不闪断
- **WHEN** provider stream attempt 失败并自动重试
- **THEN** 样本序列 SHALL 保持不清空
- **THEN** 重试成功后的速率 SHALL 继续基于既有窗口样本计算

#### Scenario: 本地活动不投影速率
- **WHEN** 用户执行 shell 命令或系统正在初始化 MCP，且没有活跃 assistant turn
- **THEN** 渲染状态 SHALL NOT 携带速率字段
- **THEN** status line SHALL 只显示该活动既有的 mode 与 elapsed

#### Scenario: turn 结束后停止
- **WHEN** assistant turn 完成、失败或被中断
- **THEN** 后续渲染 SHALL NOT 携带速率字段
- **THEN** 速率 SHALL NOT 残留在下一轮 idle status line 中

### Requirement: 多 owner 隔离
主会话与 `/btw` 侧会话 SHALL 各自维护独立的速率样本序列，SHALL NOT 共享同一份窗口状态。

subagent 会话窗口与并行子运行 SHALL NOT 显示速率；其 status line 的既有内容与降级行为 SHALL 保持不变。

#### Scenario: 主会话与 BTW 互不影响
- **WHEN** 主会话正在流式输出且用户同时向 BTW 侧会话提问
- **THEN** 两个 owner 的速率 SHALL 分别基于各自的样本序列计算
- **THEN** 一个 owner 的输出 SHALL NOT 抬高另一个 owner 的速率

#### Scenario: subagent 视图不显示速率
- **WHEN** 用户用 `Ctrl+O` 打开 subagent 会话窗口
- **THEN** 该窗口的 status line SHALL NOT 显示速率 segment
- **THEN** 其既有 mode、运行索引与模型摘要 SHALL 保持不变

### Requirement: 速率不影响既有运行语义
速率采集 SHALL NOT 改变 provider 请求体、transcript 记录、journal 写入、context 估算、compaction 边界、工具执行顺序或 response lock 语义。

headless `--once` SHALL 不受影响：它 SHALL NOT 因速率采集改变输出、退出码或工具策略。

#### Scenario: 不产生额外记录
- **WHEN** 一轮 assistant turn 因速率采集而上报大量增量
- **THEN** transcript 与 journal SHALL NOT 因此新增任何 record

#### Scenario: headless 路径不变
- **WHEN** 用户执行 `echo-tui --once "<prompt>"`
- **THEN** 该运行的 provider 请求、输出与退出码 SHALL 与引入速率采集前一致

#### Scenario: 不影响中断
- **WHEN** 用户在流式期间按 Esc 中断
- **THEN** 中断收尾、pending 清理与部分记录持久化 SHALL 保持既有语义
- **THEN** 速率采集 SHALL NOT 阻止或延迟中断

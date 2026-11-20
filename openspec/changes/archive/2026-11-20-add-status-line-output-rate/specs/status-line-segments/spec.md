## MODIFIED Requirements

### Requirement: status line 可选 segment 配置
系统 SHALL 支持通过 `~/.echo/config.json` 的 `ui.statusLine` 节点配置普通输入态 status line 的 7 个可选 segment 是否渲染：`model`、`effort`、`title`、`dir`、`contextUsage`、`approval`、`rate`。每个字段 SHALL 为布尔值，默认值 SHALL 全部为 `true`。

`model` SHALL 控制模型名 segment，包含 skill override 后缀；`effort` SHALL 控制推理强度 segment；`title` SHALL 控制当前会话标题 segment；`dir` SHALL 控制项目目录名 segment；`contextUsage` SHALL 控制 `ctx <used>/<window>` segment；`approval` SHALL 控制会话内全部工具已授权的 `TOOLS all` segment；`rate` SHALL 控制模型输出速率 segment。

segment 之间的相对顺序、各自文本格式、颜色语义与分隔符样式 SHALL NOT 因配置改变。配置 SHALL NOT 改变任何 segment 的取值来源或事实语义。

#### Scenario: 默认显示全部可选 segment
- **WHEN** `ui.statusLine` 缺失，或 7 个字段均缺失或均为 `true`
- **THEN** status line SHALL 渲染 model、effort、title、dir、contextUsage、approval、rate 七类 segment 的既有内容
- **THEN** 当没有活跃 assistant turn 时，rate segment 仍 SHALL NOT 渲染

#### Scenario: 关闭单个 segment
- **WHEN** `ui.statusLine.dir` 为 `false` 且其他字段为 `true`
- **THEN** status line SHALL NOT 渲染 `dir` 形式的目录 segment
- **THEN** 其他 6 类 segment SHALL 继续按其既有条件渲染

#### Scenario: 关闭 model 同时移除 skill override 后缀
- **WHEN** `ui.statusLine.model` 为 `false` 且当前存在生效的 skill 模型覆盖
- **THEN** status line SHALL NOT 渲染模型名，也 SHALL NOT 渲染 `(SKILL override)` 后缀

#### Scenario: 关闭不改变剩余 segment 的顺序
- **WHEN** 任意子集被关闭
- **THEN** 剩余 segment SHALL 保持 model、effort、title、approval、dir、rate、contextUsage、mode、key hint 的既有相对顺序

### Requirement: segment 配置的归一化与写入
系统 SHALL 在读取配置时归一化 `ui.statusLine`：节点缺失、节点不是对象、或某字段不是布尔值时，SHALL 对受影响的字段独立回退 `true`，且 SHALL NOT 影响 `ui` 下的其他键、其他根节点，也 SHALL NOT 阻断 TUI 或 headless assistant run。

保存常规设置时，系统 SHALL 只写入本功能拥有的 7 个字段，SHALL 保留 `ui.statusLine` 下的未知字段以及 `ui` 下的其他已知和未知键，并使用同目录临时文件加 rename 原子替换目标文件。

#### Scenario: 缺失节点使用默认值
- **WHEN** 配置文件没有 `ui.statusLine` 节点
- **THEN** 系统 SHALL 按全部 `true` 归一化
- **THEN** 系统 SHALL NOT 因该节点缺失而报配置错误或改写文件

#### Scenario: 非法字段逐项回退
- **WHEN** `ui.statusLine` 为 `{"model": "隐藏", "dir": false, "rate": 0}`
- **THEN** 系统 SHALL 把 `model` 与 `rate` 回退为 `true`，把 `dir` 保持为 `false`
- **THEN** `ui` 下其他合法设置与 `ui.statusLine` 中的未知字段 SHALL 继续保留

#### Scenario: 保存只更新本功能字段
- **WHEN** 用户保存常规设置且 `ui.statusLine` 已包含未知字段 `{"foo": 1}`
- **THEN** 系统 SHALL 写入 7 个布尔字段并保留 `foo`
- **THEN** 系统 SHALL 保留 `ui` 下的 `showReasoningSummary`、`historyRenderLineLimit`、`slashSuggestionMaxVisible` 等兄弟键

## ADDED Requirements

### Requirement: 输出速率 segment
当 `ui.statusLine.rate` 为 `true` 且当前渲染 owner 存在活跃 assistant turn 时，status line SHALL 渲染一个输出速率 segment，位置固定在左侧 segment 序列的末尾，即 `dir` segment 之后。

该位置是硬性要求而非样式偏好：速率文本宽度会随数值变化（`2 t/s` 与 `128 t/s` 相差多个列），因此它 SHALL 作为左侧最后一个 segment，使宽度变化只改变左右两侧之间的填充，SHALL NOT 推动其他 segment 的位置。

该 segment 的文本 SHALL 为 `<整数> t/s` 形式，例如 `42 t/s`；数值 SHALL 来自 `output-rate-metering` 能力定义的本地估算，SHALL NOT 声称是 provider 精确计数。速率为零时 SHALL 渲染 `0 t/s`，而不是隐藏该 segment 或显示空文本。

该 segment SHALL NOT 出现于非 assistant turn 的本地活动，包括 shell 与 shell-local 命令执行、MCP 初始化、会话引用总结和手动压缩；这些活动继续只显示既有的 mode 与 elapsed。

当 `ui.statusLine.rate` 为 `false` 时，status line SHALL NOT 渲染该 segment，mode segment 的 spinner 与 elapsed 保持既有行为。

#### Scenario: 流式期间显示速率
- **WHEN** assistant turn 正在流式输出且最近窗口内观测到 token 增量
- **THEN** status line SHALL 在 `dir` segment 之后显示 `<整数> t/s`
- **THEN** 该数值 SHALL 随每次 footer 重绘按滑动窗口更新

#### Scenario: 速率宽度变化不推动其他 segment
- **WHEN** 速率从一位数变为三位数，且其他 segment 与终端宽度不变
- **THEN** `dir` 等左侧前置 segment 的起始列 SHALL 保持不变
- **THEN** 右对齐的 mode 与 key hint segment 的起始列 SHALL 保持不变
- **THEN** 仅左右之间的填充宽度 SHALL 减少

#### Scenario: 工具执行期间显示零速率
- **WHEN** assistant turn 已产出工具调用并正在本地执行该工具，窗口内没有新的 token 增量
- **THEN** status line SHALL 显示 `0 t/s`
- **THEN** mode segment SHALL 继续显示既有的 working 与 elapsed

#### Scenario: 本地活动不显示速率
- **WHEN** 用户执行 shell 或 shell-local 命令，或 MCP 正在初始化，且没有活跃 assistant turn
- **THEN** status line SHALL NOT 渲染输出速率 segment
- **THEN** 该行为 SHALL NOT 依赖 `ui.statusLine.rate` 的取值

#### Scenario: 关闭速率 segment
- **WHEN** `ui.statusLine.rate` 为 `false` 且 assistant turn 正在流式输出
- **THEN** status line SHALL NOT 渲染速率 segment
- **THEN** mode segment 的 spinner 与 elapsed SHALL 保持既有显示

#### Scenario: 窄终端下的降级顺序
- **WHEN** 终端宽度不足以同时容纳右侧全部 segment
- **THEN** status line SHALL 继续按既有规则先丢弃右侧整体，再截断左侧
- **THEN** 速率 segment SHALL NOT 改变既有的左右对齐判定条件

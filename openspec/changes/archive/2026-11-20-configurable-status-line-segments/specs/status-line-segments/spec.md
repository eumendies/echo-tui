## ADDED Requirements

### Requirement: status line 可选 segment 配置
系统 SHALL 支持通过 `~/.echo/config.json` 的 `ui.statusLine` 节点配置普通输入态 status line 的 6 个可选 segment 是否渲染：`model`、`effort`、`title`、`dir`、`contextUsage`、`approval`。每个字段 SHALL 为布尔值，默认值 SHALL 全部为 `true`。

`model` SHALL 控制模型名 segment，包含 skill override 后缀；`effort` SHALL 控制推理强度 segment；`title` SHALL 控制当前会话标题 segment；`dir` SHALL 控制项目目录名 segment；`contextUsage` SHALL 控制 `ctx <used>/<window>` segment；`approval` SHALL 控制会话内全部工具已授权的 `TOOLS all` segment。

segment 之间的相对顺序、各自文本格式、颜色语义与分隔符样式 SHALL NOT 因配置改变。配置 SHALL NOT 改变任何 segment 的取值来源或事实语义。

#### Scenario: 默认显示全部可选 segment
- **WHEN** `ui.statusLine` 缺失，或 6 个字段均缺失或均为 `true`
- **THEN** status line SHALL 渲染 model、effort、title、dir、contextUsage、approval 六类 segment 的既有内容
- **THEN** status line 的可见输出 SHALL 与引入该配置前的默认行为等价

#### Scenario: 关闭单个 segment
- **WHEN** `ui.statusLine.dir` 为 `false` 且其他字段为 `true`
- **THEN** status line SHALL NOT 渲染 `dir` 形式的目录 segment
- **THEN** 其他 5 类 segment SHALL 继续按其既有条件渲染

#### Scenario: 关闭 model 同时移除 skill override 后缀
- **WHEN** `ui.statusLine.model` 为 `false` 且当前存在生效的 skill 模型覆盖
- **THEN** status line SHALL NOT 渲染模型名，也 SHALL NOT 渲染 `(SKILL override)` 后缀

#### Scenario: 关闭不改变剩余 segment 的顺序
- **WHEN** 任意子集被关闭
- **THEN** 剩余 segment SHALL 保持 model、effort、title、approval、dir、contextUsage、mode、key hint 的既有相对顺序

### Requirement: segment 配置的归一化与写入
系统 SHALL 在读取配置时归一化 `ui.statusLine`：节点缺失、节点不是对象、或某字段不是布尔值时，SHALL 对受影响的字段独立回退 `true`，且 SHALL NOT 影响 `ui` 下的其他键、其他根节点，也 SHALL NOT 阻断 TUI 或 headless assistant run。

保存常规设置时，系统 SHALL 只写入本功能拥有的 6 个字段，SHALL 保留 `ui.statusLine` 下的未知字段以及 `ui` 下的其他已知和未知键，并使用同目录临时文件加 rename 原子替换目标文件。

#### Scenario: 缺失节点使用默认值
- **WHEN** 配置文件没有 `ui.statusLine` 节点
- **THEN** 系统 SHALL 按全部 `true` 归一化
- **THEN** 系统 SHALL NOT 因该节点缺失而报配置错误或改写文件

#### Scenario: 非法字段逐项回退
- **WHEN** `ui.statusLine` 为 `{"model": "隐藏", "dir": false}`
- **THEN** 系统 SHALL 把 `model` 回退为 `true`，把 `dir` 保持为 `false`
- **THEN** `ui` 下其他合法设置与 `ui.statusLine` 中的未知字段 SHALL 继续保留

#### Scenario: 保存只更新本功能字段
- **WHEN** 用户保存常规设置且 `ui.statusLine` 已包含未知字段 `{"foo": 1}`
- **THEN** 系统 SHALL 写入 6 个布尔字段并保留 `foo`
- **THEN** 系统 SHALL 保留 `ui` 下的 `showReasoningSummary`、`historyRenderLineLimit`、`slashSuggestionMaxVisible` 等兄弟键

### Requirement: 渲染期按配置过滤 segment
系统 SHALL 在渲染阶段按归一化配置过滤 status line segment，SHALL NOT 通过清空或改写 `StatusLineState` 字段来表达显示偏好。被关闭的 segment SHALL NOT 参与文本拼接、宽度计算或分隔符输出；相邻的保留 segment 之间 SHALL 只保留一个分隔符。

过滤后的 status line SHALL 继续遵守既有单行安全宽度约束：左右同宽对齐优先、右侧整体丢弃、左侧按安全宽度截断的降级顺序 SHALL 保持不变。

#### Scenario: 关闭后不产生悬空分隔符
- **WHEN** 左侧的 title segment 被关闭而 model、effort、approval、dir 保留
- **THEN** status line SHALL 只在相邻保留 segment 之间输出分隔符
- **THEN** status line SHALL NOT 出现连续分隔符、行首分隔符或行尾分隔符

#### Scenario: 关闭后释放的宽度让其他 segment 得以显示
- **WHEN** 终端宽度不足以同时容纳完整左侧与右侧 segment，且用户关闭了 `title`
- **THEN** status line SHALL 使用释放后的宽度继续渲染其余 segment
- **THEN** 系统 SHALL 仍按既有顺序逐步降级，不改变"右侧整体丢弃"的判定条件

#### Scenario: 过滤不改变 footer 行数
- **WHEN** 用户在保留任意数量 segment 的情况下触发普通 footer 重绘
- **THEN** status line SHALL 继续占用固定 1 行
- **THEN** footer SHALL NOT 因关闭 segment 而产生额外空行或减少行数

### Requirement: 模型调节期间强制显示 model 与 effort
当 status line 处于 composer 模型调节态时，系统 SHALL 无条件渲染 `model` 与 `effort` segment，即使配置关闭了其中任一字段。调节结束后返回普通态时，系统 SHALL 恢复按配置过滤。

该强制显示 SHALL 保留调节态的既有视觉语义：活动字段使用成对尖括号标出焦点，冻结字段保持普通着色。

#### Scenario: 关闭后仍可见调节焦点
- **WHEN** `ui.statusLine.model` 与 `ui.statusLine.effort` 均为 `false`，用户进入模型调节态
- **THEN** status line SHALL 显示模型名与推理强度
- **THEN** 当前活动字段 SHALL 继续使用 `‹value›` 形式标出焦点

#### Scenario: 调节结束后恢复配置
- **WHEN** 用户确认或取消模型调节返回普通态
- **THEN** status line SHALL NOT 再显示被配置关闭的 model 或 effort segment

### Requirement: mode 与 key hint 固定不可配
status line 的 mode segment 与 key hint segment SHALL NOT 受 `ui.statusLine` 控制，也 SHALL NOT 提供独立开关。二者 SHALL 保持既有渲染条件与文本语义。

因此即使用户关闭全部 6 个可选 segment，status line SHALL 仍至少渲染一个 mode segment，SHALL NOT 退化为空行。

#### Scenario: 全部关闭后仍显示 mode
- **WHEN** 6 个可选 segment 全部为 `false`
- **THEN** status line SHALL 继续渲染当前 mode segment
- **THEN** status line SHALL NOT 是空字符串行

#### Scenario: mode 覆盖全部既有状态
- **WHEN** 全部可选 segment 已关闭，且当前状态为 idle、plan、shell、shell-local、thinking、streaming、streaming tool、MCP 初始化或 subagent 会话窗口
- **THEN** status line SHALL 继续按既有规则显示对应的 mode 文本或 echo spinner

#### Scenario: key hint 保留
- **WHEN** 当前 active assistant turn 可中断或存在待发送消息
- **THEN** status line SHALL 继续显示既有的 `Esc 中断` 或 `Esc 移除待发送` 提示

### Requirement: segment 配置变化即时生效
TUI SHALL 在启动时从单次用户配置 snapshot 读取一次归一化 segment 配置并缓存到实例状态。配置中心保存成功或 `config.json` watcher 检测到有效变化时，系统 SHALL 从同一次共享配置刷新产生的新 snapshot 更新缓存，并只重绘 footer；普通 render 热路径 SHALL NOT 同步读取配置文件。

该变化 SHALL NOT 触发 destructive replay、SHALL NOT 清空已缓存的 context usage、SHALL NOT 追加 transcript record、SHALL NOT 中断正在运行的 assistant turn。

#### Scenario: 保存后即时反映
- **WHEN** 用户在配置中心关闭 `title` 并保存常规设置
- **THEN** 后续 status line SHALL 在保持配置中心打开的情况下按新配置渲染
- **THEN** 系统 SHALL NOT 重放 transcript 或追加 record

#### Scenario: 外部修改后即时反映
- **WHEN** 用户在外部编辑 `config.json` 把 `ui.statusLine.approval` 从 `true` 改为 `false`
- **THEN** watcher 检测到有效变化后 status line SHALL 按新配置渲染
- **THEN** 同一有效值的重复通知 SHALL NOT 触发重复重绘

#### Scenario: 变化不干扰进行中的运行
- **WHEN** assistant turn 正在流式输出时 segment 配置发生变化
- **THEN** 系统 SHALL 只重绘 footer
- **THEN** 系统 SHALL NOT 中断该 turn、清空 context usage 或改变其 provider 输入

### Requirement: 配置适用范围
该配置 SHALL 作用于普通 composer footer 的 status line 以及 subagent 会话窗口 run 索引块下方的 status line。`/btw` 侧会话窗口 SHALL 使用同一份归一化配置。

命令、工具审批、用户提问、文件选择等 command surface SHALL 继续以自身内容替换普通输入区域，不受该配置影响。`/status` 的只读卡片、`/context`、`/usage` 等命令 surface SHALL NOT 受该配置影响。headless `--once` SHALL NOT 受影响。

#### Scenario: BTW 会话继承配置
- **WHEN** 用户关闭 `dir` 后进入 `/btw` 侧会话
- **THEN** BTW status line SHALL 按同一配置隐藏目录 segment

#### Scenario: subagent 会话窗口继承配置
- **WHEN** 用户关闭 `contextUsage` 后用 `Ctrl+O` 打开 subagent 会话窗口
- **THEN** 窗口底部 status line SHALL 不显示 `ctx` segment

#### Scenario: command surface 不受影响
- **WHEN** 6 个可选 segment 全部关闭后用户提交 `/status`
- **THEN** `/status` 卡片 SHALL 继续显示其既有完整概览内容
- **THEN** 该配置 SHALL NOT 裁剪任何 command surface

#### Scenario: headless 路径不受影响
- **WHEN** 用户执行 `echo-tui --once "<prompt>"`
- **THEN** headless run SHALL NOT 读取该配置用于渲染，也 SHALL NOT 因该配置改变 provider 输入或退出码

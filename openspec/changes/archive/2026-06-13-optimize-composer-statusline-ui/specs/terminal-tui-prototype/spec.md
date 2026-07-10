## MODIFIED Requirements

### Requirement: transcript 视觉标记
系统 SHALL 使用轻量符号和克制颜色区分 transcript 中的用户消息、assistant 消息、本地 error 消息、本地中断提示和 pending assistant，而不是在 transcript 中显示 `user:`、`assistant:` 或 `error:` 文本标签。用户消息 SHALL 使用 quote-style 青色粗竖条前缀和覆盖整条消息行的灰色背景；用户消息的整行背景 SHALL 在渲染投影阶段按当前终端宽度计算。assistant 消息内容 SHALL 支持 Markdown-aware terminal projection，包括 table-aware projection；role 视觉标记 SHALL 继续由 transcript renderer 控制。

#### Scenario: 用户消息使用粗竖条前缀
- **WHEN** 用户消息被追加到 transcript
- **THEN** 该消息 SHALL 使用 `▌` 或等价粗竖条作为前缀
- **THEN** 该前缀 SHALL 使用青色或等价 accent color 显示
- **THEN** 该消息 SHALL 使用覆盖整条消息行的灰色背景与 assistant 消息区分
- **THEN** 用户消息块的上下 padding 行 SHALL 同样显示该粗竖条前缀并使用灰色背景

#### Scenario: 用户消息 resize 后背景覆盖当前宽度
- **WHEN** 用户消息已经追加到 transcript 且终端随后变窄或变宽
- **THEN** 用户消息 SHALL 基于当前终端宽度重新渲染，灰色背景 SHALL 覆盖重新 wrap 后每一行的当前渲染宽度
- **THEN** 重新渲染后的用户消息内容行和 padding 行 SHALL 继续显示粗竖条前缀

#### Scenario: assistant 完成消息使用独立前缀
- **WHEN** assistant 消息完成并追加到 transcript
- **THEN** 该消息 SHALL 使用 `◆` 或等价符号作为前缀，并使用与用户消息不同的视觉样式
- **THEN** 该消息内容 SHALL 按 Markdown-aware terminal projection 显示

#### Scenario: assistant table 消息保持 role 前缀
- **WHEN** assistant 消息包含 Markdown table 并被追加到 transcript
- **THEN** 该消息 SHALL 使用 `◆` 或等价符号作为首条可见行前缀
- **THEN** table continuation lines SHALL 与 assistant block 的视觉缩进保持一致

#### Scenario: error 消息使用独立可见投影
- **WHEN** 本地 error record 被追加或恢复到 transcript
- **THEN** 该消息 SHALL 使用区别于 user 和 assistant 的轻量可见样式
- **THEN** 该消息 SHALL NOT 显示为 `assistant` 回复

#### Scenario: 本地中断提示使用独立可见投影
- **WHEN** 本地中断提示 record 被追加或恢复到 transcript
- **THEN** 该消息 SHALL 使用区别于 user、assistant 和 error 的克制可见样式
- **THEN** 该消息 SHALL NOT 显示为 assistant 回复或 error 反馈

#### Scenario: transcript 不显示文字角色标签
- **WHEN** user、assistant 或 error 消息被渲染为 transcript block
- **THEN** transcript SHALL NOT 显示 `user:`、`assistant:` 或 `error:` 作为消息前缀

### Requirement: footer status line
系统 SHALL 在普通 composer footer 中使用 segmented status line 展示当前运行状态。status line SHALL 优先展示当前选择的模型、当前模型 profile 显式配置的 reasoning effort、当前目录、真实 context usage 和当前运行模式；当前选择的模型 SHALL 作为最靠前的信息显示并使用区别于普通状态文本的强调颜色。reasoning effort SHALL 作为独立 segment 展示，而不是拼接进模型名称；该 segment 的圆点颜色 SHALL 使用固定 cyan 或等价 accent color。status line SHALL 暂不显示 git branch。当当前 interaction mode 为 plan 且没有更高优先级 pending 状态时，status line SHALL 显示 `plan` 或等价 plan mode 状态，并 SHALL 遵循现有终端宽度和 footer 局部重绘约束。

#### Scenario: 普通输入显示 idle status line
- **WHEN** 普通 composer 可见且没有 slash suggestion、pending preview、command surface 或 plan mode
- **THEN** footer SHALL 在 composer 下方显示 status line
- **THEN** status line SHALL 优先显示当前选择的模型名称或等价模型标识
- **THEN** status line SHALL 使用区别于普通状态文本的强调颜色显示当前模型信息
- **THEN** status line SHALL 显示当前目录或等价目录标识
- **THEN** status line SHALL 显示 ready、idle 或等价普通输入状态
- **THEN** status line SHALL NOT 显示 git branch

#### Scenario: plan mode 显示 plan status line
- **WHEN** 普通 composer 可见且当前 interaction mode 为 plan，且没有 slash suggestion、pending preview 或 command surface
- **THEN** footer SHALL 在 composer 下方显示 status line
- **THEN** status line SHALL 显示 `plan` 或等价 plan mode 状态
- **THEN** status line SHALL NOT 显示 `/plan off` 或等价退出提示

#### Scenario: slash suggestion 显示 command status line
- **WHEN** 普通 composer 正在显示 slash suggestion
- **THEN** status line SHALL 显示 command 或等价命令输入状态
- **THEN** status line SHALL 显示补全、上下选择和关闭建议相关快捷键提示，或以等价方式为 slash suggestion 提供操作提示

#### Scenario: pending 状态显示动态模式
- **WHEN** 当前 render state 包含 thinking、streaming 或 tool call pending
- **THEN** status line SHALL 显示对应的 thinking、streaming 或 tool 模式
- **THEN** tool call pending 模式 SHALL 包含工具名或等价工具标识
- **THEN** status line SHALL 显示退出相关操作提示，或以等价方式提示可中断当前 assistant turn

#### Scenario: 模型选择变化后 status line 更新模型信息
- **WHEN** 用户通过 `/model` 或等价机制切换当前模型
- **THEN** 后续普通 composer status line SHALL 显示新选中的模型名称或等价模型标识
- **THEN** status line SHALL NOT 显示旧模型信息

#### Scenario: 已配置推理等级时 status line 显示 effort
- **WHEN** 当前 selected model profile 配置了有效的 `reasoning.effort`
- **THEN** 普通 composer status line SHALL 使用独立 segment 显示该推理等级
- **THEN** 显示文本 SHALL 能让用户区分当前模型和当前推理等级
- **THEN** effort segment 前置圆点颜色 SHALL 使用固定 cyan 或等价 accent color

#### Scenario: 未配置推理等级时 status line 不显示 effort
- **WHEN** 当前 selected model profile 没有配置 `reasoning.effort`
- **THEN** 普通 composer status line SHALL NOT 推断或显示服务端默认推理等级

#### Scenario: 推理等级变化后 status line 更新 effort 信息
- **WHEN** 用户通过 `/effort` 修改当前模型 profile 的推理等级
- **THEN** 后续普通 composer status line SHALL 显示新推理等级
- **THEN** status line SHALL NOT 显示旧推理等级
- **THEN** 新推理等级的圆点颜色 SHALL 保持固定 accent color

#### Scenario: command surfaces 保留自身提示
- **WHEN** footer 当前显示 info、select、scale、resume、confirm 或 choice command surface
- **THEN** 该 surface SHALL 继续使用自身的 `dismissHint` 或等价 surface 内提示
- **THEN** 全局 composer status line SHALL NOT 覆盖该 surface 的交互提示

#### Scenario: status line 遵循安全宽度
- **WHEN** terminal width 变窄或 status line 文本超过当前安全宽度
- **THEN** status line SHALL 被裁剪到 safe render width 内
- **THEN** status line SHALL NOT 因写满终端最后一列而触发额外自动换行
- **THEN** status line SHALL 优先保留左侧模型、effort 和目录信息，右侧动态状态 MAY 被整体省略或裁剪

### Requirement: status line 显示真实 context usage
普通输入态 status line SHALL 在存在真实 provider context usage 时显示最近一次 provider request 的 input token usage 和当前模型 context window。该显示 SHALL 作为 segmented status line 的 context segment 呈现，并 SHALL 使用短文本片段；该 usage 的语义仍为最近一次真实 provider usage，而不是本地实时估算。

#### Scenario: status line 显示最近 usage
- **WHEN** app 已收到真实 provider context usage
- **AND** footer 处于普通输入态且没有 command、approval 或 user-question surface
- **THEN** status line SHALL 显示 context usage segment
- **THEN** context usage segment SHALL 包含 used tokens 和 context window
- **THEN** context usage segment SHALL 使用 `ctx <used>/<window>` 或等价短文本表达，例如 `ctx 18.2k/128k`

#### Scenario: 没有真实 usage 时不显示 context usage
- **WHEN** app 尚未收到真实 provider context usage
- **THEN** status line SHALL 保持既有模型、effort、目录和 mode 显示
- **THEN** status line SHALL NOT 显示本地估算 context usage

#### Scenario: command surface 替换 status line
- **WHEN** command surface、tool approval surface 或 user-question surface 正在显示
- **THEN** footer SHALL 继续使用该 surface 自身内容替换普通 composer/status line 区域
- **THEN** context usage SHALL NOT 额外显示为独立行

#### Scenario: status line 保持单行裁剪
- **WHEN** status line 包含 context usage 且终端宽度不足以显示完整内容
- **THEN** status line SHALL 继续按现有安全宽度裁剪为单行
- **THEN** footer SHALL NOT 因 context usage 产生额外换行

#### Scenario: token 数使用紧凑格式
- **WHEN** status line 渲染 context usage
- **THEN** token 数小于 1000 时 SHALL 直接显示整数
- **THEN** token 数大于等于 1000 时 SHALL 使用紧凑 `k` 格式显示

### Requirement: footer 布局
系统 SHALL 渲染底部 footer。footer 由可选 pending preview 和当前输入 surface 组成：普通输入态的 surface 为顶满 terminal safe render width 的 boxed composer、可选 slash 命令提示列表和固定 1 行 segmented status line；command surface 态的 surface 为覆盖在 composer 区域的命令内容和自身提示。assistant streaming pending preview SHALL 使用按 terminal rows 动态预算的 Markdown-aware 尾部预览，避免长输出时 footer 高度无限增长；当 draft 包含有效 table 时，该预览 SHALL 使用 table-aware projection。

#### Scenario: footer 显示 boxed composer 和 status line
- **WHEN** 没有 pending assistant response，且 command surface 未激活
- **THEN** footer SHALL 渲染 boxed composer，并在其后渲染恰好 1 行 status line
- **THEN** boxed composer SHALL 使用当前项目的 `> ` 输入前缀
- **THEN** boxed composer SHALL 顶满当前 terminal safe render width
- **THEN** boxed composer 边框 SHALL NOT 显示 `Message` 或其他标题文字

#### Scenario: 空 composer 显示辅助 placeholder
- **WHEN** 普通 composer 可见且 composer 内容为空
- **THEN** boxed composer SHALL 在输入位置显示辅助 placeholder
- **THEN** placeholder SHALL 包含 `/` 命令入口、`Ctrl+J` 换行和 Enter 发送提示
- **THEN** placeholder SHALL NOT 写入 composer state、transcript 或 input history

#### Scenario: 非空 composer 隐藏 placeholder
- **WHEN** 普通 composer 可见且 composer 内容非空
- **THEN** boxed composer SHALL 显示真实 composer 内容
- **THEN** boxed composer SHALL NOT 同时显示 placeholder 文本

#### Scenario: footer 显示 slash 命令提示
- **WHEN** 没有 pending assistant response、help overlay 或 active command session，且 composer 内容是可提示的 slash 命令前缀
- **THEN** footer SHALL 在 boxed composer 和 status line 之间渲染 slash 命令提示列表
- **THEN** footer SHALL 保持 composer 光标可见并位于当前 composer 逻辑位置

#### Scenario: assistant 工作期间显示 pending preview
- **WHEN** assistant 正在 thinking 或 streaming，且 command surface 未激活
- **THEN** footer SHALL 在 boxed composer 和 status line 上方包含 pending preview

#### Scenario: streaming pending preview 保持有限高度
- **WHEN** assistant 正在 streaming 长 Markdown draft
- **THEN** footer SHALL 在 Markdown-aware terminal projection 后折叠 pending preview 的头部并显示尾部内容
- **THEN** footer SHALL NOT 因完整 draft 变长而把 pending preview 无限追加到 terminal scrollback

#### Scenario: streaming table preview 保持有限高度
- **WHEN** assistant 正在 streaming 长 Markdown table draft
- **THEN** footer SHALL 在 table-aware terminal projection 后折叠 pending preview 的头部并显示尾部内容
- **THEN** footer SHALL NOT 因 table rows 增长而把 pending preview 无限追加到 terminal scrollback

#### Scenario: composer 支持多行显示
- **WHEN** command surface 未激活，且 composer 内容包含插入的换行，或因终端宽度发生 wrap
- **THEN** footer SHALL 在 boxed composer 内为 composer 内容分配足够的行数，再渲染 status line 行
- **THEN** footer 重绘后的可见光标 SHALL 位于 boxed composer 内的当前 composer 逻辑位置

#### Scenario: command surface 替换普通 composer surface
- **WHEN** command surface 处于活跃状态
- **THEN** footer SHALL 使用 command surface 内容替换普通 boxed composer 与 status line 的显示区域
- **THEN** command surface 内容 SHALL 保持在 footer 临时区域内，而不是写入 transcript 历史区域

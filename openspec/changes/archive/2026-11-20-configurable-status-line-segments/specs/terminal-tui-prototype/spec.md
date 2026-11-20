## MODIFIED Requirements

### Requirement: footer status line
系统 SHALL 在普通 composer footer 中使用 segmented status line 展示当前运行状态。status line SHALL 优先展示当前选择的模型、当前模型 profile 显式配置的 reasoning effort、当前目录、真实 context usage 和当前运行模式；当前选择的模型 SHALL 作为最靠前的信息显示并使用区别于普通状态文本的强调颜色。reasoning effort SHALL 作为独立 segment 展示，而不是拼接进模型名称或添加圆点前缀。status line SHALL 暂不显示 git branch。当当前 interaction mode 为 plan 且没有更高优先级 pending 状态时，status line SHALL 显示 `plan` 或等价 plan mode 状态，并 SHALL 遵循现有终端宽度和 footer 局部重绘约束。普通 composer footer、slash suggestion 和 command surfaces SHALL 遵循共享 footer UI 语言：使用统一 cyan palette、`▌` 焦点条、`●/○` 状态 marker 和中文为主的默认操作提示。

上述 segment SHALL 在用户未关闭对应项时按本要求展示。用户 MAY 通过 `/config` → 常规 → 状态栏显示项关闭模型、推理强度、会话标题、目录、context usage 和 `TOOLS all` 这 6 个 segment；被关闭 segment 的过滤、强制显示和降级语义 SHALL 由 `status-line-segments` 能力定义。mode segment 与 key hint segment SHALL NOT 可关闭，status line SHALL 始终保留当前运行状态反馈。

#### Scenario: 普通输入显示 idle status line
- **WHEN** 普通 composer 可见且没有 slash suggestion、pending preview、command surface 或 plan mode
- **THEN** footer SHALL 在 composer 下方显示 status line
- **THEN** status line SHALL 优先显示当前选择的模型名称或等价模型标识
- **THEN** status line SHALL 使用区别于普通状态文本的强调颜色显示当前模型信息
- **THEN** status line SHALL 显示当前目录或等价目录标识
- **THEN** status line SHALL 显示 ready、idle 或等价普通输入状态
- **THEN** status line SHALL NOT 显示 git branch

#### Scenario: 用户关闭的 segment 不渲染
- **WHEN** 用户通过配置中心关闭了模型与目录 segment，且当前为 idle 普通输入态
- **THEN** status line SHALL NOT 渲染模型名或目录 segment
- **THEN** status line SHALL 继续渲染 mode segment 与其余未关闭 segment
- **THEN** status line SHALL 继续只占 1 行

#### Scenario: plan mode 显示 plan status line
- **WHEN** 普通 composer 可见且当前 interaction mode 为 plan，且没有 slash suggestion、pending preview 或 command surface
- **THEN** footer SHALL 在 composer 下方显示 status line
- **THEN** status line SHALL 显示 `plan` 或等价 plan mode 状态
- **THEN** status line SHALL NOT 显示 `/plan off` 或等价退出提示
- **THEN** status line MAY 显示 `/mode normal` 或等价 mode 命令提示

#### Scenario: slash suggestion 显示 command status line
- **WHEN** 普通 composer 正在显示 slash suggestion
- **THEN** status line SHALL 显示 command 或等价命令输入状态
- **THEN** status line SHALL 显示补全、上下选择和关闭建议相关快捷键提示，或以等价方式为 slash suggestion 提供操作提示
- **THEN** slash suggestion 当前项 SHALL 遵循共享 footer UI 语言，使用 `▌` 或等价焦点条、active 背景和 cyan 高亮文本表达当前项

#### Scenario: pending 状态显示动态模式
- **WHEN** 当前 render state 包含 thinking、streaming 或 tool call pending
- **THEN** status line SHALL 显示对应的 thinking、working/streaming 或 tool 模式
- **THEN** tool call pending 模式 SHALL 包含工具名或等价工具标识
- **THEN** 当当前 active assistant turn 可中断时，status line SHALL 显示 `Esc 中断` 或等价操作提示
- **THEN** thinking/working 模式 SHALL 在保留 echo spinner 的同时显示该中断提示
- **THEN** 高优先级 command、tool approval、file picker 或 user question surface SHALL 继续使用自身的 Esc 操作提示，不得同时显示全局中断提示

#### Scenario: 模型选择变化后 status line 更新模型信息
- **WHEN** 用户通过 `/model` 或等价机制切换当前模型
- **THEN** 后续普通 composer status line SHALL 显示新选中的模型名称或等价模型标识
- **THEN** status line SHALL NOT 显示旧模型信息

#### Scenario: 已配置推理等级时 status line 显示 effort
- **WHEN** 当前 selected model profile 配置了有效的 `reasoning.effort`
- **THEN** 普通 composer status line SHALL 使用独立 segment 显示该推理等级
- **THEN** 显示文本 SHALL 能让用户区分当前模型和当前推理等级
- **THEN** effort segment SHALL NOT 显示圆点前缀

#### Scenario: 未配置推理等级时 status line 不显示 effort
- **WHEN** 当前 selected model profile 没有配置 `reasoning.effort`
- **THEN** 普通 composer status line SHALL NOT 推断或显示服务端默认推理等级

#### Scenario: 推理等级变化后 status line 更新 effort 信息
- **WHEN** 用户通过 `/effort` 修改当前模型 profile 的推理等级
- **THEN** 后续普通 composer status line SHALL 显示新推理等级
- **THEN** status line SHALL NOT 显示旧推理等级
- **THEN** 新推理等级 SHALL NOT 添加圆点前缀

#### Scenario: command surfaces 保留自身提示
- **WHEN** footer 当前显示 info、select、scale、resume、confirm 或 choice command surface
- **THEN** 该 surface SHALL 继续使用自身的 `dismissHint` 或等价 surface 内提示
- **THEN** 全局 composer status line SHALL NOT 覆盖该 surface 的交互提示
- **THEN** 该 surface 的默认提示 SHALL 遵循共享 footer UI 语言，使用中文为主的操作文案并保留按键名英文

#### Scenario: status line 遵循安全宽度
- **WHEN** terminal width 变窄或 status line 文本超过当前安全宽度
- **THEN** status line SHALL 被裁剪到 safe render width 内
- **THEN** status line SHALL NOT 因写满终端最后一列而触发额外自动换行
- **THEN** status line SHALL 在对应 segment 未关闭时优先保留左侧模型、effort 和目录信息，右侧动态状态 MAY 被整体省略或裁剪

### Requirement: status line 显示真实 context usage
普通输入态 status line SHALL 在存在真实 provider context usage 且 context usage segment 未被用户关闭时显示最近一次 provider request 的 input token usage 和当前模型 context window。该显示 SHALL 作为 segmented status line 的 context segment 呈现，并 SHALL 使用短文本片段；该 usage 的语义仍为最近一次真实 provider usage，而不是本地实时估算。系统 SHALL 保留该 usage 的详细 breakdown 供 `/context` 命令展示，但 status line SHALL 继续只显示短文本总览。关闭该 segment SHALL NOT 清除或丢弃已缓存的 usage 事实。

#### Scenario: status line 显示最近 usage
- **WHEN** app 已收到真实 provider context usage
- **AND** context usage segment 未被用户关闭
- **AND** footer 处于普通输入态且没有 command、approval 或 user-question surface
- **THEN** status line SHALL 显示 context usage segment
- **THEN** context usage segment SHALL 包含 used tokens 和 context window
- **THEN** context usage segment SHALL 使用 `ctx <used>/<window>` 或等价短文本表达，例如 `ctx 18.2k/128k`

#### Scenario: 用户关闭 context usage 段
- **WHEN** app 已收到真实 provider context usage，且用户关闭了 context usage segment
- **THEN** status line SHALL NOT 显示 `ctx` segment
- **THEN** 系统 SHALL 继续保留该 usage 供 `/context` 命令与后续重新开启时展示
- **THEN** status line SHALL 按既有对齐规则使用释放后的宽度

#### Scenario: 没有真实 usage 时不显示 context usage
- **WHEN** app 尚未收到真实 provider context usage
- **THEN** status line SHALL 保持既有模型、effort、目录和 mode 显示
- **THEN** status line SHALL NOT 显示本地估算 context usage

#### Scenario: command surface 替换 status line
- **WHEN** command surface、tool approval surface 或 user-question surface 正在显示
- **THEN** footer SHALL 继续使用该 surface 自身内容替换普通 composer/status line 区域
- **THEN** context usage SHALL NOT 额外显示为独立行

#### Scenario: status line 不展示详细 breakdown
- **WHEN** app 已收到带分类 breakdown 的真实 provider context usage
- **AND** footer 处于普通输入态且没有 command、approval 或 user-question surface
- **THEN** status line SHALL 继续仅显示 context usage 短文本总览
- **AND** status line SHALL NOT 展示 System prompt、Skills、Tools、Messages 或 Reasoning 的分类明细

#### Scenario: status line 保持单行裁剪
- **WHEN** status line 包含 context usage 且终端宽度不足以显示完整内容
- **THEN** status line SHALL 继续按现有安全宽度裁剪为单行
- **THEN** footer SHALL NOT 因 context usage 产生额外换行

#### Scenario: token 数使用紧凑格式
- **WHEN** status line 渲染 context usage
- **THEN** token 数小于 1000 时 SHALL 直接显示整数
- **THEN** token 数大于等于 1000 时 SHALL 使用紧凑 `k` 格式显示

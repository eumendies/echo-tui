## MODIFIED Requirements

### Requirement: footer status line
系统 SHALL 在普通 composer footer 中使用 segmented status line 展示当前运行状态。status line SHALL 优先展示当前选择的模型、当前模型 profile 显式配置的 reasoning effort、当前目录、真实 context usage 和当前运行模式；当前选择的模型 SHALL 作为最靠前的信息显示并使用区别于普通状态文本的强调颜色。reasoning effort SHALL 作为独立 segment 展示，而不是拼接进模型名称；该 segment 的圆点颜色 SHALL 使用固定 cyan 或等价 accent color。status line SHALL 暂不显示 git branch。当当前 interaction mode 为 plan 且没有更高优先级 pending 状态时，status line SHALL 显示 `plan` 或等价 plan mode 状态，并 SHALL 遵循现有终端宽度和 footer 局部重绘约束。普通 composer footer、slash suggestion 和 command surfaces SHALL 遵循共享 footer UI 语言：使用统一 cyan palette、`▌` 焦点条、`●/○` 状态 marker 和中文为主的默认操作提示。

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
- **THEN** tool call pending 模式 MAY 显示退出相关操作提示，或以等价方式提示可中断当前 assistant turn
- **THEN** thinking/working 模式 SHALL 遵循 echo spinner 要求，不额外追加响应中 key hint

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
- **THEN** 该 surface 的默认提示 SHALL 遵循共享 footer UI 语言，使用中文为主的操作文案并保留按键名英文

#### Scenario: status line 遵循安全宽度
- **WHEN** terminal width 变窄或 status line 文本超过当前安全宽度
- **THEN** status line SHALL 被裁剪到 safe render width 内
- **THEN** status line SHALL NOT 因写满终端最后一列而触发额外自动换行
- **THEN** status line SHALL 优先保留左侧模型、effort 和目录信息，右侧动态状态 MAY 被整体省略或裁剪

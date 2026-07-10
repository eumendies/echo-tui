## MODIFIED Requirements

### Requirement: footer status line
系统 SHALL 在普通 composer footer 中使用 status line 替代静态 hint。status line SHALL 展示当前项目名、当前选择的模型、当前运行模式和当前上下文中不容易自然发现的操作提示；当前选择的模型 SHALL 作为最靠前的信息显示并使用区别于普通状态文本的强调颜色；当当前模型 profile 配置了 reasoning effort 时，status line SHALL 在模型信息中展示该推理等级，并 SHALL 遵循现有终端宽度和 footer 局部重绘约束。

#### Scenario: 普通输入显示 idle status line
- **WHEN** 普通 composer 可见且没有 slash suggestion、pending preview 或 command surface
- **THEN** footer SHALL 在 composer 下方显示 status line
- **THEN** status line SHALL 优先显示当前选择的模型名称或等价模型标识
- **THEN** status line SHALL 使用区别于普通状态文本的强调颜色显示当前模型信息
- **THEN** status line SHALL 显示当前项目名
- **THEN** status line SHALL 显示 `idle` 或等价普通输入状态
- **THEN** status line SHALL 显示换行和命令入口等非显而易见操作提示
- **THEN** status line SHALL NOT 显示 Enter 发送这类基础输入提示

#### Scenario: 已配置推理等级时 status line 显示 effort
- **WHEN** 当前 selected model profile 配置了有效的 `reasoning.effort`
- **THEN** 普通 composer status line SHALL 在模型信息中显示该推理等级
- **THEN** 显示文本 SHALL 能让用户区分当前模型和当前推理等级

#### Scenario: 未配置推理等级时 status line 不显示 effort
- **WHEN** 当前 selected model profile 没有配置 `reasoning.effort`
- **THEN** 普通 composer status line SHALL NOT 推断或显示服务端默认推理等级

#### Scenario: slash suggestion 显示 command status line
- **WHEN** 普通 composer 正在显示 slash suggestion
- **THEN** status line SHALL 显示 command 或等价命令输入状态
- **THEN** status line SHALL 显示补全、上下选择和关闭建议相关快捷键提示

#### Scenario: pending 状态显示动态模式
- **WHEN** 当前 render state 包含 thinking、streaming 或 tool call pending
- **THEN** status line SHALL 显示对应的 thinking、streaming 或 tool 模式
- **THEN** tool call pending 模式 SHALL 包含工具名或等价工具标识
- **THEN** status line SHALL 显示退出相关操作提示

#### Scenario: 模型选择变化后 status line 更新模型信息
- **WHEN** 用户通过 `/model` 或等价机制切换当前模型
- **THEN** 后续普通 composer status line SHALL 显示新选中的模型名称或等价模型标识
- **THEN** status line SHALL NOT 显示旧模型信息

#### Scenario: 推理等级变化后 status line 更新 effort 信息
- **WHEN** 用户通过 `/effort` 修改当前模型 profile 的推理等级
- **THEN** 后续普通 composer status line SHALL 显示新推理等级
- **THEN** status line SHALL NOT 显示旧推理等级

#### Scenario: command surfaces 保留自身提示
- **WHEN** footer 当前显示 info、select、scale、confirm 或 choice command surface
- **THEN** 该 surface SHALL 继续使用自身的 `dismissHint` 或等价 surface 内提示
- **THEN** 全局 composer status line SHALL NOT 覆盖该 surface 的交互提示

#### Scenario: status line 遵循安全宽度
- **WHEN** terminal width 变窄或 status line 文本超过当前安全宽度
- **THEN** status line SHALL 被裁剪到 safe render width 内
- **THEN** status line SHALL NOT 因写满终端最后一列而触发额外自动换行

### Requirement: 本地 slash 命令
系统 SHALL 保持本地 slash 命令与真实 LLM adapter 隔离。命中本地 slash handler 的输入 SHALL 由 command runtime 处理，而不是提交给真实 agent；纯 `/model` SHALL 在 composer/footer 区域打开模型 command surface，展示当前真实模型配置、可用模型 profile 或安全配置错误。存在多个可选 profile 时，`/model` SHALL 允许用户选择模型并将选择持久化到用户级 LLM 配置；纯 `/effort` SHALL 在 composer/footer 区域打开推理等级 command surface，展示可选 reasoning effort 并将选择直接持久化到当前 selected model profile；这些命令 SHALL NOT 写入 transcript 或启动真实 agent。系统 SHALL 在普通 composer 输入态为 slash 命令提供临时提示和补全能力，提示交互 SHALL NOT 启动 command session、写入 transcript、进入输入历史或触发真实 agent。

#### Scenario: 本地 slash 命令不启动真实 agent
- **WHEN** 用户提交纯 `/help`、`/model`、`/effort`、`/clear` 或 `/resume` 且命中对应本地 slash handler
- **THEN** 系统 SHALL 由 slash command runtime 处理该输入
- **THEN** 系统 SHALL NOT 调用真实 LLM adapter

#### Scenario: slash 前缀显示命令提示
- **WHEN** assistant 未处于 thinking 或 streaming，且没有 active command session，且 composer 内容是以 `/` 开头的单行 slash 前缀
- **THEN** 系统 SHALL 在普通 composer 下方显示 slash 命令提示列表
- **THEN** 每个提示项 SHALL 在单行内展示 slash 命令和用户可见描述
- **THEN** composer 光标 SHALL 保持可见并位于当前输入位置

#### Scenario: slash 命令提示按前缀过滤
- **WHEN** composer 内容为 `/`
- **THEN** 系统 SHALL 展示所有可用本地 slash 命令
- **WHEN** composer 内容为 `/e`
- **THEN** 系统 SHALL 只展示命令名以 `/e` 为前缀的可用 slash 命令

#### Scenario: slash 命令提示不在普通文本中显示
- **WHEN** composer 内容不是以 `/` 开头，或内容包含空格，或内容包含换行
- **THEN** 系统 SHALL NOT 显示 slash 命令提示列表
- **THEN** Up/Down SHALL 保持现有输入历史浏览或 composer 多行移动行为

#### Scenario: slash 命令提示方向键移动选择
- **WHEN** slash 命令提示列表处于可见状态，且用户按下 Up 或 Down
- **THEN** 系统 SHALL 更新提示列表中的当前选中项
- **THEN** 选择到达提示列表首尾后 SHALL 循环到另一端
- **THEN** 系统 SHALL NOT 修改 composer 文本
- **THEN** 系统 SHALL NOT 写入配置文件、transcript 或输入历史

#### Scenario: Tab 补全 slash 命令
- **WHEN** slash 命令提示列表处于可见状态，且用户按下 Tab
- **THEN** 系统 SHALL 将当前选中的 slash 命令写入 composer
- **THEN** 补全文本 SHALL 是纯 slash 命令，不自动追加空格
- **THEN** 系统 SHALL NOT 启动 command session、写入 transcript 或触发真实 agent

#### Scenario: active command session 隐藏 slash 命令提示
- **WHEN** `/model`、`/effort`、`/resume`、`/clear` 或 `/help` 的 command session 已经处于活跃状态
- **THEN** 系统 SHALL NOT 显示 slash 命令提示列表
- **THEN** Up/Down/Enter/Esc SHALL 继续交给 active command session 处理

#### Scenario: response 进行中隐藏 slash 命令提示
- **WHEN** assistant 正在 thinking 或 streaming，且 composer 内容以 `/` 开头
- **THEN** 系统 SHALL NOT 显示 slash 命令提示列表
- **THEN** 系统 SHALL NOT 允许提示补全绕过 response lock 启动本地 slash command

#### Scenario: /model 显示模型选择列表
- **WHEN** 用户提交纯 `/model` 且当前 `~/.echo/config.json` 中存在多个有效 `llm.models` profile
- **THEN** 系统 SHALL 打开 `select` command surface
- **THEN** 该 surface SHALL 在单行内展示可选模型 profile 的 label 和模型名
- **THEN** 当前生效的 profile SHALL 作为初始选中项

#### Scenario: /model 方向键移动选择
- **WHEN** `/model` select command session 处于活跃状态，且用户按下 Up 或 Down
- **THEN** 系统 SHALL 更新选中的模型 profile
- **THEN** 系统 SHALL 只更新 command session surface/data，不写入配置文件

#### Scenario: /model 确认选择并持久化
- **WHEN** `/model` select command session 处于活跃状态，且用户按下 Enter
- **THEN** 系统 SHALL 将选中 profile id 写入 `~/.echo/config.json` 的 `llm.selectedModel`
- **THEN** 系统 SHALL 关闭 `/model` command session 并清空 composer
- **THEN** 系统 SHALL NOT 追加 transcript record

#### Scenario: /model 取消选择不持久化
- **WHEN** `/model` command session 处于活跃状态，且用户按下 Esc
- **THEN** 系统 SHALL 关闭 `/model` command session 并清空 composer
- **THEN** 系统 SHALL 保持 `~/.echo/config.json` 不变

#### Scenario: /model 持久化失败显示安全错误
- **WHEN** `/model` 确认选择时无法写入用户级配置文件
- **THEN** 系统 SHALL 保持 `/model` command session 可见或打开安全错误 surface
- **THEN** 该 surface SHALL 展示可操作的安全错误摘要
- **THEN** 错误内容 SHALL NOT 包含敏感字段值

#### Scenario: /model 显示安全配置错误
- **WHEN** 用户提交纯 `/model` 但当前模型配置缺失、无效或无法读取
- **THEN** 系统 SHALL 打开安全的 command surface 展示可操作错误摘要
- **THEN** 错误内容 SHALL NOT 包含敏感字段值

#### Scenario: response 进行中阻止 /model
- **WHEN** assistant 正在 thinking 或 streaming，且用户提交纯 `/model`
- **THEN** 系统 SHALL NOT 进入 `/model` command session
- **THEN** 系统 SHALL NOT 修改真实 LLM adapter 的模型配置

#### Scenario: /effort 显示推理等级刻度
- **WHEN** 用户提交纯 `/effort` 且当前 `~/.echo/config.json` 中存在有效 selected model profile
- **THEN** 系统 SHALL 打开 `scale` command surface
- **THEN** 该 surface SHALL 以 slider 轨道展示 `none`、`minimal`、`low`、`medium`、`high`、`xhigh` 六个选项的有序位置
- **THEN** 该 surface SHALL 展示从速度到深度的方向提示
- **THEN** 该 surface SHALL 用轨道上的高亮块指示当前选中位置
- **THEN** 该 surface SHALL 在轨道下方显示全部 effort 名称并高亮当前选中项
- **THEN** 该 surface SHALL NOT 显示冗余的长句解释
- **THEN** 当前 profile 已配置的 effort SHALL 作为初始选中项
- **THEN** 当前 profile 未配置 effort 时 SHALL 默认选中 `medium`

#### Scenario: /effort 方向键移动选择
- **WHEN** `/effort` scale command session 处于活跃状态，且用户按下 Left 或 Right
- **THEN** 系统 SHALL 更新选中的推理等级
- **THEN** 系统 SHALL 只更新 command session surface/data，不写入配置文件

#### Scenario: /effort 确认选择并覆盖当前 profile
- **WHEN** `/effort` scale command session 处于活跃状态，且用户按下 Enter
- **THEN** 系统 SHALL 将选中 effort 写入当前 selected model profile 的 `reasoning.effort`
- **THEN** 系统 SHALL 保留该 model profile 的其他字段以及 `reasoning` 对象中的未知字段
- **THEN** 系统 SHALL 关闭 `/effort` command session 并清空 composer
- **THEN** 系统 SHALL NOT 追加 transcript record

#### Scenario: /effort 取消选择不持久化
- **WHEN** `/effort` command session 处于活跃状态，且用户按下 Esc
- **THEN** 系统 SHALL 关闭 `/effort` command session 并清空 composer
- **THEN** 系统 SHALL 保持 `~/.echo/config.json` 不变

#### Scenario: /effort 持久化失败显示安全错误
- **WHEN** `/effort` 确认选择时无法写入用户级配置文件
- **THEN** 系统 SHALL 保持 `/effort` command session 可见或打开安全错误 surface
- **THEN** 该 surface SHALL 展示可操作的安全错误摘要
- **THEN** 错误内容 SHALL NOT 包含敏感字段值

#### Scenario: /effort 显示安全配置错误
- **WHEN** 用户提交纯 `/effort` 但当前模型配置缺失、无效或无法读取
- **THEN** 系统 SHALL 打开安全的 command surface 展示可操作错误摘要
- **THEN** 错误内容 SHALL NOT 包含敏感字段值

#### Scenario: response 进行中阻止 /effort
- **WHEN** assistant 正在 thinking 或 streaming，且用户提交纯 `/effort`
- **THEN** 系统 SHALL NOT 进入 `/effort` command session
- **THEN** 系统 SHALL NOT 修改真实 LLM adapter 的 reasoning effort 配置

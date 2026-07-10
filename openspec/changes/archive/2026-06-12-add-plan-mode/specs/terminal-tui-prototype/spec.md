## ADDED Requirements

### Requirement: plan mode 本地命令
系统 SHALL 支持一个本地 slash plan mode 命令：当用户提交 `/plan`、`/plan on` 或 `/plan off` 时，应用 SHALL 切换当前进程内 interaction mode，而不是提交给 agent。plan mode SHALL 不写入 transcript、不进入输入历史、不持久化到配置文件、不启动 assistant lifecycle。

#### Scenario: /plan toggle 开关 plan mode
- **WHEN** assistant 不处于 thinking 或 streaming，且用户提交内容精确等于 `/plan`
- **THEN** 系统 SHALL 由本地 slash command runtime 处理该输入
- **THEN** 当前为 normal mode 时系统 SHALL 切换到 plan mode
- **THEN** 当前为 plan mode 时系统 SHALL 切换到 normal mode
- **THEN** 系统 SHALL NOT 追加 transcript record 或启动 agent

#### Scenario: /plan on 显式进入 plan mode
- **WHEN** assistant 不处于 thinking 或 streaming，且用户提交内容精确等于 `/plan on`
- **THEN** 系统 SHALL 切换到 plan mode
- **THEN** 多次提交 `/plan on` SHALL 保持 plan mode
- **THEN** 系统 SHALL NOT 写入配置文件或 transcript

#### Scenario: /plan off 显式退出 plan mode
- **WHEN** assistant 不处于 thinking 或 streaming，且用户提交内容精确等于 `/plan off`
- **THEN** 系统 SHALL 切换到 normal mode
- **THEN** 多次提交 `/plan off` SHALL 保持 normal mode
- **THEN** 系统 SHALL NOT 写入配置文件或 transcript

#### Scenario: 非法 /plan 子命令显示用法
- **WHEN** assistant 不处于 thinking 或 streaming，且用户提交内容以 `/plan` 开头但不是 `/plan`、`/plan on` 或 `/plan off`
- **THEN** 系统 SHALL 打开可关闭的本地 info command surface 展示 `/plan` 用法
- **THEN** 系统 SHALL NOT 将该输入作为普通 user message 提交
- **THEN** 系统 SHALL NOT 启动 agent

#### Scenario: response 进行中阻止 /plan
- **WHEN** assistant 正在 thinking 或 streaming，且用户提交 `/plan`、`/plan on` 或 `/plan off`
- **THEN** 系统 SHALL NOT 切换 interaction mode
- **THEN** 系统 SHALL NOT 进入 `/plan` command session
- **THEN** 系统 SHALL NOT 启动新的 agent turn

### Requirement: plan mode 只读 agent 边界
系统 SHALL 在 plan mode 下运行 assistant turn 时为 provider 注入 plan-mode system prompt，并只向 provider 暴露只读工具。plan mode SHALL 允许模型使用只读工具进行代码和资料探索，但 SHALL 禁止模型获得会修改文件、执行命令、安装依赖、提交代码或改变系统状态的工具。

#### Scenario: plan mode 注入 system prompt
- **WHEN** 当前 interaction mode 为 plan，且用户提交普通消息启动 assistant turn
- **THEN** provider input SHALL 包含 plan-mode system prompt
- **THEN** 该 system prompt SHALL 告知模型当前处于只读探索和规划阶段
- **THEN** 该 system prompt SHALL 告知模型不能修改文件、应用 patch、提交 commit、安装依赖、运行变更系统状态的命令或执行计划
- **THEN** 该 system prompt SHALL 告知模型如果用户要求执行计划，应提示用户使用 `/plan off` 退出 plan mode
- **THEN** 该 system prompt SHALL NOT 写入 app transcript 或持久化 session records

#### Scenario: plan mode 只暴露只读工具
- **WHEN** 当前 interaction mode 为 plan，且 agent runtime 初始化 provider tools
- **THEN** provider SHALL 只收到 `glob`、`grep`、`read_files`、`web_fetch`、`web_search` 和 `use_skill` 工具定义
- **THEN** provider SHALL NOT 收到 `run_bash_command`、`apply_patch` 或 `ask_user_questions` 工具定义

#### Scenario: normal mode 保持完整工具能力
- **WHEN** 当前 interaction mode 为 normal，且 agent runtime 初始化 provider tools
- **THEN** provider SHALL 收到普通模式既有工具定义
- **THEN** 普通模式 SHALL 保持既有 tool approval、tool result 和 continuation 行为

#### Scenario: plan mode 不执行写入工具
- **WHEN** 当前 interaction mode 为 plan，且 provider 返回未暴露的写入或执行类 tool call
- **THEN** 系统 SHALL NOT 执行该 tool call
- **THEN** 系统 SHALL 以安全失败结果或本地错误方式继续，不产生文件修改、命令执行或配置写入

## MODIFIED Requirements

### Requirement: footer status line
系统 SHALL 在普通 composer footer 中使用 status line 替代静态 hint。status line SHALL 展示当前项目名、当前选择的模型、当前运行模式和当前上下文中不容易自然发现的操作提示；当前选择的模型 SHALL 作为最靠前的信息显示并使用区别于普通状态文本的强调颜色；当当前模型 profile 配置了 reasoning effort 时，status line SHALL 在模型信息中展示该推理等级；当当前 interaction mode 为 plan 且没有更高优先级 pending 状态时，status line SHALL 显示 `plan` 或等价 plan mode 状态，并 SHALL 遵循现有终端宽度和 footer 局部重绘约束。

#### Scenario: 普通输入显示 idle status line
- **WHEN** 普通 composer 可见且没有 slash suggestion、pending preview、command surface 或 plan mode
- **THEN** footer SHALL 在 composer 下方显示 status line
- **THEN** status line SHALL 优先显示当前选择的模型名称或等价模型标识
- **THEN** status line SHALL 使用区别于普通状态文本的强调颜色显示当前模型信息
- **THEN** status line SHALL 显示当前项目名
- **THEN** status line SHALL 显示 `idle` 或等价普通输入状态
- **THEN** status line SHALL 显示换行和命令入口等非显而易见操作提示
- **THEN** status line SHALL NOT 显示 Enter 发送这类基础输入提示

#### Scenario: plan mode 显示 plan status line
- **WHEN** 普通 composer 可见且当前 interaction mode 为 plan，且没有 slash suggestion、pending preview 或 command surface
- **THEN** footer SHALL 在 composer 下方显示 status line
- **THEN** status line SHALL 显示 `plan` 或等价 plan mode 状态
- **THEN** status line SHALL NOT 显示 `/plan off` 或等价退出提示

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

#### Scenario: 已配置推理等级时 status line 显示 effort
- **WHEN** 当前 selected model profile 配置了有效的 `reasoning.effort`
- **THEN** 普通 composer status line SHALL 在模型信息中显示该推理等级
- **THEN** 显示文本 SHALL 能让用户区分当前模型和当前推理等级

#### Scenario: 未配置推理等级时 status line 不显示 effort
- **WHEN** 当前 selected model profile 没有配置 `reasoning.effort`
- **THEN** 普通 composer status line SHALL NOT 推断或显示服务端默认推理等级

#### Scenario: 推理等级变化后 status line 更新 effort 信息
- **WHEN** 用户通过 `/effort` 修改当前模型 profile 的推理等级
- **THEN** 后续普通 composer status line SHALL 显示新推理等级
- **THEN** status line SHALL NOT 显示旧推理等级

#### Scenario: command surfaces 保留自身提示
- **WHEN** footer 当前显示 info、select、scale、resume、confirm 或 choice command surface
- **THEN** 该 surface SHALL 继续使用自身的 `dismissHint` 或等价 surface 内提示
- **THEN** 全局 composer status line SHALL NOT 覆盖该 surface 的交互提示

#### Scenario: status line 遵循安全宽度
- **WHEN** terminal width 变窄或 status line 文本超过当前安全宽度
- **THEN** status line SHALL 被裁剪到 safe render width 内
- **THEN** status line SHALL NOT 因写满终端最后一列而触发额外自动换行

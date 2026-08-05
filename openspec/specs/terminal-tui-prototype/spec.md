# terminal-tui-prototype Specification

## Purpose
定义 `echo_tui` 终端 TUI 原型的外部行为，包括当前终端运行、append-only transcript、destructive resize recovery、composer 输入编辑、slash 命令、transcript 持久化和真实 assistant 响应流程的验证要求。
## Requirements
### Requirement: MCP 启动初始化 UI
系统 SHALL 在 TUI 启动后展示 MCP 初始化状态。初始化期间普通 composer 可见，用户 MAY 编辑输入内容，但系统 SHALL 阻止提交问答、启动 slash command 和切换 interaction mode，直到 MCP 初始化完成。

#### Scenario: 显示 MCP 初始化状态
- **WHEN** TUI 启动后正在初始化 MCP servers
- **THEN** footer 或等价临时 UI SHALL 显示 MCP initializing 状态
- **THEN** UI SHALL 表达当前正在准备外部工具能力

#### Scenario: 初始化期间可编辑但不可提交
- **WHEN** MCP initializing 状态仍在进行
- **AND** 用户输入普通字符或编辑 composer
- **THEN** composer SHALL 正常更新
- **WHEN** 用户按 Enter 提交
- **THEN** 系统 SHALL NOT 追加 transcript record 或启动 agent request

#### Scenario: 初始化完成后恢复普通输入
- **WHEN** MCP 初始化完成
- **THEN** footer SHALL 回到普通 composer/status line 或显示可关闭的 MCP 诊断 surface
- **THEN** 用户 SHALL 能提交初始化期间已输入的 composer 内容

#### Scenario: MCP 失败诊断不污染 transcript
- **WHEN** MCP 初始化完成且存在失败 server
- **THEN** TUI SHALL 展示包含失败 server 名称和脱敏错误摘要的 transient 诊断
- **THEN** 该诊断 SHALL NOT 作为 transcript block 出现在历史区域
- **THEN** 该诊断 SHALL 可关闭并回到普通 composer footer

### Requirement: MCP 初始化状态不复用 assistant response lock
系统 SHALL 使用独立的 app readiness 或 MCP bootstrap 状态表示启动初始化。该状态 SHALL NOT 伪装成 assistant thinking、streaming、working 或 shell command 状态，也 SHALL NOT 触发 assistant interruption、partial assistant persistence 或 shell interruption 语义。

#### Scenario: Esc 不作为 assistant interrupt 处理 MCP 初始化
- **WHEN** MCP initializing 状态仍在进行且没有 active assistant turn
- **AND** 用户按下 Esc
- **THEN** 系统 SHALL NOT 追加 assistant partial record
- **THEN** 系统 SHALL NOT 追加本地 assistant interruption notice

#### Scenario: 初始化状态不改变 transcript
- **WHEN** MCP initializing 状态开始、更新或完成
- **THEN** 系统 SHALL NOT 因状态变化追加 user、assistant、tool、shell 或 error transcript record

### Requirement: Node CommonJS 项目
系统 SHALL 提供一个名为 `echo_tui` 的可运行 Node.js 项目，使用 Node.js >= 20。运行源码 SHALL 使用 TypeScript；测试 MAY 保留 JavaScript；运行产物 SHALL 由 TypeScript 编译管线输出为 CommonJS JavaScript。项目 SHALL 不引入运行时第三方 TUI 库依赖。

#### Scenario: start 命令运行编译产物
- **WHEN** 开发者运行 `npm start`
- **THEN** 项目 SHALL 先确保 TypeScript 编译产物可用
- **THEN** 项目 SHALL 执行编译输出中的 TUI 入口文件

#### Scenario: CommonJS 运行产物
- **WHEN** JavaScript 产物被 Node.js 加载
- **THEN** 产物 SHALL 使用 CommonJS 模块语义运行
- **THEN** 项目 SHALL NOT 要求 Node.js 通过 ESM loader、ts-node、tsx 或 bundler runtime 加载源码

#### Scenario: 不需要第三方 TUI 依赖
- **WHEN** 项目被安装并运行
- **THEN** 终端 UI 行为 SHALL 使用 Node.js 内建能力、ANSI 控制序列和 stdin raw mode 实现，而不是依赖 TUI framework

#### Scenario: test 命令运行编译后的测试
- **WHEN** 开发者运行 `npm test`
- **THEN** 项目 SHALL 先通过 TypeScript 编译生成测试产物
- **THEN** 项目 SHALL 使用 Node.js 内置 test runner 运行编译后的测试文件

### Requirement: 当前终端执行
系统 SHALL 在当前终端中运行，不切换到 alternate screen。系统在启动时仍应追加到已有终端内容之后，但在列宽变化或行数压缩的 destructive recovery 中 MAY 清可见屏幕和 scrollback。

#### Scenario: 应用启动在已有输出之后
- **WHEN** 应用启动
- **THEN** 应用 SHALL 在已有 terminal scrollback 之后追加 banner 和 UI，而不是清空屏幕

#### Scenario: 不使用 alternate screen
- **WHEN** 应用运行
- **THEN** 应用 SHALL NOT 输出进入或离开 alternate screen 的 ANSI 序列

#### Scenario: 列宽变化时允许清 screen 和 scrollback
- **WHEN** terminal columns 变化触发 destructive recovery
- **THEN** 应用 MAY 清当前 visible screen 和 scrollback，以保证后续完整重绘的布局稳定性

#### Scenario: 行数压缩时允许清 screen 和 scrollback
- **WHEN** terminal rows 变小触发 destructive recovery
- **THEN** 应用 MAY 清当前 visible screen 和 scrollback，以避免旧 footer 或 pending preview 残留在 scrollback

### Requirement: 启动 banner
系统 SHALL 在 TUI 启动时显示启动 banner。

#### Scenario: 启动时显示 banner
- **WHEN** 应用进入交互模式
- **THEN** 应用 SHALL 在 footer 绘制前，把可见的 `echo_tui` banner 追加到 transcript 区域

### Requirement: transcript 内容记录与重绘快照分离
系统 SHALL 将 transcript 的内容记录与 ANSI 渲染结果分离：已提交消息内容只追加记录，渲染层可以根据当前终端尺寸重新生成当前 app snapshot 的可见输出。

#### Scenario: 用户提交只追加内容记录
- **WHEN** 用户使用 Enter 提交 composer 内容
- **THEN** 应用 SHALL 追加一个 user transcript record，并且不修改更早的 transcript record 内容

#### Scenario: assistant 完成只追加内容记录
- **WHEN** assistant response 完成流式输出
- **THEN** 应用 SHALL 追加一个 assistant transcript record，内容为完成后的 assistant 输出

#### Scenario: resize 从当前状态重建快照
- **WHEN** 终端宽度变化
- **THEN** 应用 SHALL 基于已有 transcript records、当前 terminal size 和 footer state 重新生成当前 app snapshot 的渲染输出

### Requirement: destructive resize recovery
系统 SHALL 在终端列宽变化或终端行数压缩时允许 destructive recovery：清可见屏幕、清 scrollback、回到左上角，并从当前状态完整重绘 app snapshot。

#### Scenario: 列宽变化时触发 destructive recovery
- **WHEN** 最新 terminal columns 不等于上一次 render 时记录的 columns
- **THEN** 应用 SHALL 进入 destructive recovery，而不是继续依赖旧输出物理行数估算来局部擦除

#### Scenario: 行数压缩时触发 destructive recovery
- **WHEN** 最新 terminal rows 小于上一次 render 时记录的 rows
- **THEN** 应用 SHALL 进入 destructive recovery，而不是继续依赖 footer 局部擦除

#### Scenario: 仅行数增大时不触发 destructive recovery
- **WHEN** terminal columns 未变化
- **AND** 最新 terminal rows 大于上一次 render 时记录的 rows
- **THEN** 应用 SHALL NOT 仅因为 rows 增大而执行 destructive recovery
- **THEN** 应用 SHALL 记录新的 terminal rows 供后续 resize 判断使用

#### Scenario: destructive recovery 清 screen 与 scrollback
- **WHEN** terminal columns 发生变化或 terminal rows 变小并触发 destructive recovery
- **THEN** 应用 SHALL 重置滚动区域与文本样式，清可见屏幕，清 scrollback，并把光标移动到左上角后再开始重绘

#### Scenario: destructive recovery 重绘完整快照
- **WHEN** terminal columns 发生变化或 terminal rows 变小并触发 destructive recovery
- **THEN** 新的可见屏幕 SHALL 包含 banner、transcript projection、pending preview、transcript/composer spacer、composer 和 status line 的完整当前快照

#### Scenario: destructive recovery 后光标回到 composer 逻辑位置
- **WHEN** 用户在输入、thinking 或 streaming 期间触发 terminal columns 变化
- **THEN** destructive recovery 完成后可见光标 SHALL 回到 composer 当前逻辑光标位置

### Requirement: 终端 resize 渲染稳定性
系统 SHALL 在终端尺寸变化后保持布局稳定，并按当前宽度重新计算 transcript、pending preview、transcript/composer spacer、composer 和 status line。

#### Scenario: resize 后 spacer 保持单行
- **WHEN** 终端宽度变窄或变宽并触发重绘
- **THEN** transcript/composer spacer SHALL 按当前终端宽度重新计算并保持 1 行语义空白，不得因为写满最后一列产生额外行

#### Scenario: resize 后清理旧高度
- **WHEN** resize 前后的 transcript projection、pending preview、transcript/composer spacer、composer 或 status line 总行数不同
- **THEN** renderer SHALL 选择合适的重绘方式：普通 redraw 或 destructive recovery，并保证新的可见布局正确

#### Scenario: 列宽变化后不残留旧输出
- **WHEN** 长消息或宽背景行在列宽变化后被终端重新折成不同的物理行数
- **THEN** destructive recovery 后的当前 screen SHALL NOT 残留重复 banner、重复 transcript、旧宽度灰底或重复输入区边界

#### Scenario: resize 后光标回到 composer 逻辑位置
- **WHEN** 用户在输入中 resize 终端
- **THEN** 重绘后可见光标 SHALL 回到 composer 当前逻辑光标位置

#### Scenario: streaming 中 resize 保持 pending 布局
- **WHEN** assistant thinking 或 streaming 期间发生 resize
- **THEN** pending preview、transcript/composer spacer、composer 和 status line SHALL 按新宽度整体重绘，并保持相对顺序不变

### Requirement: footer status line
系统 SHALL 在普通 composer footer 中使用 segmented status line 展示当前运行状态。status line SHALL 优先展示当前选择的模型、当前模型 profile 显式配置的 reasoning effort、当前目录、真实 context usage 和当前运行模式；当前选择的模型 SHALL 作为最靠前的信息显示并使用区别于普通状态文本的强调颜色。reasoning effort SHALL 作为独立 segment 展示，而不是拼接进模型名称或添加圆点前缀。status line SHALL 暂不显示 git branch。当当前 interaction mode 为 plan 且没有更高优先级 pending 状态时，status line SHALL 显示 `plan` 或等价 plan mode 状态，并 SHALL 遵循现有终端宽度和 footer 局部重绘约束。普通 composer footer、slash suggestion 和 command surfaces SHALL 遵循共享 footer UI 语言：使用统一 cyan palette、`▌` 焦点条、`●/○` 状态 marker 和中文为主的默认操作提示。

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

### Requirement: Plan mode supports readonly workspace inspection
系统 SHALL 在 plan mode 中允许模型使用只读工具和受限 readonly bash inspection 来理解代码库、工作区状态和未提交变更，同时继续禁止执行实现、修改文件或运行可能产生副作用的命令。

#### Scenario: Agent can inspect git state in plan mode
- **WHEN** 用户在 plan mode 中要求模型 review 代码变更或制定实现计划
- **THEN** 模型 SHALL 可以通过 plan mode 可用工具读取文件、搜索代码并执行允许的 readonly bash inspection 命令
- **AND** 允许的 bash inspection SHALL 包括常见 git 状态和差异查询，例如 `git status`、`git diff`、`git log`、`git show`、`git rev-parse`、`git branch --show-current`、`git ls-files` 和 `git merge-base`

#### Scenario: Plan mode still forbids execution and mutation
- **WHEN** 用户或模型尝试在 plan mode 中运行会修改工作区、修改 `.git` 状态、安装依赖、运行测试、运行构建、提交代码或执行实现计划的命令
- **THEN** 系统 SHALL 阻止该命令执行
- **AND** 系统 SHALL 告知需要先退出 plan mode 才能执行该操作

#### Scenario: Plan mode guidance mentions readonly bash boundary
- **WHEN** 系统为 plan mode 构建 provider system prompt
- **THEN** system prompt SHALL 说明当前可使用只读工具和受限 readonly bash inspection
- **AND** system prompt SHALL 明确禁止运行测试、构建、安装、提交、切换分支、重置状态或其他可能产生副作用的命令
- **AND** system prompt SHALL 指引用户通过 `/mode normal` 退出 plan mode

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
- **THEN** status line SHALL 优先保留左侧模型、effort 和目录信息，右侧动态状态 MAY 被整体省略或裁剪

### Requirement: Status line 使用缓存模型展示状态
普通 composer status line SHALL 使用应用内缓存的模型展示状态显示当前 selected model 和当前模型 profile 显式配置的 reasoning effort。该缓存 SHALL 在应用内模型配置写入成功后更新；系统 SHALL NOT 承诺在外部进程或用户手动编辑 `~/.echo/config.json` 后实时更新当前 status line。

#### Scenario: 响应期间 status line 保持缓存展示
- **WHEN** assistant 响应期间 spinner 或 streaming preview 高频重绘普通 composer footer
- **THEN** status line SHALL 继续显示缓存中的当前模型 label 和 reasoning effort
- **THEN** 高频重绘 SHALL NOT 为了刷新该展示而重新读取用户级配置文件

#### Scenario: 应用内模型选择后 status line 更新
- **WHEN** 用户通过 `/model` 成功切换当前模型 profile
- **THEN** 后续普通 composer status line SHALL 显示新模型 profile 的模型 label
- **THEN** status line SHALL NOT 继续显示旧 selected model 的 label

#### Scenario: 应用内推理等级修改后 status line 更新
- **WHEN** 用户通过 `/effort` 成功修改当前模型 profile 的 reasoning effort
- **THEN** 后续普通 composer status line SHALL 显示新的 reasoning effort
- **THEN** status line SHALL NOT 继续显示旧 reasoning effort

#### Scenario: /config 保存后 status line 更新
- **WHEN** 用户通过 `/config` 成功保存包含 selected model 或 reasoning 配置变化的草稿
- **THEN** 后续普通 composer status line SHALL 基于保存后的模型配置展示模型 label 和 reasoning effort

#### Scenario: 外部编辑不实时刷新 status line
- **WHEN** Echo TUI 进程运行期间，外部编辑器或其他进程修改 `~/.echo/config.json`
- **THEN** 当前普通 composer status line MAY 继续显示应用内缓存的模型 label 和 reasoning effort
- **THEN** 系统 SHALL NOT 为了侦测该外部编辑而在普通 footer redraw 路径读取用户级配置文件

### Requirement: status line 显示真实 context usage
普通输入态 status line SHALL 在存在真实 provider context usage 时显示最近一次 provider request 的 input token usage 和当前模型 context window。该显示 SHALL 作为 segmented status line 的 context segment 呈现，并 SHALL 使用短文本片段；该 usage 的语义仍为最近一次真实 provider usage，而不是本地实时估算。系统 SHALL 保留该 usage 的详细 breakdown 供 `/context` 命令展示，但 status line SHALL 继续只显示短文本总览。

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

### Requirement: destructive recovery 后的屏幕快照自洽
系统 SHALL 在 destructive recovery 后呈现一份自洽的当前屏幕快照，而不是只重绘 footer 或局部区域。

#### Scenario: destructive recovery 后当前屏幕包含 banner
- **WHEN** destructive recovery 完成
- **THEN** 当前屏幕中的 app snapshot SHALL 包含启动 banner 提供的 session 上下文

### Requirement: append-only transcript
系统 SHALL 把已提交的用户消息、已完成的 assistant 消息、本地 error 消息和本地中断提示消息作为 append-only transcript content records 处理，同时允许渲染层重算这些 records 在当前 app snapshot 中的可见投影。

#### Scenario: 用户提交追加 transcript record
- **WHEN** 用户使用 Enter 提交 composer 内容
- **THEN** 应用 SHALL 向 transcript records 追加一个用户消息记录，并且不修改更早的 transcript record 内容

#### Scenario: assistant 完成后追加 transcript record
- **WHEN** assistant response 完成流式输出
- **THEN** 应用 SHALL 追加一个 assistant 消息记录，内容为完成后的 assistant 输出

#### Scenario: 本地错误追加 transcript record
- **WHEN** assistant response 失败且需要展示本地错误反馈
- **THEN** 应用 SHALL 追加一个 `error` transcript record，内容为脱敏后的本地错误反馈
- **THEN** 应用 SHALL NOT 把该错误反馈伪装成 assistant 回复

#### Scenario: 本地中断提示追加 transcript record
- **WHEN** 用户主动中断 assistant response 且需要展示本地中断反馈
- **THEN** 应用 SHALL 追加一个本地中断提示 transcript record
- **THEN** 应用 SHALL NOT 把该中断提示伪装成 assistant 回复或本地 error 反馈

#### Scenario: 历史 transcript 内容不被修改
- **WHEN** footer 在输入、streaming 或 resize 期间重绘
- **THEN** 已提交的 transcript record 内容 SHALL 保持不变，但其在当前 app snapshot 中的可见渲染 SHALL 可以按当前宽度重新计算

#### Scenario: destructive recovery 不改变消息事实内容
- **WHEN** terminal columns 变化触发 destructive recovery
- **THEN** 应用 MAY 清 screen 和 scrollback 并重绘消息，但 SHALL NOT 改写已提交 transcript record 的事实内容

### Requirement: agent 多轮 transcript 上下文
系统 SHALL 在普通用户消息提交时，把当前 transcript records 作为 agent 输入，使模型能够看到当前会话中已经提交并完成的上下文。当前 transcript SHALL 是本地会话事实源；app 层 SHALL NOT 额外维护一份同构 agent message history。

#### Scenario: 第二轮普通消息携带历史上下文
- **WHEN** 当前 transcript records 已包含一轮 user / assistant 对话，且用户提交第二轮普通消息
- **THEN** 系统 SHALL 先把第二轮 user record 追加到当前 transcript
- **THEN** 系统 SHALL 使用包含第一轮 user、第一轮 assistant 和第二轮 user 的 transcript records 调用 agent
- **THEN** 系统 SHALL NOT 只把第二轮用户文本传给 agent

#### Scenario: resume 后继续对话携带恢复上下文
- **WHEN** 用户通过 `/resume` 恢复某个 session 后继续提交普通消息
- **THEN** 系统 SHALL 使用恢复出的 transcript records 加上本轮 user record 调用 agent
- **THEN** 系统 SHALL NOT 为恢复动作本身追加额外 prompt record

#### Scenario: clear 后上下文断开
- **WHEN** 用户通过 `/clear` 确认清空 transcript 后提交新的普通消息
- **THEN** 系统 SHALL 使用清空后的当前 transcript records 调用 agent
- **THEN** 系统 SHALL NOT 把 `/clear` 前旧 session 的 records 传给 agent

### Requirement: transcript error role
系统 SHALL 支持 `error` transcript role 表示本地错误反馈。`error` record SHALL 作为 transcript 的可见、可持久化记录参与 session 恢复，但 SHALL NOT 被视为 assistant 回复发送给 agent。

#### Scenario: agent 失败追加 error record
- **WHEN** agent 在 thinking 或 streaming 期间失败
- **THEN** 系统 SHALL 清空 pending preview 并释放 response lock
- **THEN** 系统 SHALL 追加一条 `role: 'error'` 的 transcript record 作为可见反馈
- **THEN** 该 record 文本 SHALL 不包含敏感配置值

#### Scenario: error record 可恢复可显示
- **WHEN** 包含 `error` record 的 session 被持久化并通过 `/resume` 恢复
- **THEN** 系统 SHALL 恢复该 `error` record
- **THEN** transcript 渲染 SHALL 为该 `error` record 提供可见投影

### Requirement: transcript local interruption notice role
系统 SHALL 支持本地中断提示 transcript role 表示用户主动中断 assistant response 的本地反馈。该 record SHALL 作为 transcript 的可见、可持久化记录参与 session 恢复，但 SHALL NOT 被视为 assistant 回复或 error 反馈发送给 agent。

#### Scenario: interruption notice record 可恢复可显示
- **WHEN** 包含本地中断提示 record 的 session 被持久化并通过 `/resume` 恢复
- **THEN** 系统 SHALL 恢复该本地中断提示 record
- **THEN** transcript 渲染 SHALL 为该 record 提供区别于 user、assistant 和 error 的克制可见投影

#### Scenario: resize 后重新投影中断提示
- **WHEN** 当前 transcript records 包含本地中断提示 record，且 terminal columns 变化触发 app snapshot 重绘
- **THEN** 中断提示 SHALL 按新的 terminal width 重新计算可见投影
- **THEN** 重绘 SHALL NOT 删除或隐藏该提示

### Requirement: tool transcript message rendering
系统 SHALL 支持 `tool_call` 与 `tool_result` transcript record 的 TUI 可见投影。工具消息 SHALL 作为 transcript content records 参与当前 app snapshot 重绘、destructive resize recovery 和 session 恢复后的显示。系统 SHALL 根据 tool metadata 生成工具专属展示：tool call SHALL 使用 assistant 风格调用行，tool result SHALL 使用区别于 assistant 的弱化结果行。未知工具或缺少 metadata 的历史记录 SHALL 使用安全 fallback 渲染。

#### Scenario: 显示 bash tool_call record
- **WHEN** transcript records 包含 `role: 'tool_call'` 且 `toolName` 为 `run_bash_command` 的记录
- **THEN** transcript 渲染 SHALL 为该记录生成可见消息块
- **THEN** 该消息块 SHALL 使用 assistant 调用前缀并显示 `Bash('...')` 形式的命令调用
- **THEN** 该消息块 SHALL NOT 显示原始 JSON arguments

#### Scenario: 显示 bash tool_result record
- **WHEN** transcript records 包含 `role: 'tool_result'` 且 `toolName` 为 `run_bash_command` 的记录
- **THEN** transcript 渲染 SHALL 为该记录生成可见消息块
- **THEN** 该消息块 SHALL 使用灰色弱化样式和 `⎿` 前缀显示命令输出或简洁状态
- **THEN** 该消息块 SHALL NOT 显示 `exit_code`、`duration_ms`、`timed_out` 或 `truncated` 等执行摘要行

#### Scenario: bash tool_result 无输出
- **WHEN** bash tool result 没有可显示的 stdout 或 stderr 内容
- **THEN** transcript 渲染 SHALL 显示简洁的无输出状态
- **THEN** 渲染 SHALL NOT 产生空白工具结果块

#### Scenario: tool_result 显示层截断
- **WHEN** tool result 的可见投影超过显示层上限
- **THEN** transcript 渲染 SHALL 截断可见输出并显示截断提示
- **THEN** 截断 SHALL 只影响 TUI 展示，不改变 transcript record 的事实内容

#### Scenario: 完整消息块之间保留空行
- **WHEN** transcript records 中存在相邻的两个完整可见消息块，例如连续 assistant 记录或 tool result 后的 assistant 记录
- **THEN** transcript 渲染 SHALL 在两个完整消息块的投影之间保留一个空行
- **THEN** 同一工具调用组内的 tool call 与紧随其后的 tool result SHALL NOT 被额外空行分隔
- **THEN** 该空行 SHALL 只影响 TUI 展示，不改变 transcript record 的事实内容

#### Scenario: resize 后重新投影工具消息
- **WHEN** 当前 transcript records 包含 `tool_call` 或 `tool_result` 记录，且 terminal columns 变化触发 app snapshot 重绘
- **THEN** 工具消息 SHALL 按新的 terminal width 重新计算可见投影
- **THEN** 重绘 SHALL NOT 删除或隐藏这些工具消息

#### Scenario: 恢复 session 后显示工具消息
- **WHEN** 包含 `tool_call` 或 `tool_result` 记录的 session 被持久化并通过 `/resume` 恢复
- **THEN** 系统 SHALL 恢复这些 transcript records
- **THEN** transcript 渲染 SHALL 为这些工具消息提供可见投影

#### Scenario: 未知工具使用通用 fallback
- **WHEN** TUI 渲染未知 `toolName` 或缺少 tool metadata 的 `tool_call` / `tool_result` 记录
- **THEN** 系统 SHALL 使用通用工具消息 fallback 渲染该记录
- **THEN** 系统 SHALL NOT 因未知工具展示方式中断 app snapshot 渲染

#### Scenario: 工具消息不代表工具执行能力
- **WHEN** TUI 渲染 `tool_call` 或 `tool_result` 记录
- **THEN** 系统 SHALL NOT 因此要求已实现新的真实工具调用、工具执行或 tool result 回传模型

### Requirement: tool call transcript lifecycle
系统 SHALL 在真实 tool call 期间把工具调用和工具结果追加为 append-only transcript records。`tool_call` record SHALL 表示模型请求执行的工具，`tool_result` record SHALL 表示本地工具执行结果。工具 records SHALL 被持久化、参与 `/resume` 恢复，并 SHALL 在同一 response lock 内显示。

#### Scenario: 追加 tool_call record
- **WHEN** agent adapter 解析出模型请求执行本地工具
- **THEN** app SHALL 追加一条 `role: 'tool_call'` 的 transcript record
- **THEN** 该 record SHALL 包含可见文本、tool call id、tool name 和 arguments 信息
- **THEN** 该 record SHALL 立即通过现有 transcript append 渲染路径显示

#### Scenario: 追加 tool_result record
- **WHEN** 本地工具执行完成
- **THEN** app SHALL 追加一条 `role: 'tool_result'` 的 transcript record
- **THEN** 该 record SHALL 包含可见结果文本、tool call id、tool name、ok 状态和执行元信息
- **THEN** 该 record SHALL 立即通过现有 transcript append 渲染路径显示

#### Scenario: 工具调用期间保持 response lock
- **WHEN** agent 正在执行 tool call loop
- **THEN** app SHALL 保持 response lock，阻止用户提交第二个普通请求
- **THEN** tool_call 和 tool_result records SHALL 仍可追加到当前 transcript

#### Scenario: 工具 records 被持久化
- **WHEN** tool_call 或 tool_result record 被追加到当前 transcript
- **THEN** 系统 SHALL 在本轮可持久化时保存这些 records
- **THEN** session 恢复后 SHALL 保留这些 records 和其 tool metadata

#### Scenario: tool call 后继续 assistant 回复
- **WHEN** 工具结果已追加且模型基于结果生成最终回复
- **THEN** app SHALL 追加最终 assistant transcript record
- **THEN** 最终 assistant record SHALL NOT 覆盖或合并已追加的 tool_call / tool_result records

#### Scenario: tool loop 失败时释放 response lock
- **WHEN** tool call loop 因 provider 错误或系统性工具执行异常失败
- **THEN** app SHALL 追加本地 `error` transcript record
- **THEN** app SHALL 清空 pending preview 并释放 response lock

### Requirement: 工具授权 select 面板
系统 SHALL 在 `apply_patch` 工具执行前展示工具授权 select 面板。该面板 SHALL 作为 agent turn 内部 modal 出现，使用 select 选项表达用户决策；第一版 SHALL 至少提供 `Allow once` 和 `Deny` 两个选项。

#### Scenario: 显示 apply_patch 授权面板
- **WHEN** agent 请求执行 `apply_patch` 且需要用户授权
- **THEN** TUI SHALL 在 footer 区域显示工具授权 select 面板
- **THEN** 面板 SHALL 告知用户模型请求执行 `apply_patch`
- **THEN** 面板 SHALL 显示 `Allow once` 和 `Deny` 选项

#### Scenario: Enter 选择当前授权选项
- **WHEN** 工具授权 select 面板处于活跃状态
- **AND** 用户按下 Enter
- **THEN** 系统 SHALL 选择当前高亮的授权选项
- **THEN** 系统 SHALL 关闭工具授权面板并恢复 agent tool call 流程

#### Scenario: Esc 拒绝工具执行
- **WHEN** 工具授权 select 面板处于活跃状态
- **AND** 用户按下 Esc
- **THEN** 系统 SHALL 将本次授权请求视为拒绝执行
- **THEN** 系统 SHALL 关闭工具授权面板并恢复 agent tool call 流程

#### Scenario: 授权面板支持选择移动
- **WHEN** 工具授权 select 面板处于活跃状态
- **AND** 用户按下 Up 或 Down
- **THEN** 系统 SHALL 在授权选项之间移动当前选择
- **THEN** 系统 SHALL 重绘 footer 以反映新的高亮选项

#### Scenario: 工具授权 modal 优先消费输入
- **WHEN** 工具授权 select 面板处于活跃状态
- **THEN** 输入事件 SHALL 优先交给工具授权 modal 处理
- **THEN** 输入事件 SHALL NOT 被 slash command runtime、slash suggestion 或主 composer 编辑逻辑消费

#### Scenario: 工具授权期间保持 response lock
- **WHEN** 工具授权 select 面板处于活跃状态
- **THEN** 系统 SHALL 保持当前 assistant response lock
- **THEN** 用户 SHALL NOT 能提交第二个普通 user message

### Requirement: footer 布局
系统 SHALL 渲染底部 footer。footer 由可选 pending preview、transcript/composer spacer 和当前输入 surface 组成：普通输入态的 surface 为顶满 terminal safe render width 的 boxed composer、可选 slash 命令提示列表和固定 1 行 segmented status line；command surface 态的 surface 为覆盖在 composer 区域的命令内容和自身提示。assistant streaming pending preview SHALL 使用按 terminal rows 动态预算的 Markdown-aware 尾部预览，避免长输出时 footer 高度无限增长；当 draft 包含有效 table 时，该预览 SHALL 使用 table-aware projection。

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

### Requirement: composer 与用户消息的制表符布局一致性
系统 SHALL 在 composer 和用户消息的终端投影中，以同一制表位规则处理制表符，保证渲染结果的可见宽度与终端实际输出宽度一致。

#### Scenario: 含制表符内容在 footer 和 transcript 间流转
- **WHEN** 用户在 composer 中输入或粘贴包含制表符的文本并提交
- **THEN** composer 的边框、自动换行和光标定位 SHALL 不被制表符破坏
- **THEN** 提交后的用户消息前缀、背景和行尾填充 SHALL 不被制表符破坏

### Requirement: composer @ 文件选择器临时界面
系统 SHALL 将 `@` 文件选择器作为 composer 编辑态的 transient footer surface 接入现有 TUI 输入和渲染机制。该 surface SHALL 在 user question、tool approval 等更高优先级交互之后处理输入，并 SHALL 在 slash suggestion 和普通 composer 编辑之前处理输入。文件选择器 SHALL 支持目录级懒加载，使大目录下打开 `@` 时仍能显示直接子文件和子目录，而不是因为完整目录树扫描过大而显示空白。

#### Scenario: 文件选择器使用现有 footer 渲染机制
- **WHEN** `@` 文件选择器打开、更新或关闭
- **THEN** TUI SHALL 使用现有 footer 局部重绘机制渲染该 surface
- **THEN** TUI SHALL NOT 切换到 alternate screen
- **THEN** TUI SHALL NOT 引入第三方 TUI framework

#### Scenario: 大目录下打开文件选择器
- **WHEN** 用户在包含大量后代文件的 cwd 中输入 `@`
- **THEN** file picker surface SHALL 显示该 cwd 可读取的直接子文件和子目录
- **THEN** file picker surface SHALL NOT 因完整目录树扫描输出过大而显示为空白列表
- **THEN** footer SHALL 保持可重绘且不写入 transcript 历史区域

#### Scenario: 文件选择器输入优先级
- **WHEN** file picker surface 已打开
- **AND** 用户输入方向键、普通字符、Backspace、Space、Enter 或 Esc
- **THEN** file picker SHALL 优先于 slash suggestion 和普通 composer edit 消费这些事件
- **THEN** 事件 SHALL NOT 同时触发 mode 切换、历史浏览或普通提交

#### Scenario: 高优先级交互阻止文件选择器触发
- **WHEN** user question、tool approval、command session 或诊断 surface 已经处于 active 状态
- **AND** 用户输入 `@`
- **THEN** 已有 active surface SHALL 按其自身规则处理该输入
- **THEN** 系统 SHALL NOT 额外打开 file picker surface

#### Scenario: resize 后文件选择器保持可重绘
- **WHEN** file picker surface 可见且终端宽度变化
- **THEN** destructive recovery 或 footer redraw SHALL 基于当前 file picker 状态重新生成可见布局
- **THEN** 重绘后 SHALL 保留当前目录、query、焦点、preview 滚动位置和已选文件集合

### Requirement: transcript/composer 空行分隔
系统 SHALL 使用一行语义空行分隔 transcript 与 composer 输入区，而不是在 composer 上方渲染额外实线边界。该空行 SHALL 继续计入 footer 高度预算和光标定位计算。

#### Scenario: composer 使用自身边框完成视觉分隔
- **WHEN** footer 渲染 composer 输入区
- **THEN** transcript 与 composer 之间 SHALL 存在一行空白 spacer
- **THEN** composer 上方 SHALL NOT 渲染额外实线边界

### Requirement: footer 临时区域高度受限
系统 SHALL 在每次生成 footer layout 时遵守全局高度上限。当 terminal rows 已知时，footer layout 的总行数 SHALL 不超过 `rows - 2`，为屏幕顶部保留两行安全空间，避免 footer 内容进入 scrollback 后导致局部清理不完整。

#### Scenario: 长 footer 不超过终端高度预算
- **WHEN** render state 包含长 pending preview、transcript/composer spacer 和 command surface
- **AND** terminal rows 为 12
- **THEN** footer layout SHALL 最多包含 10 行
- **THEN** footer renderer 后续 SHALL 能通过局部 clear 清理上一帧 footer 可见内容

#### Scenario: 未知 rows 使用稳定默认预算
- **WHEN** render state 未提供 terminal rows
- **THEN** footer layout SHALL 使用稳定默认终端行数计算高度预算
- **THEN** footer layout SHALL 仍避免因无界 pending 或 command surface 生成无限高度

#### Scenario: 极小 rows 不产生非法布局
- **WHEN** terminal rows 小于或等于 2
- **THEN** footer layout SHALL 至少返回一个可渲染行或等价安全布局
- **THEN** cursor row SHALL 位于返回的 layout lines 范围内

### Requirement: composer 高度窗口化
普通 composer footer SHALL 设置独立最大可见高度，不能因为 terminal rows 足够大而占满 `rows - 2` 的全局 footer 预算。普通 composer footer 在输入超过自身最大高度或可用高度不足以显示完整输入时，只显示包含当前光标行的可见窗口。被挤出的 composer 行 SHALL 不显示省略提示；renderer SHALL 重新计算裁剪后的 cursor row 和 cursor column。

#### Scenario: 多行 composer 顶部被挤出
- **WHEN** composer 文本包含超过可用高度的多行内容
- **AND** 光标位于最后一行
- **THEN** footer SHALL 显示 composer 的尾部可见窗口
- **THEN** footer SHALL NOT 显示 `...` 或 `…` 表示被隐藏的 composer 行
- **THEN** footer layout SHALL 将 cursor row 指向可见窗口中的光标行

#### Scenario: 光标上移后保持光标附近可见
- **WHEN** composer 文本包含超过可用高度的多行内容
- **AND** 光标移动到中间某一行
- **THEN** footer SHALL 显示包含该光标行的 composer 窗口
- **THEN** footer layout SHALL 将 cursor row 和 cursor column 指向裁剪后的可见光标位置

#### Scenario: 大终端中 composer 仍受自身高度上限约束
- **WHEN** terminal rows 足够大且 composer 文本包含很多行
- **THEN** 普通 composer SHALL 最多显示自身高度上限内的行数
- **THEN** 普通 composer SHALL NOT 占满 `rows - 2` 的全部 footer 高度预算

### Requirement: pending preview 高度受限
所有 pending preview SHALL 接受 footer 剩余高度预算。streaming pending 和 tool call pending 都 SHALL 在预算内渲染，不得因长文本、长 bash command 或长 tool arguments 绕过 footer 全局高度限制。

#### Scenario: 长 streaming pending 受限
- **WHEN** assistant streaming pending 文本渲染后超过 footer 剩余预算
- **THEN** footer SHALL 只显示预算内的 streaming preview 行
- **THEN** footer SHALL 显示摘要或尾部内容以表达输出被裁剪

#### Scenario: 长 tool call pending 受限
- **WHEN** tool call pending 包含很长的 `run_bash_command` command 或很长的 arguments 文本
- **THEN** footer SHALL 只显示预算内的 tool call preview 行
- **THEN** footer layout 的总行数 SHALL 仍不超过 `rows - 2`

### Requirement: slash suggestion 高度窗口化
slash suggestion 列表 SHALL 在 footer 高度预算内渲染。当候选数量超过可见预算时，renderer SHALL 显示包含当前 selectedIndex 的候选窗口，而不是渲染全部候选。

#### Scenario: slash 候选过多时窗口化
- **WHEN** composer 输入 `/` 且 slash command 与 enabled skill 候选数量超过可见预算
- **THEN** footer SHALL 只显示候选窗口
- **THEN** 当前 selectedIndex 对应候选 SHALL 保持可见
- **THEN** footer SHALL 显示 `↑ N more`、`↓ N more` 或等价提示，告知用户窗口外仍有隐藏候选
- **THEN** footer layout 的总行数 SHALL 仍不超过 `rows - 2`

### Requirement: streaming pending preview 高度受限
系统 SHALL 在 assistant streaming 期间按当前 terminal rows 动态限制 pending preview 高度。长 draft 的 pending preview SHALL 先生成 Markdown-aware terminal projection，再给 transcript/composer spacer、composer/status line 或 command surface 以及安全边距预留空间后，折叠头部并显示尾部内容，避免 footer 高度随完整 draft 无限增长并进入 terminal scrollback。Markdown table SHALL 在同一 projection 阶段完成 table-aware layout，再参与高度预算。

#### Scenario: 短 streaming draft 正常显示
- **WHEN** assistant streaming draft 按当前终端宽度投影后的行数不超过 preview 高度限制
- **THEN** footer pending preview SHALL 显示完整 Markdown-aware projection
- **THEN** footer pending preview SHALL 保持 streaming 前缀样式

#### Scenario: 短 streaming table 正常显示
- **WHEN** assistant streaming draft 包含 table 且 table-aware projection 后的行数不超过 preview 高度限制
- **THEN** footer pending preview SHALL 显示完整 table-aware projection
- **THEN** footer pending preview SHALL 保持 streaming 前缀样式

#### Scenario: 长 streaming draft 折叠头部
- **WHEN** assistant streaming draft 按当前终端宽度投影后的行数超过 preview 高度限制
- **THEN** footer pending preview SHALL 显示一行折叠提示
- **THEN** footer pending preview SHALL 只显示最新尾部内容
- **THEN** footer pending preview 的总行数 SHALL 不超过根据当前 terminal rows 与 footer 输入区高度计算出的动态预算

#### Scenario: streaming preview 折叠不改变最终 transcript
- **WHEN** assistant streaming draft 在 pending preview 中被折叠显示
- **THEN** 系统 SHALL 继续在内存中保留完整 assistant draft
- **THEN** assistant 完成后追加的 assistant transcript record SHALL 包含完整 draft，而不是折叠后的 preview 文本

### Requirement: streaming token footer render 合并
系统 SHALL 在 assistant streaming 期间合并高频 `onToken` 引发的 footer render，以降低终端反复清理和重写 footer 的频率。系统 SHALL 保留每次 token 对完整 streaming draft 状态的更新，并 SHALL 在实际 render 时展示最新 draft。该合并 SHALL NOT 改变最终 assistant transcript、tool records、response lock、resize recovery 或 command surface 的语义。

#### Scenario: 首个 streaming token 及时显示
- **WHEN** assistant 从 thinking 进入 streaming 并收到本轮第一个 token
- **THEN** 系统 SHALL 更新完整 streaming draft 状态
- **THEN** footer SHALL 及时渲染该 streaming pending preview

#### Scenario: 高频 streaming token 合并 footer render
- **WHEN** assistant 在短时间窗口内连续收到多个 streaming token
- **THEN** 系统 SHALL 为每个 token 更新最新完整 streaming draft 状态
- **THEN** 系统 SHALL NOT 为窗口内每个 token 都立即执行一次 footer render
- **THEN** 窗口结束时 footer SHALL 渲染最新完整 streaming draft，而不是较旧的中间 draft

#### Scenario: 结构性事件取消待执行 token render
- **WHEN** 已存在尚未执行的 streaming token footer render
- **AND** assistant 随后进入 tool call、complete、error、interrupt、resize recovery 或 exit 等结构性状态变化
- **THEN** 系统 SHALL 取消尚未执行的 streaming token render
- **THEN** 结构性状态变化 SHALL 按原本即时渲染或 transcript append 路径更新可见 UI
- **THEN** 旧的延迟 token render SHALL NOT 在结构性状态变化之后覆盖新的 footer 状态

#### Scenario: 节流不改变最终 transcript
- **WHEN** assistant streaming 期间 token footer render 被合并
- **AND** assistant response 完成
- **THEN** 系统 SHALL 追加包含完整最终文本的 assistant transcript record
- **THEN** 追加内容 SHALL NOT 受中间 footer render 次数影响

### Requirement: footer 重绘和光标恢复
系统 SHALL 在重绘 footer 时隐藏光标，并在重绘结束后按当前输入 surface 恢复合适的光标状态：普通输入态恢复到 composer 逻辑位置并重新显示，command surface 态按 surface 需求决定是否显示光标。

#### Scenario: 光标仅在重绘期间隐藏
- **WHEN** footer renderer 执行重绘
- **THEN** 它 SHALL 在清理和绘制 footer 行之前输出 hide cursor

#### Scenario: 普通输入态回到 composer 编辑位置
- **WHEN** help overlay 未激活，且 composer 内容或光标状态发生变化
- **THEN** 可见终端光标 SHALL 在 footer 重绘后位于 composer 的逻辑光标位置
- **THEN** footer renderer SHALL 在定位完成后重新显示光标

#### Scenario: 不可编辑 command surface 活跃时保持光标隐藏
- **WHEN** info、select 或 confirm command surface 处于活跃状态并触发 footer 重绘
- **THEN** footer renderer SHALL NOT 在不可编辑 command surface 内容上显示可编辑光标

### Requirement: 普通交互只重绘 footer
系统 SHALL 在终端宽度不变的普通交互路径中只重绘 footer 区域。banner 和已提交 transcript 属于历史输出，不得在输入编辑、status line spinner 或 pending draft 更新时被再次追加到终端 scrollback。

#### Scenario: 输入编辑时不重放 banner 和 transcript
- **WHEN** 用户输入字符、删除字符或移动 composer 光标，且 terminal columns 与上一次渲染相同
- **THEN** 系统 SHALL 只重绘 footer 中的 pending、transcript/composer spacer、composer 和 status line
- **THEN** 系统 SHALL NOT 重新输出 banner 或任何已提交 transcript block

#### Scenario: spinner 或 pending 更新时不重放历史区域
- **WHEN** assistant 进入 status line thinking spinner，或 streaming draft 发生变化，且 terminal columns 与上一次渲染相同
- **THEN** 系统 SHALL 只更新 footer 中的 pending preview、composer 和 status line
- **THEN** 系统 SHALL NOT 把旧 banner、旧 transcript projection 或旧 footer 快照再次写入 scrollback

### Requirement: transcript 追加前清理临时 footer
系统 SHALL 在向终端追加新的 transcript block 之前先移除临时 footer，再在追加完成后恢复 footer，以保持 transcript append-only 和 footer 临时区的边界清晰。

#### Scenario: 用户提交时先清 footer 再追加用户消息
- **WHEN** 用户提交非空 composer 内容
- **THEN** 系统 SHALL 先移除当前 footer
- **THEN** 系统 SHALL 只向终端追加一个新的 user transcript block
- **THEN** 系统 SHALL 在该 block 之后重新绘制 footer

#### Scenario: assistant 完成时先清 footer 再追加正式回复
- **WHEN** assistant 完成 streaming 并提交最终回复
- **THEN** 系统 SHALL 先移除当前 footer
- **THEN** 系统 SHALL 只向终端追加一个新的 assistant transcript block
- **THEN** 系统 SHALL 在该 block 之后重新绘制 footer

### Requirement: destructive full replay 仅用于需要重建快照的场景
系统 SHALL 只在必须重建完整快照的场景中执行 banner、transcript 和 footer 的 full replay，例如 resize destructive recovery 或退出前最终静态输出。

#### Scenario: resize 时允许完整重放当前快照
- **WHEN** terminal columns 发生变化
- **THEN** 系统 SHALL 进入 destructive recovery，并基于 transcript records 和当前 footer state 重放完整快照

#### Scenario: 宽度不变时不得使用 full replay 处理普通编辑
- **WHEN** 普通输入、spinner 或 pending 更新发生，且 terminal columns 没有变化
- **THEN** 系统 SHALL NOT 走完整 app snapshot 的 clear + replay 路径

### Requirement: composer 字符级编辑
系统 SHALL 支持 printable input 的字符级 composer 编辑，包括中文字符，并且不使用 `string.length` 作为光标模型。系统同时 SHALL 支持多行 composer 下的垂直移动，以及 readline 风格的 `Ctrl+A`、`Ctrl+E`、`Ctrl+U`、`Ctrl+K`、`Ctrl+W` 快捷编辑。

#### Scenario: printable 字符插入到光标位置
- **WHEN** 用户输入 printable 字符
- **THEN** 字符 SHALL 被插入到当前 composer 光标位置

#### Scenario: 中文字符作为一个编辑单元
- **WHEN** 用户输入中文字符，或在中文字符之间移动光标
- **THEN** composer SHALL 把该中文字符视为一个光标移动和编辑单元

#### Scenario: Backspace 删除前一个字符
- **WHEN** 用户按下 Backspace，且光标前至少有一个字符
- **THEN** composer SHALL 删除光标前的那个字符

#### Scenario: Delete 删除后一个字符
- **WHEN** 用户按下 Delete，且光标后至少有一个字符
- **THEN** composer SHALL 删除光标后的那个字符

#### Scenario: 左右方向键在边界内移动
- **WHEN** 用户按下 Left 或 Right
- **THEN** composer 光标 SHALL 向左或向右移动一个字符，并且不会移出内容边界

#### Scenario: 上下方向键在多行内容中垂直移动
- **WHEN** composer 中已有内容，且用户按下 Up 或 Down
- **THEN** composer 光标 SHALL 在相邻逻辑行之间垂直移动，并尽量保持原有逻辑列
- **THEN** 如果目标逻辑行长度不足，光标 SHALL 停在该行末尾

#### Scenario: Home 和 End 移动到当前逻辑行边界
- **WHEN** 用户按下 Home 或 End
- **THEN** composer 光标 SHALL 移动到当前逻辑行的开头或结尾

#### Scenario: Ctrl+A 和 Ctrl+E 移动到当前逻辑行边界
- **WHEN** 用户按下 Ctrl+A 或 Ctrl+E
- **THEN** composer 光标 SHALL 分别移动到当前逻辑行的开头或结尾

#### Scenario: Ctrl+U 删除到当前逻辑行开头
- **WHEN** 用户按下 Ctrl+U
- **THEN** composer SHALL 删除从当前逻辑行开头到光标前的内容

#### Scenario: Ctrl+K 删除到当前逻辑行结尾
- **WHEN** 用户按下 Ctrl+K
- **THEN** composer SHALL 删除从光标位置到当前逻辑行结尾的内容

#### Scenario: Ctrl+W 删除前一个词
- **WHEN** 用户按下 Ctrl+W
- **THEN** composer SHALL 先跳过光标前的连续空白，再删除前一个连续非空白片段

#### Scenario: Ctrl+J 插入换行
- **WHEN** 用户按下 Ctrl+J
- **THEN** composer SHALL 在光标位置插入换行，而不是提交消息

### Requirement: session 输入历史浏览
系统 SHALL 支持当前进程内的 session 输入历史浏览，用于在空 composer 状态下回看此前成功提交的用户输入。

#### Scenario: 空 composer 时向上进入历史浏览
- **WHEN** composer 为空，assistant 不处于 thinking 或 streaming，且用户按下 Up
- **THEN** 系统 SHALL 将 composer 内容切换为当前 session 中最近一次成功提交的用户输入
- **THEN** 系统 SHALL 进入历史浏览状态，以便后续 Up/Down 继续在历史记录中导航

#### Scenario: 历史浏览中继续向上查看更早输入
- **WHEN** 系统已经处于历史浏览状态，且用户再次按下 Up
- **THEN** 系统 SHALL 将 composer 切换为更早的一条历史输入
- **THEN** 当已经位于最早历史输入时，继续按 Up SHALL 保持在该条输入，不得越界

#### Scenario: 历史浏览中向下返回更新输入或空 composer
- **WHEN** 系统已经处于历史浏览状态，且用户按下 Down
- **THEN** 系统 SHALL 切换到更晚的一条历史输入
- **THEN** 当用户从最新历史输入继续按 Down 时，composer SHALL 被清空，且系统 SHALL 退出历史浏览状态

#### Scenario: response 活跃期间不得进入历史浏览
- **WHEN** assistant 正在 thinking 或 streaming，且 composer 为空时用户按下 Up 或 Down
- **THEN** 系统 SHALL NOT 进入历史浏览状态

#### Scenario: 只有成功提交的输入会进入历史
- **WHEN** 用户成功提交非空 composer 内容
- **THEN** 该次提交的原始输入 SHALL 被追加到当前 session 的输入历史中

### Requirement: 提交和响应锁
系统 SHALL 使用 Enter 提交输入区内容，并在 assistant response 活跃期间禁止第二次提交。纯 `/help` 属于本地命令，不启动 assistant 生命周期；其他带额外文本的输入仍按普通 user message 处理。

#### Scenario: Enter 提交非空普通内容
- **WHEN** 用户在 composer 内容非空、没有 active assistant response，且提交内容不精确等于 `/help` 时按下 Enter
- **THEN** 应用 SHALL 追加用户消息块、清空 composer，并启动 mock assistant response

#### Scenario: 纯 /help 进入本地帮助 overlay
- **WHEN** 用户在没有 active assistant response 时提交内容精确等于 `/help`
- **THEN** 系统 SHALL 进入 help overlay 状态，而不是启动 mock assistant response

#### Scenario: 带后缀文本的 /help 仍作为普通消息提交
- **WHEN** 用户提交内容以 `/help` 开头但还带有其他字符
- **THEN** 系统 SHALL 将该内容视为普通 user message 提交，而不是进入 help overlay

#### Scenario: 空内容 Enter 不提交
- **WHEN** 用户在 composer 内容为空时按下 Enter
- **THEN** 应用 SHALL 保持 transcript 不变，并继续停留在输入模式

#### Scenario: response 进行中阻止新的提交与 slash 帮助
- **WHEN** assistant 正在 thinking 或 streaming
- **THEN** 按下 Enter SHALL NOT 启动另一个 assistant response
- **THEN** 提交纯 `/help` 也 SHALL NOT 进入 help overlay

### Requirement: response 活跃期间 Esc 中断交互
系统 SHALL 在普通 TUI 输入事件分发中识别 assistant response 活跃期间的 Esc。没有更高优先级交互 surface 时，Esc SHALL 中断当前 assistant response，而不是作为 no-op；中断过程 SHALL 使用现有 footer/transcript 渲染边界，避免重放 banner 或已提交历史区域。

#### Scenario: response 活跃时 Esc 不编辑 composer
- **WHEN** assistant response 正在 thinking 或 streaming
- **AND** 用户按下 Esc
- **THEN** 系统 SHALL 不修改 composer 文本或光标位置
- **THEN** 系统 SHALL 请求中断当前 assistant response

#### Scenario: 中断后 footer 回到普通输入态
- **WHEN** 用户按 Esc 中断当前 assistant response
- **THEN** footer SHALL 清空 pending preview
- **THEN** footer SHALL 恢复普通 composer 与 status line 输入界面
- **THEN** 用户 SHALL 能继续输入下一条消息

#### Scenario: 中断追加 transcript 前清理 footer
- **WHEN** 中断收尾需要追加 partial assistant 或本地中断提示 record
- **THEN** 系统 SHALL 先移除临时 footer
- **THEN** 系统 SHALL 追加对应 transcript block
- **THEN** 系统 SHALL 在追加完成后重绘 footer

#### Scenario: 高优先级 surface 消费 Esc
- **WHEN** tool approval、user question request 或 active command session 正在显示
- **AND** 用户按下 Esc
- **THEN** 输入事件 SHALL 交给该 active surface 的既有事件处理逻辑
- **THEN** 系统 SHALL NOT 直接因为该 Esc 中断整个 assistant response

### Requirement: slash handler 显式依赖注入
系统 SHALL 在 app 装配阶段创建默认 slash command handler 实例，并通过统一 `CommandHost` 向 handler 提供其实际需要的受控 app 能力。command runtime SHALL NOT 负责从 AppContext 聚合所有 handler 可能需要的业务上下文，也 SHALL NOT 通过业务 effect 间接解释 handler 的业务动作。

#### Scenario: 默认 handler 注册不携带业务子 context
- **WHEN** app 创建默认 slash command handlers
- **THEN** `/help`、`/clear`、`/compact`、`/model` 和 `/resume` handler SHALL 使用统一 command handler 协议
- **THEN** handler SHALL NOT 通过构造期接收完整业务子 context 来绕过 `CommandHost`

#### Scenario: runtime 不拼装全量业务上下文
- **WHEN** command runtime 启动已命中的 slash handler
- **THEN** runtime SHALL 调用 handler 的命令协议方法并传递 `CommandHost`
- **THEN** runtime SHALL NOT 为该调用拼装包含 `modelCommandInfo`、`resumeSessions`、composer 文本和输入历史等所有命令业务字段的统一上下文

#### Scenario: handler 通过 host 触达 app 能力
- **WHEN** slash handler 需要读取模型信息、列出可恢复 session、重置 composer、打开或关闭 command session、清空 transcript、加载 transcript session 或触发手动压缩
- **THEN** handler SHALL 通过 `CommandHost` 的受控领域方法完成这些动作
- **THEN** handler SHALL NOT 直接驱动 renderer、terminal 或绕过 command host 访问 app 内部状态

### Requirement: slash 命令运行时
系统 SHALL 通过统一的 slash 命令运行时处理本地 slash 命令。slash 路由器 SHALL 依次询问各个命令 handler 是否命中当前已提交文本；若没有任何 handler 命中，则输入 SHALL 按普通 user message 处理。slash command handler SHALL 通过 `CommandHost` 访问受控 app 能力，而不是由 command runtime 为所有 handler 统一生成 AppContext 业务上下文或解释业务 effect。

#### Scenario: handler 命中决定 slash 路由结果
- **WHEN** 用户提交一段输入文本，且某个 slash handler 判定该文本命中自身命令
- **THEN** 系统 SHALL 将该输入路由到该 handler，而不是按普通 user message 提交

#### Scenario: 未命中任何 handler 时回退为普通消息
- **WHEN** 用户提交一段输入文本，且没有任何 slash handler 判定命中
- **THEN** 系统 SHALL 将该输入按普通 user message 提交

#### Scenario: command runtime 只负责命令运行态
- **WHEN** slash 命令启动或活跃 command session 处理输入事件
- **THEN** command runtime SHALL 负责 slash 路由、active command session、事件分发和 command surface 快照
- **THEN** command runtime SHALL NOT 为具体 handler 收集 AppContext 中的命令业务数据
- **THEN** command runtime SHALL NOT 解释 transcript、model、compaction 等业务 effect

### Requirement: 本地 slash 命令与真实 adapter 隔离
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
- **WHEN** composer 内容为 `/m`
- **THEN** 系统 SHALL 只展示命令名以 `/m` 为前缀的可用 slash 命令
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

#### Scenario: /effort 显示 neon slider 面板
- **WHEN** 用户提交纯 `/effort` 且当前 `~/.echo/config.json` 中存在有效 selected model profile
- **THEN** 系统 SHALL 打开 `scale` command surface
- **THEN** 该 surface SHALL 使用圆角边框包裹内容
- **THEN** 该 surface SHALL 使用 cyan 风格标题并显示 live 状态
- **THEN** 该 surface SHALL 使用 `◂` / `▸` 作为轨道方向箭头
- **THEN** 该 surface SHALL 使用 `●` 表示非当前 effort 档位，使用 `◉` 表示当前 effort knob
- **THEN** 该 surface SHALL 对已选轨道和未选轨道使用明显明暗区分
- **THEN** 该 surface SHALL 在轨道下方显示大写缩写档位 `NONE`、`MIN`、`LOW`、`MED`、`HIGH`、`XHIGH` 并高亮当前项
- **THEN** 该 surface SHALL 在左下方显示当前真实 effort 值、进度 meter 和 active 状态
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

### Requirement: plan mode 只读 agent 边界
系统 SHALL 在 plan mode 下运行 assistant turn 时为 provider 注入 plan-mode system prompt，并只向 provider 暴露只读工具。plan mode SHALL 允许模型使用只读工具进行代码和资料探索，但 SHALL 禁止模型获得会修改文件、执行命令、安装依赖、提交代码或改变系统状态的工具。

#### Scenario: plan mode 注入 system prompt
- **WHEN** 当前 interaction mode 为 plan，且用户提交普通消息启动 assistant turn
- **THEN** provider input SHALL 包含 plan-mode system prompt
- **THEN** 该 system prompt SHALL 告知模型当前处于只读探索和规划阶段
- **THEN** 该 system prompt SHALL 告知模型不能修改文件、应用 patch、提交 commit、安装依赖、运行变更系统状态的命令或执行计划
- **THEN** 该 system prompt SHALL 告知模型如果用户要求执行计划，应提示用户使用 `/mode normal` 退出 plan mode
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

### Requirement: slash help overlay
系统 SHALL 支持一个最小版的本地 slash 帮助命令：当用户提交纯 `/help` 时，在 composer/footer 区域显示临时 help overlay，用于展示当前可用按键说明。该命令 SHALL 集成到统一的 slash 命令运行时下，但其用户可见行为保持不变。

#### Scenario: 纯 /help 打开 help overlay
- **WHEN** assistant 不处于 thinking 或 streaming，且用户提交内容精确等于 `/help`
- **THEN** 系统 SHALL 进入 help overlay 状态
- **THEN** 系统 SHALL 在 composer/footer 区域显示帮助内容，而不是把帮助文本追加到 transcript

#### Scenario: help overlay 不走 transcript、历史和 agent 生命周期
- **WHEN** 系统因纯 `/help` 进入 help overlay 状态
- **THEN** 系统 SHALL NOT 追加新的 user transcript record 或 assistant transcript record
- **THEN** 系统 SHALL NOT 把 `/help` 写入当前 session 的输入历史
- **THEN** 系统 SHALL NOT 启动 agent 的 thinking 或 streaming 生命周期

#### Scenario: Esc 关闭 help overlay
- **WHEN** help overlay 处于活跃状态且用户按下 Esc
- **THEN** 系统 SHALL 退出 help overlay 状态
- **THEN** 系统 SHALL 恢复普通 composer 输入界面，并让 composer 为空

### Requirement: slash clear 清空命令
系统 SHALL 支持一个本地 slash 清空命令：当用户提交纯 `/clear` 时，应用 SHALL 在 composer/footer 区域显示确认型 command surface。该命令 SHALL 复用统一 slash 命令运行时、command session、effect interpreter 和 `confirm` command surface；确认后只清空当前 transcript records，不清空用于 Up/Down 回溯的 session 输入历史。

#### Scenario: 纯 /clear 打开清空确认面板
- **WHEN** assistant 不处于 thinking 或 streaming，且用户提交内容精确等于 `/clear`
- **THEN** 系统 SHALL 进入 `/clear` command session
- **THEN** 系统 SHALL 在 composer/footer 区域显示 `confirm` command surface，说明确认后会清空当前 transcript，并突出 Enter 确认操作、明确 Esc 取消
- **THEN** 系统 SHALL NOT 把 `/clear` 写入 transcript、输入历史或 agent 生命周期

#### Scenario: 非纯 /clear 输入回退为普通消息
- **WHEN** 用户提交内容以 `/clear` 开头但还带有其他字符
- **THEN** 系统 SHALL 将该内容视为普通 user message 提交，而不是进入清空确认面板

#### Scenario: Enter 确认清空 transcript
- **WHEN** `/clear` command session 处于活跃状态，且用户按下 Enter
- **THEN** 系统 SHALL 关闭 `/clear` command session
- **THEN** 系统 SHALL 清空当前 transcript records，并重绘当前 app snapshot，使旧 transcript 内容不再可见
- **THEN** 系统 SHALL 清空 composer 并恢复普通输入界面
- **THEN** 系统 SHALL NOT 启动 agent 的 thinking 或 streaming 生命周期
- **THEN** 系统 SHALL NOT 追加新的 transcript record 作为清空结果提示

#### Scenario: Enter 清空 transcript 时保留输入历史
- **WHEN** `/clear` command session 确认完成前 session 输入历史中已有普通消息
- **THEN** 系统 SHALL 保留这些输入历史
- **THEN** 用户随后在空 composer 中按 Up SHALL 仍能浏览到清空前成功提交过的普通消息

#### Scenario: Esc 取消清空 transcript
- **WHEN** `/clear` command session 处于活跃状态，且用户按下 Esc
- **THEN** 系统 SHALL 关闭 `/clear` command session
- **THEN** 系统 SHALL 清空 composer 并恢复普通输入界面
- **THEN** 系统 SHALL 保持 transcript records 不变
- **THEN** 系统 SHALL NOT 追加 transcript record

#### Scenario: response 进行中阻止 /clear
- **WHEN** assistant 正在 thinking 或 streaming，且用户提交纯 `/clear`
- **THEN** 系统 SHALL NOT 进入 `/clear` command session
- **THEN** 系统 SHALL NOT 清空 transcript records

### Requirement: transcript 会话持久化
系统 SHALL 按当前工作目录把 transcript records 持久化到用户级 `~/.echo/echo_tui/` 存储目录中。持久化 SHALL 只覆盖已提交的 transcript records，不覆盖 composer 内容、pending preview、command session 或用于 Up/Down 回溯的 input history。session 持久化结构 SHALL 支持可选的压缩状态元数据，包含摘要文本、活跃区间起点索引和创建时间；完整 `records[]` SHALL 保持全量 append-only，不因压缩而删除任何记录。

#### Scenario: 普通 user record 提交后保存 session
- **WHEN** 用户提交一条普通消息且该消息被追加为 user transcript record
- **THEN** 系统 SHALL 在当前工作目录对应的存储分区中创建或更新当前 session
- **THEN** 保存内容 SHALL 包含该 user transcript record

#### Scenario: assistant 完成后保存 session
- **WHEN** assistant response 完成并追加 assistant transcript record
- **THEN** 系统 SHALL 更新当前 session 的 records 和 `updatedAt`
- **THEN** 保存内容 SHALL 包含完成后的 assistant transcript record

#### Scenario: assistant 失败反馈保存 session
- **WHEN** 真实 assistant response 失败并追加本地 `error` transcript record
- **THEN** 系统 SHALL 更新当前 session 的 records 和 `updatedAt`
- **THEN** 保存内容 SHALL 包含该错误反馈 record

#### Scenario: 中断提示保存到 session
- **WHEN** 用户按 Esc 中断当前 assistant response 且系统追加本地中断提示 record
- **THEN** 系统 SHALL 更新当前 session 的 records 和 `updatedAt`
- **THEN** 保存内容 SHALL 包含该本地中断提示 record

#### Scenario: partial assistant 和中断提示顺序保存
- **WHEN** 用户按 Esc 中断当前 assistant response 且已存在 partial assistant draft
- **THEN** session 中 SHALL 先保存 partial assistant record
- **THEN** session 中 SHALL 在其后保存本地中断提示 record

#### Scenario: 按当前工作目录分区保存
- **WHEN** 应用在某个 cwd 中保存 transcript session
- **THEN** 系统 SHALL 将 session 保存到 `~/.echo/echo_tui/` 下对应该 cwd 的项目分区
- **THEN** 系统 SHALL NOT 把会话历史文件写入当前项目目录

#### Scenario: 持久化不保存 input history
- **WHEN** 系统保存 transcript session
- **THEN** 保存内容 SHALL NOT 包含当前进程的 input history

#### Scenario: 压缩后持久化压缩状态
- **WHEN** 一次上下文压缩完成
- **THEN** 系统 SHALL 在当前 session 中保存摘要文本和活跃区间起点索引
- **THEN** 系统 SHALL 保留完整 `records[]`，不删除被压缩区间的任何记录

#### Scenario: resume 加载携带压缩状态的 session
- **WHEN** 用户恢复一个已发生压缩的 session
- **THEN** 系统 SHALL 加载完整 `records[]` 和压缩状态元数据
- **THEN** 后续请求 SHALL 能基于恢复出的压缩状态进行投影

### Requirement: slash resume 恢复命令
系统 SHALL 支持一个本地 slash 恢复命令：当用户提交纯 `/resume` 时，应用 SHALL 读取当前工作目录可恢复的 session metadata 和 bounded message preview，并在 composer/footer 区域显示专用历史恢复 command surface。该命令 SHALL 复用统一 slash 命令运行时、command session 和 effect interpreter。

#### Scenario: 纯 /resume 打开恢复列表
- **WHEN** assistant 不处于 thinking 或 streaming，且用户提交内容精确等于 `/resume`
- **THEN** 系统 SHALL 进入 `/resume` command session
- **THEN** 系统 SHALL 在 composer/footer 区域显示专用历史恢复 command surface
- **THEN** 系统 SHALL 按 `updatedAt` 倒序展示当前工作目录可恢复的 session
- **THEN** 系统 SHALL NOT 把 `/resume` 写入 transcript、input history 或 agent 生命周期

#### Scenario: 没有可恢复 session 时显示空状态
- **WHEN** 用户提交纯 `/resume` 且当前工作目录没有可恢复 session
- **THEN** 系统 SHALL 显示一个可关闭的本地 command surface，说明当前目录没有可恢复会话
- **THEN** 系统 SHALL NOT 启动 agent 或追加 transcript record

#### Scenario: 非纯 /resume 输入回退为普通消息
- **WHEN** 用户提交内容以 `/resume` 开头但还带有其他字符
- **THEN** 系统 SHALL 将该内容视为普通 user message 提交，而不是进入恢复列表

#### Scenario: response 进行中阻止 /resume
- **WHEN** assistant 正在 thinking 或 streaming，且用户提交纯 `/resume`
- **THEN** 系统 SHALL NOT 进入 `/resume` command session
- **THEN** 系统 SHALL NOT 恢复或替换 transcript records

### Requirement: resume 消息预览
系统 SHALL 在 `/resume` 历史恢复面板中为当前选中的 session 展示可滚动的 transcript record 预览。预览 SHALL 来自持久化 session 的 `records[]` 派生数据，每条消息 SHALL 以单行摘要展示 role 和截断后的文本；系统 SHALL NOT 为了预览修改 session 文件格式或追加 transcript record。preview SHALL 使用 bounded 派生数据展示多于 5 条记录和更长文本，并在 footer 高度预算内窗口化显示。

#### Scenario: 选中 session 显示最近消息预览
- **WHEN** 当前工作目录存在可恢复 session，且用户提交纯 `/resume`
- **THEN** 系统 SHALL 在右侧 preview 区域展示当前选中 session 的最近 transcript record 预览
- **THEN** preview SHALL 优先展示靠近 session 末尾的记录
- **THEN** preview SHALL 能包含多于 5 条记录的 bounded 预览数据

#### Scenario: 移动选择时更新消息预览
- **WHEN** `/resume` command session 处于 list focus
- **AND** 用户按下 Up 或 Down 使选中 session 改变
- **THEN** 系统 SHALL 更新左侧选中项
- **THEN** 系统 SHALL 更新右侧 preview 区域，使其展示新选中 session 的最近消息预览
- **THEN** 系统 SHALL 将 preview scroll 重置到顶部

#### Scenario: 无可预览消息时显示空预览
- **WHEN** 选中 session 不包含可展示的 transcript text
- **THEN** 系统 SHALL 在 preview 区域显示空预览提示
- **THEN** 系统 SHALL 保持 Enter 恢复和 Esc 取消行为可用

#### Scenario: 进入 preview focus
- **WHEN** `/resume` command session 处于 list focus
- **AND** 用户按下 Right 或 Tab
- **THEN** 系统 SHALL 将焦点切换到右侧 preview 区域
- **THEN** 系统 SHALL NOT 改变当前选中的 session

#### Scenario: preview focus 下滚动预览
- **WHEN** `/resume` command session 处于 preview focus
- **AND** 用户按下 Up 或 Down
- **THEN** 系统 SHALL 上下滚动右侧 preview 内容窗口
- **THEN** 系统 SHALL NOT 改变左侧选中的 session
- **THEN** 系统 SHALL NOT 恢复或替换 transcript records

#### Scenario: 返回 list focus
- **WHEN** `/resume` command session 处于 preview focus
- **AND** 用户按下 Left
- **THEN** 系统 SHALL 将焦点切换回左侧 session 列表
- **THEN** 系统 SHALL 保留当前选中的 session

#### Scenario: preview 滚动不改变恢复语义
- **WHEN** `/resume` command session 处于 preview focus
- **AND** 用户按下 Enter
- **THEN** 系统 SHALL 恢复当前选中的 session
- **WHEN** `/resume` command session 处于 preview focus
- **AND** 用户按下 Esc
- **THEN** 系统 SHALL 取消 `/resume` 并回到普通 composer 输入界面

#### Scenario: 长 preview 遵守 footer 约束
- **WHEN** 当前选中 session 的 preview 内容超过右侧 preview 可见高度
- **THEN** footer SHALL 只渲染当前 preview scroll 对应的可见窗口
- **THEN** footer SHALL NOT 因完整 preview 内容变长而无限增长
- **THEN** footer SHALL 遵守当前终端 safe render width，避免额外自动换行

### Requirement: resume select 窗口滚动
系统 SHALL 在 `/resume` 的专用历史恢复 command surface 中一次最多显示 5 条 session。选择移动 SHALL 由 `/resume` handler 更新当前可见窗口和相对选中项完成，而不是要求 footer renderer 支持通用虚拟列表。preview focus 下的 Up/Down SHALL 只滚动右侧预览，不改变 session 选择窗口。

#### Scenario: session 数量超过 5 时只显示窗口内 5 条
- **WHEN** 当前工作目录存在超过 5 个可恢复 session，且用户提交纯 `/resume`
- **THEN** 系统 SHALL 只在专用历史恢复 command surface 的左侧列表中显示按 `updatedAt` 倒序排列的前 5 条 session
- **THEN** 第一条 session SHALL 处于选中状态

#### Scenario: Down 移动到窗口底部后向下滚动
- **WHEN** `/resume` command session 中存在超过 5 个 session，且当前选中项已经位于可见窗口最后一条
- **WHEN** 用户按下 Down，且全量列表中还存在下一条 session
- **THEN** 系统 SHALL 将选中项移动到下一条 session
- **THEN** 系统 SHALL 更新可见窗口，使较早的顶部 session 从窗口中移出，并显示新的下一条 session

#### Scenario: Up 移动到窗口顶部后向上滚动
- **WHEN** `/resume` command session 中当前选中项已经位于可见窗口第一条，且全量列表中还存在上一条 session
- **WHEN** 用户按下 Up
- **THEN** 系统 SHALL 将选中项移动到上一条 session
- **THEN** 系统 SHALL 更新可见窗口，使较晚的上一条 session 显示出来

#### Scenario: resume 选择不循环
- **WHEN** `/resume` command session 中当前选中项是全量列表第一条且用户按下 Up
- **THEN** 系统 SHALL 保持第一条 session 处于选中状态
- **WHEN** 当前选中项是全量列表最后一条且用户按下 Down
- **THEN** 系统 SHALL 保持最后一条 session 处于选中状态

#### Scenario: preview focus 不移动 session 窗口
- **WHEN** `/resume` command session 处于 preview focus
- **AND** 用户按下 Up 或 Down
- **THEN** 系统 SHALL 保持当前 session selectedIndex 和 windowStart 不变
- **THEN** 系统 SHALL 只更新右侧 preview scroll

### Requirement: resume 确认恢复 session
系统 SHALL 在 `/resume` command session 中支持 Enter 恢复当前选中的 session。恢复 SHALL 替换当前 transcript records 并完整重绘当前 app snapshot，使屏幕只显示恢复出来的 session transcript。

#### Scenario: Enter 恢复选中 session
- **WHEN** `/resume` command session 处于活跃状态，且用户按下 Enter
- **THEN** 系统 SHALL 关闭 `/resume` command session
- **THEN** 系统 SHALL 清空 composer 并恢复普通输入界面
- **THEN** 系统 SHALL 从持久化存储加载选中 session 的 transcript records
- **THEN** 系统 SHALL 用加载出的 records 替换当前 transcript records
- **THEN** 系统 SHALL 重绘当前 app snapshot，使屏幕显示恢复出来的 session transcript

#### Scenario: 恢复后不追加提示 transcript
- **WHEN** `/resume` 成功恢复某个 session
- **THEN** 系统 SHALL NOT 追加新的 user transcript record 或 assistant transcript record 作为恢复结果提示
- **THEN** 用户可见反馈 SHALL 是恢复出来的 transcript 显示在屏幕上

#### Scenario: Esc 取消 resume
- **WHEN** `/resume` command session 处于活跃状态，且用户按下 Esc
- **THEN** 系统 SHALL 关闭 `/resume` command session
- **THEN** 系统 SHALL 清空 composer 并恢复普通输入界面
- **THEN** 系统 SHALL NOT 替换当前 transcript records
- **THEN** 系统 SHALL NOT 追加 transcript record

### Requirement: clear 与持久化 session 分离
系统 SHALL 在 `/clear` 清空当前可见 transcript 时保留已经持久化的 session 文件。清空后后续普通消息 SHALL 创建或写入新的 session，而不是覆盖被清空前的旧 session。

#### Scenario: /clear 不删除已保存 session
- **WHEN** 当前 transcript 已经保存到某个持久化 session，且用户通过 `/clear` 确认清空 transcript
- **THEN** 系统 SHALL 清空当前可见 transcript records
- **THEN** 系统 SHALL 保留该持久化 session 文件，使它仍可通过 `/resume` 恢复

#### Scenario: /clear 后新消息进入新 session
- **WHEN** 用户通过 `/clear` 确认清空 transcript 后提交新的普通消息
- **THEN** 系统 SHALL 为该新 transcript 创建或使用新的持久化 session
- **THEN** 系统 SHALL NOT 把旧 session 覆盖为空或把新消息追加到被清空前的旧 session

### Requirement: 退出快捷键
系统 SHALL 在用户按下 Ctrl+C 或 Ctrl+D 时干净退出。

#### Scenario: Ctrl+C 退出
- **WHEN** 用户按下 Ctrl+C
- **THEN** 应用 SHALL 恢复 terminal input mode、显示光标并退出

#### Scenario: Ctrl+D 退出
- **WHEN** 用户按下 Ctrl+D
- **THEN** 应用 SHALL 恢复 terminal input mode、显示光标并退出

### Requirement: 真实 assistant 生命周期
系统 SHALL 支持真实 assistant response 生命周期：用户普通消息提交后进入 thinking 状态，随后以真实模型服务返回的文本增量更新 Markdown-aware streaming preview，并在成功完成后提交最终 assistant block。fake assistant MAY 作为测试或显式开发注入实现，但 CLI 默认普通对话 SHALL 使用真实 LLM adapter，且 agent SHALL 接收当前 transcript records 作为多轮上下文输入。Markdown-aware projection SHALL include table-aware rendering for valid Markdown pipe tables.

#### Scenario: thinking 状态先于 streaming
- **WHEN** 用户普通消息被提交并启动 assistant response
- **THEN** footer pending preview SHALL 在首个真实文本增量到达前显示 assistant thinking 状态

#### Scenario: streaming 展示真实文本增量
- **WHEN** 真实 LLM adapter 接收到文本增量
- **THEN** footer pending preview SHALL 按 adapter 提供的完整 draft 更新 streaming 文本
- **THEN** streaming 文本 SHALL 来自真实模型服务，而不是固定回显用户原始提交内容
- **THEN** streaming 文本 SHALL 通过容错 Markdown-aware terminal projection 显示

#### Scenario: streaming 展示真实 table 增量
- **WHEN** 真实 LLM adapter 接收到包含有效 Markdown table 的文本增量
- **THEN** footer pending preview SHALL 按 adapter 提供的完整 draft 更新 streaming 文本
- **THEN** streaming 文本 SHALL 通过 table-aware Markdown projection 显示

#### Scenario: 完成后提交 assistant transcript
- **WHEN** 真实 LLM adapter 成功完成响应
- **THEN** pending preview SHALL 被清空，并且完成后的 assistant 消息 SHALL 被追加到 transcript
- **THEN** 完成后的 assistant 消息 SHALL 通过 Markdown-aware terminal projection 显示

#### Scenario: 完成后提交 table-aware assistant transcript
- **WHEN** 真实 LLM adapter 成功完成包含 Markdown table 的响应
- **THEN** pending preview SHALL 被清空，并且完成后的 assistant 消息 SHALL 被追加到 transcript
- **THEN** 完成后的 assistant 消息 SHALL 通过 table-aware Markdown projection 显示

#### Scenario: 失败后释放响应锁
- **WHEN** 真实 LLM adapter 在 thinking 或 streaming 期间失败
- **THEN** pending preview SHALL 被清空
- **THEN** assistant response lock SHALL 被释放
- **THEN** 系统 SHALL 追加一条本地 `error` transcript record 作为可见反馈

#### Scenario: 用户中断后释放响应锁
- **WHEN** 用户按 Esc 中断 thinking 或 streaming 中的 assistant response
- **THEN** pending preview SHALL 被清空
- **THEN** assistant response lock SHALL 被释放
- **THEN** 系统 SHALL 追加本地中断提示 record，而不是本地 `error` transcript record

#### Scenario: 测试注入 fake agent 不改变 CLI 默认行为
- **WHEN** 测试通过 assistant turn runner、agent loop runtime 或 `createApp(runAgent, ...)` 这类公开运行 seam 使用 fake 或 stub agent
- **THEN** app SHALL 按相同 callbacks contract 处理 thinking、streaming 和 completion
- **THEN** CLI 默认普通对话行为 SHALL 由真实 LLM adapter 提供
- **THEN** 注入的 fake 或 stub agent SHALL 接收当前 transcript records，而不是单个用户文本字符串

### Requirement: TUI 行为不依赖测试专用 app options
系统 SHALL 在删除 app 装配入口测试专用 options 后保持当前终端 TUI 外部行为不变，包括启动、输入处理、footer 渲染、slash command、MCP 初始化状态、assistant response lifecycle 和退出清理。

#### Scenario: CLI 启动行为保持不变
- **WHEN** 用户通过 CLI 启动 TUI
- **THEN** 系统 SHALL 仍在当前终端启动并显示 banner、composer 和 status line
- **THEN** 用户 SHALL 不需要提供任何测试专用 app options

#### Scenario: 输入和渲染行为保持不变
- **WHEN** 用户输入文本、触发 slash command、提交消息或 resize 终端
- **THEN** 系统 SHALL 按既有 TUI 行为处理输入和重绘
- **THEN** 删除测试专用 app options SHALL NOT 改变用户可见交互语义

#### Scenario: 退出清理行为保持不变
- **WHEN** 用户触发退出
- **THEN** 系统 SHALL 仍停止运行中任务、关闭 MCP manager、清理 footer、恢复 terminal 状态并退出进程

### Requirement: transcript 视觉标记
系统 SHALL 使用轻量符号和克制 theme token 区分 transcript 中的用户消息、assistant 消息、本地 error 消息、本地中断提示和 pending assistant，而不是在 transcript 中显示 `user:`、`assistant:` 或 `error:` 文本标签。用户消息 SHALL 使用 quote-style 粗竖条前缀和覆盖整条消息行的背景；用户消息的整行背景 SHALL 在渲染投影阶段按当前终端宽度计算。assistant 消息内容 SHALL 支持 Markdown-aware terminal projection，包括 table-aware projection；role 视觉标记 SHALL 继续由 transcript renderer 控制，颜色 SHALL 来自当前 render theme。

#### Scenario: 用户消息使用粗竖条前缀
- **WHEN** 用户消息被追加到 transcript
- **THEN** 该消息 SHALL 使用 `▌` 或等价粗竖条作为前缀
- **THEN** 该前缀 SHALL 使用当前 render theme 的 user prefix 或等价 token 显示
- **THEN** 该消息 SHALL 使用覆盖整条消息行的 theme 背景与 assistant 消息区分
- **THEN** 用户消息块的上下 padding 行 SHALL 同样显示该粗竖条前缀并使用相同 theme 背景

#### Scenario: 用户消息 resize 后背景覆盖当前宽度
- **WHEN** 用户消息已经追加到 transcript 且终端随后变窄或变宽
- **THEN** 用户消息 SHALL 基于当前终端宽度重新渲染，背景 SHALL 覆盖重新 wrap 后每一行的当前渲染宽度
- **THEN** 重新渲染后的用户消息内容行和 padding 行 SHALL 继续显示粗竖条前缀
- **THEN** 重绘 SHALL 使用当前进程 render theme，而不是保存时的旧 ANSI 输出

#### Scenario: assistant 完成消息使用独立前缀
- **WHEN** assistant 消息完成并追加到 transcript
- **THEN** 该消息 SHALL 使用 `◆` 或等价符号作为前缀，并使用与用户消息不同的 theme 样式
- **THEN** 该消息内容 SHALL 按 Markdown-aware terminal projection 显示

#### Scenario: assistant table 消息保持 role 前缀
- **WHEN** assistant 消息包含 Markdown table 并被追加到 transcript
- **THEN** 该消息 SHALL 使用 `◆` 或等价符号作为首条可见行前缀
- **THEN** table continuation lines SHALL 与 assistant block 的视觉缩进保持一致
- **THEN** table 结构色 SHALL 使用当前 render theme 的 Markdown table token

#### Scenario: error 消息使用独立可见投影
- **WHEN** 本地 error record 被追加或恢复到 transcript
- **THEN** 该消息 SHALL 使用区别于 user 和 assistant 的 theme 样式
- **THEN** 该消息 SHALL NOT 显示为 `assistant` 回复

#### Scenario: 本地中断提示使用独立可见投影
- **WHEN** 本地中断提示 record 被追加或恢复到 transcript
- **THEN** 该消息 SHALL 使用区别于 user、assistant 和 error 的克制 theme 样式
- **THEN** 该消息 SHALL NOT 显示为 assistant 回复或 error 反馈

#### Scenario: transcript 不显示文字角色标签
- **WHEN** user、assistant 或 error 消息被渲染为 transcript block
- **THEN** transcript SHALL NOT 显示 `user:`、`assistant:` 或 `error:` 作为消息前缀

### Requirement: 模块边界
系统 SHALL 把 terminal、input、render、agent、persistence、slash commands 和 application orchestration 代码放在不同模块中，并使用直接清晰、与真实职责一致的命名。app 层作为状态编排层，不直接组合多个底层 renderer，而是通过单一 app renderer 门面驱动渲染路径；slash 命令 SHALL 通过统一 resolver、handler、command runtime 和 `CommandHost` 集成到 app 中。Markdown inline parsing 和 Markdown table rendering SHALL 位于 render 层的独立模块中，避免 `markdown.ts` 承载过多互相独立的语法细节。

#### Scenario: 存在建议目录结构
- **WHEN** 实现完成
- **THEN** 项目 SHALL 包含 `bin/echo-tui.ts`、`src/app/main.ts`、`src/app/state/app-context.ts`、`src/app/command/command-host.ts`、`src/app/command/command-runtime.ts`、`src/app/state/composer-context.ts`、`src/app/state/model-context.ts`、`src/app/state/render-context.ts`、`src/app/state/slash-suggestion-context.ts`、`src/app/state/transcript-context.ts`、`src/app/state/turn-context.ts`、`src/terminal/ansi.ts`、`src/terminal/tty.ts`、`src/input/event-types.ts`、`src/input/key-parser.ts`、`src/input/composer.ts`、`src/render/layout.ts`、`src/render/app-renderer.ts`、`src/render/footer.ts`、`src/render/blocks.ts`、`src/render/markdown.ts`、`src/render/markdown-inline.ts`、`src/render/markdown-table.ts`、`src/agent/fake/agent.ts`、`src/agent/agent-loop-runtime.ts`、`src/agent/openai-responses/agent.ts`、`src/agent/openai-chat/agent.ts`、`src/agent/anthropic/agent.ts`、`src/agent/codex/agent.ts`、`src/config/llm-config.ts`、`src/commands/`、`src/persistence/transcript-store.ts`、`src/types/`、`tsconfig.json`、`package.json`、`README.md` 和 `docs/tui-architecture.md`

#### Scenario: app 层通过单一 renderer 门面触发渲染
- **WHEN** 应用运行并处理输入编辑、transcript append 或 resize destructive recovery
- **THEN** `src/app/main.ts` SHALL 通过统一的 `src/render/app-renderer.ts` 接口触发对应渲染路径
- **THEN** `src/app/main.ts` SHALL NOT 直接组合 `footer renderer`、`blocks renderer` 或底层 `output.write` 来执行这些渲染路径

#### Scenario: app 层通过统一 slash 运行时协调本地命令
- **WHEN** 用户提交 slash 命令或某个命令会话处于活跃状态
- **THEN** `src/app/main.ts` SHALL 通过统一的 slash resolver、handler、command runtime 和 `CommandHost` 协调命令行为
- **THEN** `src/app/main.ts` SHALL NOT 直接为每个具体 slash 命令堆积独立的提交分支、按键分支和业务 flow 函数

#### Scenario: handler 不直接访问 transcript store
- **WHEN** `/resume` 需要展示或恢复 session
- **THEN** handler SHALL 只通过 `CommandHost` 读取 session metadata，并通过 `CommandHost` 请求 app 执行恢复
- **THEN** handler SHALL NOT 直接读取完整 transcript records 或直接调用 transcript store

#### Scenario: 实例级 AppContext 收拢 app 共享状态
- **WHEN** 应用运行
- **THEN** `src/app/main.ts` SHALL 通过实例级 `AppContext` 管理共享状态、派生上下文与基础状态操作
- **THEN** `src/app/main.ts` SHALL 聚焦于依赖装配、事件分发和顶层状态机编排，而不是持有大量共享状态局部变量

#### Scenario: app 层不提供测试专用状态快照 API
- **WHEN** 测试验证 app 状态行为
- **THEN** `src/app/main.ts` SHALL NOT 仅为了测试兼容暴露 `getState()` 之类的测试专用状态快照出口
- **THEN** 自动化测试 SHALL 适配公开行为和更合适的单元边界，而不是反向约束运行时代码接口

#### Scenario: AppContext 不替代 command runtime
- **WHEN** 应用处理 slash 命令会话
- **THEN** `src/app/command/command-runtime.ts` SHALL 负责命令会话和事件分发
- **THEN** `AppContext` SHALL NOT 直接吞并 command runtime 的职责边界

#### Scenario: agent 和 persistence 边界清晰
- **WHEN** agent 与 persistence 模块参与 LLM 和 transcript session 流程
- **THEN** `src/agent/agent-loop-runtime.ts` SHALL 承载 provider-neutral 真实 agent loop，`src/agent/openai-responses/agent.ts`、`src/agent/openai-chat/agent.ts`、`src/agent/anthropic/agent.ts` 和 `src/agent/codex/agent.ts` SHALL 承载具体 provider turn adapter，`src/config/llm-config.ts` SHALL 承载用户级配置读取与校验，`src/agent/fake/agent.ts` SHALL 作为测试注入和显式开发 fixture
- **THEN** `src/persistence/transcript-store.ts` SHALL 承载本地 transcript session 存储、读取、列表派生和 atomic write
- **THEN** app 层 SHALL NOT 直接读取用户配置文件、直接调用 OpenAI SDK、直接操作 session JSON 文件或绕过 transcript store

#### Scenario: agent 和 persistence 运行行为稳定
- **WHEN** agent 与 persistence 模块处理 LLM 和 transcript session 流程
- **THEN** 真实 adapter lifecycle、fake agent callbacks、配置错误脱敏、cwd hash 分区、session JSON schema、metadata 派生和 atomic write SHALL 行为稳定
- **THEN** slash 命令、普通提交、`/resume` 恢复和 `/clear` detach session 语义 SHALL 稳定

#### Scenario: app 模块边界清晰
- **WHEN** app 模块处理顶层编排和共享状态
- **THEN** `src/app/main.ts` SHALL 负责顶层依赖装配、输入事件分发、assistant lifecycle 和 destructive resize recovery，`src/app/state/app-context.ts` SHALL 作为组合根门面，`src/app/command/command-host.ts` SHALL 承载 command 可用 app facade 和命令触发的 app 能力编排
- **THEN** `src/app/state/composer-context.ts`、`src/app/state/model-context.ts`、`src/app/state/render-context.ts`、`src/app/state/slash-suggestion-context.ts`、`src/app/state/transcript-context.ts` 和 `src/app/state/turn-context.ts` SHALL 分别承载输入历史、模型信息、渲染派生状态、composer slash suggestion、transcript/session 和 turn lifecycle 相关职责
- **THEN** `src/app/main.ts` SHALL NOT 直接持有 `SlashSuggestionContext`；该 context SHALL 由 `AppContext` 组合并通过门面暴露给顶层事件分发
- **THEN** command runtime SHALL NOT 吞并 context 职责，`main.ts` SHALL NOT 持有大量共享状态局部变量

#### Scenario: app 模块运行行为稳定
- **WHEN** app 模块处理输入事件、命令和 assistant lifecycle
- **THEN** slash command session、host 命令能力、thinking / streaming pending state、input history 浏览、transcript append/persist、resize destructive recovery 和退出 cleanup SHALL 行为稳定
- **THEN** 自动化测试 SHALL 通过 assistant turn runner、command runtime、renderer、input parser、agent loop runtime 或其他公开模块 seam 覆盖行为，而不是依赖测试专用 app options

#### Scenario: render 和 terminal 保持边界清晰
- **WHEN** render 与 terminal 模块参与 app 渲染和终端控制
- **THEN** `src/render/app-renderer.ts` SHALL 作为 app 层使用的单一 renderer 门面
- **THEN** `src/terminal/ansi.ts` SHALL 只集中生成 ANSI 控制序列，`src/terminal/tty.ts` SHALL 只负责 raw mode setup/cleanup 和 terminal size 读取
- **THEN** app 层 SHALL NOT 直接组合底层 renderer、直接写 terminal 控制序列或绕过 `setupTerminal`

#### Scenario: render 和 terminal 视觉与终端行为稳定
- **WHEN** render 与 terminal 模块处理 UI 投影和终端控制
- **THEN** banner、transcript block、pending preview、footer layout、composer cursor 坐标、command surface、ANSI 样式和 display width/wrap 计算 SHALL 行为稳定
- **THEN** raw mode setup/cleanup、光标隐藏/显示、普通 footer redraw 和 resize destructive recovery SHALL 行为稳定

### Requirement: 架构文档
系统 SHALL 提供使用说明和 TUI 架构文档。

#### Scenario: README 说明运行和验证
- **WHEN** 开发者打开 `README.md`
- **THEN** 文档 SHALL 说明原型目标、前置要求、`npm start`、控制方式和验证步骤

#### Scenario: 架构文档包含示意图
- **WHEN** 开发者打开 `docs/tui-architecture.md`
- **THEN** 文档 SHALL 包含模块架构图、运行流程图、assistant 响应子流程图，以及 footer、composer、status line、transcript 的区域示意图

#### Scenario: 架构文档说明重要函数
- **WHEN** 开发者阅读 `docs/tui-architecture.md`
- **THEN** 文档 SHALL 描述 terminal、input、render、agent、persistence、slash command 和 app 模块的重要函数

#### Scenario: README 说明恢复与持久化
- **WHEN** 开发者打开 `README.md`
- **THEN** 文档 SHALL 说明 `/resume` 的使用方式、恢复列表一次最多显示 5 条、历史文件保存位置和本地明文存储的隐私注意事项

### Requirement: 构建、类型检查和 JavaScript 语法验证
系统 SHALL 支持使用 TypeScript build/typecheck 验证源码和测试，并使用 `node --check` 验证 JavaScript 测试文件语法。

#### Scenario: JavaScript 测试文件通过语法检查
- **WHEN** 开发者对 `test/` 下匹配到的 JavaScript 文件运行 `node --check`
- **THEN** 每个匹配文件 SHALL 在没有语法错误的情况下通过检查

#### Scenario: TypeScript 构建和类型检查通过
- **WHEN** 开发者运行 `npm run build`、`npm run typecheck` 和 `npm test`
- **THEN** TypeScript 编译、类型检查和编译后的测试 SHALL 全部通过

### Requirement: checkbox command surface
系统 SHALL 支持 checkbox command surface，用于在 footer command surface 区域展示可多选的列表项。每个列表项 SHALL 显示当前 checked 状态，用户 SHALL 能移动选择、切换当前项并确认或取消。

#### Scenario: 渲染 checkbox 列表
- **WHEN** footer 当前 command surface kind 为 checkbox
- **THEN** renderer SHALL 显示 surface title
- **THEN** renderer SHALL 为每个 option 显示 `[x]` 或 `[ ]` 状态标记
- **THEN** renderer SHALL 高亮当前 selectedIndex 对应的行
- **THEN** renderer SHALL 显示 surface 自身的 dismissHint 或等价操作提示

#### Scenario: checkbox surface 使用 Space 切换
- **WHEN** checkbox command session 处于活跃状态且用户按 Space
- **THEN** 系统 SHALL 切换当前 selectedIndex 对应 option 的 checked 状态
- **THEN** 系统 SHALL 保持 command session 活跃并重绘 footer

#### Scenario: checkbox surface 使用 Enter 确认
- **WHEN** checkbox command session 处于活跃状态且用户按 Enter
- **THEN** 对应 command handler SHALL 确认当前 checked 状态
- **THEN** command session SHALL 关闭

#### Scenario: checkbox surface 使用 Esc 取消
- **WHEN** checkbox command session 处于活跃状态且用户按 Esc
- **THEN** 对应 command handler SHALL 取消当前草稿状态
- **THEN** command session SHALL 关闭

#### Scenario: command surfaces 保留自身提示
- **WHEN** footer 当前显示 checkbox command surface
- **THEN** 该 surface SHALL 使用自身的 `dismissHint` 或等价 surface 内提示
- **THEN** 全局 composer status line SHALL NOT 覆盖该 surface 的交互提示

### Requirement: skills command surface
系统 SHALL 支持专用 skills command surface，用于在 footer command surface 区域展示和管理 discovered skills。该 surface SHALL 使用 cyan card 风格，展示 enabled 计数、skill 开关状态、来源、描述、当前选中项和操作提示，并 SHALL 遵守现有 footer 安全宽度和局部重绘约束。

#### Scenario: 渲染 skills manager card
- **WHEN** footer 当前 command surface kind 为 skills
- **THEN** renderer SHALL 显示 cyan 风格边框和 `SKILLS` 或等价标题
- **THEN** renderer SHALL 显示当前 enabled skill 数量和总 skill 数量
- **THEN** renderer SHALL NOT 显示搜索框、搜索 placeholder 或搜索光标
- **THEN** 全局 composer status line SHALL NOT 覆盖该 surface 的交互提示

#### Scenario: 渲染 skill 行
- **WHEN** skills command surface 包含 discovered skills
- **THEN** renderer SHALL 为每个可见 skill 显示 on/off pill 或等价开关状态
- **THEN** renderer SHALL 显示 skill 名称
- **THEN** renderer SHALL 显示 skill 来源和描述，且长文本 SHALL 在安全宽度内截断
- **THEN** disabled skill SHALL 使用区别于 enabled skill 的弱化样式

#### Scenario: 渲染当前选中行
- **WHEN** skills command surface 有 selectedIndex
- **THEN** renderer SHALL 高亮当前选中 skill 行
- **THEN** renderer SHALL 在当前选中行显示左侧 accent 或等价视觉标记
- **THEN** footer renderer SHALL NOT 在该不可编辑 surface 上显示可编辑光标

#### Scenario: skills manager 行数超出可见窗口
- **WHEN** discovered skills 数量超过 skills surface 的可见行数预算
- **THEN** renderer SHALL 只显示包含当前 selectedIndex 的一段连续窗口
- **THEN** renderer SHALL 在窗口上方或下方显示剩余数量提示
- **THEN** 当前 selectedIndex SHALL 始终在可见窗口内

#### Scenario: skills manager 提示按键
- **WHEN** skills command surface 处于活跃状态
- **THEN** surface SHALL 显示 Up/Down 移动、Space 切换、Enter 保存和 Esc 取消的提示
- **THEN** surface SHALL NOT 显示 `/` 搜索、`a` 全选、`n` 全不选、`j/k` 或 home/end 提示

#### Scenario: skills manager 空状态
- **WHEN** skills command surface 不包含任何 skill
- **THEN** renderer SHALL 显示没有发现可用 skill 的可读提示
- **THEN** renderer SHALL 允许用户通过 Esc 关闭该 command surface

### Requirement: 消息布局一致性
系统 SHALL 让 user transcript、assistant transcript 和 pending assistant preview 使用一致的紧凑消息布局，并根据当前终端宽度计算 wrap、缩进和背景覆盖宽度。

#### Scenario: 标记和文本同一行开始
- **WHEN** 渲染 user、assistant 或 pending assistant 的首行内容
- **THEN** 消息前缀和首行文本 SHALL 出现在同一行

#### Scenario: 多行内容按文本列对齐
- **WHEN** 消息内容包含换行或发生自动 wrap
- **THEN** 后续行 SHALL 按首行文本起始列缩进，而不是重复角色标记

#### Scenario: 中文宽字符 wrap 后缩进正确
- **WHEN** 中文长文本因终端宽度发生 wrap
- **THEN** wrap 后的后续行 SHALL 保持与文本列对齐，不得因为直接使用 `string.length` 计算列宽而错位

#### Scenario: assistant 完成时布局不跳变
- **WHEN** pending assistant streaming 完成并提交为正式 assistant transcript
- **THEN** 文本起始列、多行缩进和垂直位置 SHALL 保持一致，允许状态符号从 pending 样式变为完成样式

#### Scenario: user 与 assistant 之间保留呼吸空间
- **WHEN** 用户消息被追加后 assistant pending preview 或正式 assistant transcript 被渲染
- **THEN** user 消息和 assistant 区域之间 SHALL 至少保留一行空白间隔

#### Scenario: composer 与上方内容之间保留空行
- **WHEN** footer 被渲染
- **THEN** transcript 或 pending preview 与 composer 之间 SHALL 保留一行空白 spacer
- **THEN** composer 上方 SHALL NOT 渲染额外实线边界

### Requirement: echo 主题 spinner 动画
系统 SHALL 在 status line 中原 ready/PLAN 所在状态段显示 assistant thinking/working 的 echo 主题固定宽度声场 spinner 动画。该动画 SHALL 由多个 cell 组成，表现为从中心向两侧扩散、淡出并短暂停顿的回声波纹。动画 SHALL 继续由 `elapsedMs` 在渲染层纯投影生成，不依赖后台线程、独立终端行控制或第三方 TUI 库。

#### Scenario: 非响应中保留 ready/PLAN
- **WHEN** assistant 未处于 thinking 或 working 响应状态
- **THEN** status line 状态段 SHALL 继续显示既有 ready 或 PLAN
- **THEN** 系统 SHALL NOT 显示 echo spinner

#### Scenario: thinking 在 status line 使用 echo spinner
- **WHEN** assistant 处于 thinking pending 状态
- **THEN** status line 状态段 SHALL 显示 echo 主题声场 spinner 和 thinking 文案，而不是 ready 或 PLAN
- **THEN** thinking 文案 SHALL 使用灰色未扫区域、白色过渡区域和 bold white 主扫光，并显示从文案中心向两侧扩散的扫光
- **THEN** thinking 文案扫光 SHALL 复用 echo spinner 的完整帧周期；当 spinner 处于空白暂停帧时，文案 SHALL 不显示白色扫光
- **THEN** status line SHALL NOT 在 thinking spinner 状态段后追加响应中 key hint，例如 `Ctrl+C 退出`
- **THEN** pending preview SHALL NOT 为 thinking 额外显示独立 spinner 行
- **THEN** pending preview SHALL NOT 在 thinking 动画前额外显示 assistant message prefix，例如 `◇ `

#### Scenario: working 在 status line 使用同一套 echo spinner
- **WHEN** assistant 已进入 working 状态
- **THEN** status line 状态段 SHALL 显示与 thinking 相同风格的 echo 主题声场 spinner
- **THEN** status line 状态段 SHALL 显示 working 文案和 elapsed time
- **THEN** working 文案和 elapsed time SHALL 使用灰色未扫区域、白色过渡区域和 bold white 主扫光，并显示从文案中心向两侧扩散的扫光
- **THEN** working 文案扫光 SHALL 复用 echo spinner 的完整帧周期；当 spinner 处于空白暂停帧时，文案 SHALL 不显示白色扫光
- **THEN** status line SHALL NOT 在 working spinner 状态段后追加响应中 key hint，例如 `Ctrl+C 退出`
- **THEN** footer SHALL NOT 为 working 额外显示独立行

#### Scenario: spinner 帧宽稳定
- **WHEN** spinner 随 `elapsedMs` 推进到不同帧
- **THEN** 每一帧的 plain text 显示宽度 SHALL 保持一致
- **THEN** ANSI 着色 SHALL NOT 改变 status line 的宽度计算
- **THEN** footer SHALL NOT 因 spinner 帧变化出现水平抖动或额外换行

#### Scenario: spinner 使用 cyan 强弱层次
- **WHEN** echo spinner 渲染非空 cell
- **THEN** cell SHALL 使用 cyan 色系或等价项目 accent 色系表达强弱变化
- **THEN** 更强的 cell SHALL 比更弱的 cell 更亮或更醒目
- **THEN** 空白 cell SHALL 保持空白，不输出会污染后续文本的未闭合 ANSI 样式

#### Scenario: spinner 不改变响应生命周期
- **WHEN** assistant thinking、streaming、tool call、complete、error 或 interrupt 状态发生变化
- **THEN** spinner 动画 SHALL 只影响可见渲染
- **THEN** 系统 SHALL 保持既有 response lock、pending state、footer redraw、transcript append 和 session persistence 语义不变

### Requirement: banner 和 status line 视觉层级
系统 SHALL 以低噪音方式呈现启动 banner 和 footer status line，使它们提供上下文但不抢占 transcript 和 composer 的视觉焦点。banner 和 status line 的颜色 SHALL 来自当前 render theme。

#### Scenario: banner 显示 session 信息
- **WHEN** 应用启动
- **THEN** banner SHALL 显示 `echo_tui`、cwd、Node 版本、TTY 尺寸和运行模式等 session 信息
- **THEN** banner 标题、边框、分割线和弱化元信息 SHALL 使用当前 render theme token

#### Scenario: banner 装饰保持克制
- **WHEN** banner 被渲染
- **THEN** banner SHALL 使用简洁 session 文本，不在底部追加会与 transcript/composer spacer 重叠的整行装饰线，也不使用重装饰卡片或大面积边框
- **THEN** theme override SHALL NOT 改变 banner 的布局层级或输出信息集合

#### Scenario: status line 保持一行弱强调
- **WHEN** footer 被渲染
- **THEN** status line SHALL 保持固定 1 行，并使用 theme token 表达弱强调样式

### Requirement: 上下文压缩提示块
系统 SHALL 在一次上下文压缩发生后，于 transcript 中插入一个克制的可见提示块，告知用户较早历史已被压缩为摘要。提示块 SHALL 区别于 user、assistant 和 error 消息样式。resume 渲染 SHALL 只渲染完整 `records[]`，SHALL NOT 把压缩摘要文本作为 transcript 内容显示。

#### Scenario: 压缩后显示提示块
- **WHEN** 一次上下文压缩完成
- **THEN** 系统 SHALL 在 transcript 中显示一个提示块，说明较早历史已被压缩为摘要
- **THEN** 该提示块 SHALL 使用区别于 user、assistant 和 error 的克制 theme 样式

#### Scenario: resume 不显示压缩摘要内容
- **WHEN** 用户恢复一个已发生压缩的 session
- **THEN** 系统 SHALL 按现有方式渲染完整 `records[]`
- **THEN** 系统 SHALL NOT 把压缩摘要文本作为 transcript 消息显示出来

### Requirement: slash compact 手动压缩命令
系统 SHALL 支持一个本地 slash 命令：当用户提交纯 `/compact` 时，应用 SHALL 弹出 confirm command surface 请求确认；用户确认后 SHALL 手动触发一次上下文压缩。该命令 SHALL 复用统一 slash 命令运行时、command session 与 confirm surface（与 `/clear` 同构）。该命令 SHALL NOT 把 `/compact` 写入 transcript、input history 或 agent 生命周期。手动压缩 SHALL 以强制模式执行（绕过阈值），但仍遵守边界吸附。

#### Scenario: 纯 /compact 打开确认框
- **WHEN** assistant 不处于 thinking 或 streaming，且用户提交内容精确等于 `/compact`
- **THEN** 系统 SHALL 进入 `/compact` command session 并显示 confirm command surface
- **THEN** 系统 SHALL NOT 把 `/compact` 写入 transcript 或 input history

#### Scenario: 非纯 /compact 输入回退为普通消息
- **WHEN** 用户提交内容以 `/compact` 开头但还带有其他字符
- **THEN** 系统 SHALL 将该内容视为普通 user message 提交，而不是进入确认框

#### Scenario: response 进行中阻止 /compact
- **WHEN** assistant 正在 thinking 或 streaming，且用户提交纯 `/compact`
- **THEN** 系统 SHALL NOT 进入 `/compact` command session
- **THEN** 系统 SHALL NOT 触发压缩

#### Scenario: 确认后执行手动压缩
- **WHEN** `/compact` confirm surface 活跃且用户按下 Enter
- **THEN** 系统 SHALL 关闭 command session 并恢复普通输入界面
- **THEN** 系统 SHALL 以强制模式触发一次上下文压缩
- **THEN** 压缩期间 SHALL 复用 responding 锁与 working spinner，阻止并发提交

#### Scenario: 取消确认不压缩
- **WHEN** `/compact` confirm surface 活跃且用户按下 Esc
- **THEN** 系统 SHALL 关闭 command session 并恢复普通输入界面
- **THEN** 系统 SHALL NOT 触发压缩

### Requirement: 手动压缩结果反馈
系统 SHALL 在手动压缩结束后给出可见反馈。压缩成功时 SHALL 落盘新压缩状态并追加压缩提示块（复用既有 compaction_notice）。当无有效边界（活跃区间不足以压缩）时 SHALL 追加一条"无需压缩"提示，而非静默结束。压缩失败时 SHALL 追加一条 `error` role transcript record（复用既有失败反馈），并释放 responding 锁。

#### Scenario: 手动压缩成功
- **WHEN** 手动压缩得到有效边界并成功生成摘要
- **THEN** 系统 SHALL 落盘新的压缩状态并追加 compaction_notice 提示块
- **THEN** 系统 SHALL 释放 responding 锁

#### Scenario: 无可压缩内容
- **WHEN** 手动压缩因无有效边界而未发生
- **THEN** 系统 SHALL 追加一条说明"当前无需压缩"的提示
- **THEN** 系统 SHALL NOT 追加错误反馈

#### Scenario: 手动压缩失败
- **WHEN** 手动压缩过程中摘要请求失败
- **THEN** 系统 SHALL 追加一条 `error` role transcript record 说明压缩失败
- **THEN** 系统 SHALL 释放 responding 锁
- **THEN** 系统 SHALL NOT 重试

### Requirement: reasoning summary transcript role
系统 SHALL 支持 `reasoning_summary` transcript role 表示模型返回的 reasoning summary。该 record SHALL 作为可见、可持久化的 append-only transcript content record 参与 session 恢复和当前 app snapshot 重绘，但 SHALL NOT 被视为 assistant final answer、用户消息、本地错误或工具结果。

#### Scenario: 追加 reasoning summary record
- **WHEN** agent loop 收到非空 reasoning summary 并通知 app 层追加记录
- **THEN** 应用 SHALL 追加一条 `role: 'reasoning_summary'` 的 transcript record
- **THEN** 该 record 文本 SHALL 保存 reasoning summary 原文
- **THEN** 应用 SHALL NOT 把该文本合并进 assistant record

#### Scenario: 工具循环中 summary 位于工具记录之前
- **WHEN** 同一 provider turn 同时产生 reasoning summary 和 tool call
- **THEN** 可见 transcript SHALL 先追加 `reasoning_summary` record
- **THEN** 工具执行完成后 SHALL 再追加对应 `tool_call` 与 `tool_result` records

#### Scenario: 最终回复中 summary 位于 assistant 之前
- **WHEN** 同一 provider turn 产生 reasoning summary 且随后完成最终 assistant 回复
- **THEN** 可见 transcript SHALL 先追加 `reasoning_summary` record
- **THEN** 随后追加最终 `assistant` record

#### Scenario: summary record 被持久化和恢复
- **WHEN** 包含 `reasoning_summary` record 的 session 被保存并通过 `/resume` 恢复
- **THEN** 系统 SHALL 恢复该 record
- **THEN** transcript 渲染 SHALL 为该 record 提供可见投影

### Requirement: reasoning summary 可见渲染
系统 SHALL 为 `reasoning_summary` transcript record 提供区别于 user、assistant、error 和 tool result 的低强调可见投影。该投影 SHALL 根据当前 terminal width 和当前 render theme 重新计算，且 SHALL NOT 改变 transcript record 的原始文本。

#### Scenario: 渲染 reasoning summary
- **WHEN** transcript records 包含 `reasoning_summary` record
- **THEN** renderer SHALL 生成低强调的 reasoning summary 消息块
- **THEN** 该消息块 SHALL 使用区别于 assistant final answer 的前缀或 theme 样式
- **THEN** 渲染 SHALL NOT 把该 record 当作 Markdown assistant final message 处理

#### Scenario: resize 后重新投影 reasoning summary
- **WHEN** 当前 transcript records 包含 `reasoning_summary` record，且 terminal columns 变化触发 app snapshot 重绘
- **THEN** reasoning summary SHALL 按新的 terminal width 重新计算可见投影
- **THEN** 重绘 SHALL 使用当前进程 render theme
- **THEN** 重绘 SHALL NOT 删除、隐藏或改写该 summary record

### Requirement: render theme 覆盖历史区和 pending preview
系统 SHALL 在 transcript append、streaming pending preview、tool call preview、shell output preview、destructive resize replay 和 final render 中复用同一个当前进程 render theme。theme SHALL 只影响可见投影，不改变 transcript、pending state 或 tool result 原始数据。

#### Scenario: transcript append 使用当前 theme
- **WHEN** 新 transcript record 被追加并渲染
- **THEN** app renderer SHALL 使用当前 render state 中的 theme 渲染该 record
- **THEN** footer 清理和重绘 SHALL 继续使用同一 theme

#### Scenario: destructive replay 使用当前 theme
- **WHEN** terminal resize 触发 destructive replay
- **THEN** banner、transcript lines 和 footer SHALL 使用同一份当前 render theme 重新投影
- **THEN** replay SHALL NOT 使用旧 ANSI 输出或持久化样式

#### Scenario: pending preview 使用当前 theme
- **WHEN** assistant streaming、tool call preview 或 shell output preview 被渲染
- **THEN** pending preview 的前缀、弱化文本、shell 输出样式和 summary 行 SHALL 使用当前 render theme 中对应 token
- **THEN** pending preview 高度预算、tail collapse 和 markdown projection 语义 SHALL 保持不变

### Requirement: tool block 可配置视觉与固定事实色
系统 SHALL 让 tool call/result 的普通 chrome 视觉使用当前 render theme，同时保持文件修改事实语义色稳定。tool call 符号、成功/失败状态、普通 result 输出和弱化文本 MAY 使用 theme token；apply_patch added/removed 行背景 SHALL 使用代码内固定红绿语义色。

#### Scenario: 通用 tool block 使用 theme
- **WHEN** tool_call 或 tool_result record 渲染为 transcript block
- **THEN** tool call 前缀、成功/失败状态和普通 result 输出 SHALL 使用当前 render theme 中对应 tool token
- **THEN** 渲染 SHALL NOT 改写 tool record text、display metadata 或 toolCallId

#### Scenario: apply_patch 增删背景固定
- **WHEN** apply_patch tool result 包含 added 或 removed 行
- **THEN** added 行 SHALL 使用固定新增语义背景
- **THEN** removed 行 SHALL 使用固定删除语义背景
- **THEN** theme override SHALL NOT 改变这些 added/removed 行背景

### Requirement: MCP command surface 渲染与交互
系统 SHALL 在 footer 临时区域渲染 MCP command surface。该 surface SHALL 遵循现有 footer 局部重绘、宽度裁剪、resize recovery 和非 alternate-screen 约束，并 SHALL 不把 MCP 管理面板内容写入 transcript。

#### Scenario: MCP surface 替换普通 composer footer
- **WHEN** `/mcp` command session 处于活跃状态
- **THEN** footer SHALL 显示 MCP command surface
- **THEN** 普通 composer 输入区和 slash suggestion SHALL 暂时隐藏
- **THEN** transcript 区域 SHALL NOT 追加 MCP surface 内容

#### Scenario: MCP surface 响应 resize
- **WHEN** MCP command surface 可见且 terminal columns 变化或 rows 压缩
- **THEN** 系统 SHALL 按现有 resize recovery 规则重新渲染当前 app snapshot
- **THEN** MCP command surface SHALL 按新宽度重新计算布局并保持可读

#### Scenario: MCP surface 展示操作提示
- **WHEN** MCP command surface 可见
- **THEN** surface SHALL 展示 Space 切换、Enter 保存和 Esc 取消的操作提示
- **THEN** surface SHALL 显示 enabled 计数或等价状态摘要

#### Scenario: MCP 保存诊断使用 transient UI
- **WHEN** `/mcp` 保存后 MCP reload 产生诊断
- **THEN** 系统 SHALL 通过 command surface、info surface 或等价 transient UI 展示诊断摘要
- **THEN** 诊断 SHALL 可关闭并回到普通 composer footer
- **THEN** 诊断 SHALL NOT 作为 transcript block 持久化

### Requirement: Esc 输入分发优先级
TUI SHALL 在处理 Esc 输入时先交给当前活跃的高优先级 surface 或本地运行态；仅当没有此类 surface 消费该 Esc 时，才将 Esc 作为当前 active assistant turn 的中断请求。该优先级 SHALL 覆盖 user question、tool approval、file picker、command surface 和 shell mode 本地命令。

#### Scenario: user question surface 首次消费 Esc
- **WHEN** `ask_user_questions` choice surface 正在显示
- **AND** 用户按下 Esc
- **THEN** TUI SHALL 先把该 Esc 交给 user question surface
- **THEN** TUI SHALL NOT 同时把该 Esc 作为 assistant turn interrupt 处理

#### Scenario: command surface 首次消费 Esc
- **WHEN** slash command、help、model、effort、skills、confirm 或等价 command surface 正在显示
- **AND** 用户按下 Esc
- **THEN** TUI SHALL 先把该 Esc 交给 command surface
- **THEN** TUI SHALL NOT 同时把该 Esc 作为 assistant turn interrupt 处理

#### Scenario: 无 surface 时 Esc 中断 active assistant turn
- **WHEN** assistant turn 仍然 active 且 response lock 被占用
- **AND** 没有 user question、tool approval、file picker、command surface 或正在运行的 shell command
- **AND** 用户按下 Esc
- **THEN** TUI SHALL 请求中断当前 assistant turn

#### Scenario: surface 关闭后二次 Esc 中断 loop
- **WHEN** 一个高优先级 surface 已因第一次 Esc 关闭
- **AND** assistant turn 仍然 active 且 response lock 被占用
- **AND** 用户再次按下 Esc
- **THEN** TUI SHALL 将第二次 Esc 作为当前 assistant turn interrupt 处理

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

### Requirement: 待发送消息遵守 footer 局部重绘和高度不变量
系统 SHALL 将 transient 待发送消息卡片纳入普通 composer footer 的统一 layout。卡片出现、更新或移除 SHALL 使用 footer-only redraw；当 terminal rows 已知时，包含 assistant pending preview、spacer、conversation reference、待发送卡片、composer、suggestions 和 status line 的 footer 总行数 SHALL 不超过 `rows - 2`。系统 SHALL 在写入新帧前按 remembered layout 清除旧 footer，且 SHALL NOT 把卡片追加为 transcript/scrollback 历史输出。

#### Scenario: 卡片出现时只重绘 footer
- **WHEN** assistant response 期间用户成功排队一条消息
- **AND** terminal columns 和 rows 未触发 destructive recovery
- **THEN** renderer SHALL 清除上一帧 footer 并绘制包含待发送卡片的新 footer
- **THEN** renderer SHALL NOT 重新追加 banner 或已提交 transcript blocks

#### Scenario: 卡片出现后 footer 仍有界
- **WHEN** 待发送卡片使 composer input surface 比上一帧更高
- **THEN** renderer SHALL 缩减可裁剪的 assistant pending preview、suggestions 或其他辅助内容
- **THEN** 新 footer layout 总行数 SHALL 不超过 `rows - 2`
- **THEN** 新 footer 的完整顶部 SHALL 保持在可见屏幕内，供下一次局部清理定位

#### Scenario: 卡片移除时清理旧高度
- **WHEN** 用户移除待发送消息且新 footer 比旧 footer 更矮
- **THEN** renderer SHALL 按旧 footer 的 remembered height 清除全部旧卡片行
- **THEN** 重绘后 SHALL NOT 残留待发送标题、预览或样式

#### Scenario: 极小终端保持合法光标和安全宽度
- **WHEN** terminal rows 或 columns 很小且待发送卡片、长 composer 和 streaming preview 同时存在
- **THEN** footer SHALL 裁剪低优先级内容并保持总高度不超过全局预算
- **THEN** 每一可见行 SHALL 不超过 safe render width
- **THEN** composer cursor row SHALL 保持在当前 footer layout 的合法可见范围内

### Requirement: destructive recovery 重放待发送卡片
系统 SHALL 将待发送消息作为当前 footer state 的一部分参与 destructive resize recovery。terminal columns 变化或 rows 变小时，完整快照 SHALL 按新尺寸重新预算并重绘待发送卡片；该重放 SHALL NOT 把待发送消息转换为 transcript record。

#### Scenario: 宽度变化后重新截断预览
- **WHEN** 当前存在待发送消息且 terminal columns 变化触发 destructive recovery
- **THEN** 系统 SHALL 按新 safe render width 重新生成有界消息预览
- **THEN** 完整快照 SHALL 包含待发送卡片、composer 和 status line 的当前状态
- **THEN** 快照 SHALL NOT 残留旧宽度卡片文本或边界

#### Scenario: 行数压缩后重新预算高度
- **WHEN** 当前存在待发送消息且 terminal rows 变小触发 destructive recovery
- **THEN** 系统 SHALL 按新的 `rows - 2` 上限重新预算整个 footer
- **THEN** 待发送消息 SHALL 继续保持 transient，不得因 recovery 写入 transcript journal

### Requirement: composer 以 grapheme cluster 为编辑单元
系统 SHALL 将 composer 的编辑模型与渲染模型统一到 grapheme cluster 粒度。composer 的字符数组元素 SHALL 是 grapheme cluster；光标移动、退格、删除、行内裁剪与自动换行 SHALL 都以 grapheme cluster 边界为准，ZWJ 序列、旗帜 emoji、keycap 和组合字符序列不得被拆散。`@` 文件 mention 的解析索引 SHALL 与 grapheme 数组下标保持一致，高亮范围不被 emoji 或组合序列错位。

#### Scenario: 光标跨过复合 emoji 边界
- **WHEN** composer 文本包含 ZWJ 家族 emoji、旗帜 emoji 或组合字符序列，且用户按左右方向键或退格
- **THEN** 光标 SHALL 按 grapheme cluster 边界移动，一次移动越过整个 cluster
- **THEN** 退格 SHALL 一次性删除整个 cluster，不残留半个 emoji 或孤立变体选择符

#### Scenario: composer 自动换行不拆分 cluster
- **WHEN** composer 文本包含复合 emoji 且当前行接近安全宽度
- **THEN** 自动换行点 SHALL 落在 grapheme cluster 边界，复合 emoji 整体换到下一行
- **THEN** 光标所在行列 SHALL 与该换行规则一致

#### Scenario: @ mention 高亮索引与 grapheme 对齐
- **WHEN** composer 文本包含 `@路径` mention，且 mention 前后存在 emoji 或组合字符
- **THEN** mention 高亮范围 SHALL 与 grapheme 数组下标一致，不因码点/字素计数差异错位

### Requirement: 消息块渲染的 grapheme 一致宽度
用户消息、本地提示、错误块等基于 `renderSymbolMessage` 的整行背景补齐与截断 SHALL 与 `displayWidth` 使用同一 grapheme 切分口径，避免同一文本在不同函数中宽度不一致导致灰底截断或边框错位。

#### Scenario: 复合 emoji 在消息块中宽度一致
- **WHEN** 用户消息或本地提示包含 ZWJ 家族 emoji、旗帜或 keycap
- **THEN** 换行、行尾 padding 与整行背景补齐 SHALL 全部按该 cluster 的同一显示宽度计算
- **THEN** 渲染结果 SHALL 不超过 safe render width，且不出现半截 emoji 或多余 padding


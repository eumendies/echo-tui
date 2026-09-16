## MODIFIED Requirements

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

### Requirement: Plan mode supports readonly workspace inspection
系统 SHALL 在 plan mode 中允许模型使用只读工具和分层约束的 bash 来理解代码库、工作区状态和未提交变更。生效 `read-only` 沙箱可用时，bash 命令可进入执行链路，但工作区写入、网络访问与其他越界效果 SHALL 由内核沙箱边界拒绝；沙箱不可用时，系统 SHALL 只允许命中严格只读 allowlist 的命令。plan mode SHALL 继续禁止实现、修改文件或产生其他副作用。

#### Scenario: Agent can inspect git state in plan mode
- **WHEN** 用户在 plan mode 中要求模型 review 代码变更或制定实现计划
- **THEN** 模型 SHALL 可以通过 plan mode 可用工具读取文件、搜索代码并执行允许的 readonly bash inspection 命令
- **AND** 允许的 bash inspection SHALL 包括常见 git 状态和差异查询，例如 `git status`、`git diff`、`git log`、`git show`、`git rev-parse`、`git branch --show-current`、`git ls-files` 和 `git merge-base`

#### Scenario: Plan mode still forbids execution and mutation
- **WHEN** 用户或模型尝试在 plan mode 中运行会修改工作区、修改 `.git` 状态、安装依赖、运行测试、运行构建、提交代码或执行实现计划的命令
- **THEN** 生效 `read-only` 沙箱可用时，该命令 MAY 进入执行链路，但其工作区写入、网络访问与状态变更 SHALL 被内核沙箱边界拒绝
- **THEN** 生效沙箱不可用时，系统 SHALL 拒绝该命令执行
- **AND** 系统 SHALL 在拒绝时告知需要先退出 plan mode 才能执行该操作

#### Scenario: Plan mode guidance mentions readonly bash boundary
- **WHEN** 系统为 plan mode 构建模型可见的只读约束说明
- **THEN** 该说明 SHALL 描述 bash 分层边界：生效只读沙箱下命令在沙箱内运行，无沙箱时仅允许 readonly inspection allowlist 命令
- **AND** 该说明 SHALL 明确禁止运行测试、构建、安装、提交、切换分支、重置状态或其他可能产生副作用的命令
- **AND** 该说明 SHALL 指引用户通过 `/mode normal` 退出 plan mode

### Requirement: plan mode 只读 agent 边界
系统 SHALL 在 plan mode 的 mode transition 说明中注入 plan-mode 只读约束，并 SHALL 保持 provider-visible tool schema 与 normal mode 一致以稳定 tools schema。plan mode SHALL 允许模型使用只读工具和受分层边界约束的 bash 进行代码和资料探索，但 SHALL 在执行边界禁止写入型工具、MCP 工具与越界 bash 生效。

#### Scenario: plan mode 注入只读约束
- **WHEN** 用户切换到 plan mode 并提交第一条 assistant user message
- **THEN** 该 user record 的 provider-facing text SHALL 包含 plan-mode 只读约束说明
- **THEN** 该说明 SHALL 告知模型当前处于只读探索和规划阶段
- **THEN** 该说明 SHALL 告知模型不能修改文件、应用 patch、提交 commit、安装依赖或执行计划
- **THEN** 该说明 SHALL 描述 shell 命令受生效只读沙箱或严格只读 allowlist 约束
- **THEN** 该说明 SHALL 告知模型如果用户要求执行计划，应提示用户使用 `/mode normal` 退出 plan mode

#### Scenario: plan mode 保持 tools schema 与 normal 一致
- **WHEN** 当前 interaction mode 为 plan，且 agent runtime 初始化 provider tools
- **THEN** provider SHALL 收到与 normal mode 相同的工具定义集合，包含 `run_bash_command` 与 `apply_patch`
- **AND** plan mode 的只读语义 SHALL 由执行前风险分类、沙箱边界与严格 allowlist 强制，SHALL NOT 依赖裁剪 provider-visible tool schema

#### Scenario: normal mode 保持完整工具能力
- **WHEN** 当前 interaction mode 为 normal，且 agent runtime 初始化 provider tools
- **THEN** provider SHALL 收到普通模式既有工具定义
- **THEN** 普通模式 SHALL 保持既有 tool approval、tool result 和 continuation 行为

#### Scenario: plan mode 不执行写入工具
- **WHEN** 当前 interaction mode 为 plan，且 provider 返回写入型 tool call
- **THEN** 系统 SHALL NOT 执行该 tool call
- **THEN** 系统 SHALL 以安全失败结果或本地错误方式继续，不产生文件修改、命令执行或配置写入

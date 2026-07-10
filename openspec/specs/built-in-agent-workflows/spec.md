# built-in-agent-workflows Specification

## Purpose
TBD - created by archiving change add-init-workflow. Update Purpose after archive.
## Requirements
### Requirement: 内置 agent workflow 通过普通 assistant turn 执行
系统 SHALL 支持把内置 slash workflow 转换为 user message 提交结果，并 SHALL 通过现有 app 提交流程启动普通 assistant turn。workflow handler SHALL 只负责命令匹配、模式策略、prompt 创建和 metadata，不得自行执行 agent loop 或 tool continuation。

#### Scenario: 内置 workflow 启动普通 agent 请求
- **WHEN** 用户提交已注册的内置 agent workflow 命令
- **THEN** 对应 handler SHALL 返回 `submit_user_message` 结果
- **THEN** app SHALL 复用普通 user record、assistant lifecycle、streaming 和 tool continuation 路径
- **THEN** command runtime SHALL NOT 增加 workflow 专用 agent 执行分支

#### Scenario: workflow 保留可见命令文本
- **WHEN** 内置 workflow 将 slash 命令转换为内部 prompt
- **THEN** transcript 和输入历史的用户可见文本 SHALL 保留原始 slash 命令
- **THEN** provider 输入 SHALL 使用 workflow 生成的内部任务 prompt

### Requirement: 内置 agent workflow 可扩展定义
系统 SHALL 使用共享 workflow definition 和通用 command handler 注册内置 agent workflow。definition SHALL 至少声明命令名、用户可见描述、参数策略、interaction mode 策略和 prompt factory。新增仅使用这些既有策略的 workflow SHALL NOT 要求修改 command runtime、agent runtime 或 skill registry。

#### Scenario: 注册无参数 workflow
- **WHEN** workflow definition 声明不接受参数
- **THEN** 通用 handler SHALL 只匹配对应的纯 slash 命令
- **THEN** 带额外参数的文本 SHALL NOT 被该 workflow handler 消费

#### Scenario: 未来 workflow 复用通用 handler
- **WHEN** 开发者新增使用现有参数和 mode 策略的 `/review` 等内置 workflow
- **THEN** 开发者 SHALL 能通过新增 definition、prompt 和注册项完成接入
- **THEN** 开发者 SHALL NOT 为该 workflow 复制 command-to-user-message 或 mode 切换实现

### Requirement: workflow metadata 与 skill invocation 分离
系统 SHALL 在 workflow 转换出的 user record metadata 中记录独立的 builtin workflow 标识、workflow 名称和存在时的参数。系统 SHALL NOT 把内置 workflow 标记为 skill invocation。

#### Scenario: /init user record 带 workflow metadata
- **WHEN** `/init` 被转换并追加为 user record
- **THEN** metadata SHALL 标识该记录来自 builtin agent workflow `init`
- **THEN** 该记录 SHALL NOT 包含伪造的 slash skill invocation 标识

### Requirement: /init 分析项目并生成 AGENTS.md
系统 SHALL 提供纯 `/init` 内置 workflow。该 workflow SHALL 基于仓库文件证据分析项目结构、构建与测试命令、开发约束和相关文档；当目标项目根不存在 `AGENTS.md` 时，workflow SHALL 生成简洁的项目级 `AGENTS.md`，并通过现有 `apply_patch` 工具申请创建文件。

#### Scenario: 项目根缺少 AGENTS.md
- **WHEN** 用户提交纯 `/init`
- **AND** workflow 检查确认目标项目根不存在 `AGENTS.md`
- **THEN** agent SHALL 检查仓库中与项目结构、命令、测试和约束相关的文件
- **THEN** agent SHALL 只把可从仓库验证的事实写入拟生成内容
- **THEN** agent SHALL 使用 `apply_patch` 申请在目标项目根创建 `AGENTS.md`

#### Scenario: 创建文件沿用审批和 best effort undo
- **WHEN** `/init` 调用 `apply_patch` 创建 `AGENTS.md`
- **THEN** 系统 SHALL 使用现有 apply-patch 审批 surface 展示目标文件
- **THEN** 用户拒绝时 SHALL NOT 创建文件
- **THEN** 用户允许且写入成功时 SHALL 使用现有 undo checkpoint 记录机制
- **THEN** 系统 SHALL NOT 为保证 `/undo` 可用而禁止 workflow 执行必要的只读仓库分析

#### Scenario: 新文件在后续请求生效
- **WHEN** `/init` 在当前 assistant turn 中成功创建 `AGENTS.md`
- **THEN** 当前已初始化的 agent run SHALL NOT 重新加载该文件
- **THEN** workflow 最终回复 SHALL 说明新指令从下一次 agent 请求开始生效

### Requirement: /init 对已有 AGENTS.md 提供改进建议
当目标项目根已存在 `AGENTS.md` 时，`/init` SHALL 读取该文件并与仓库现状对照，输出具体改进建议。建议 SHALL 区分已有优点、缺失或过时内容，并 SHALL 提供仓库证据、优先级和可采用的修改文案或局部 diff；workflow SHALL NOT 自动修改已有 `AGENTS.md`。

#### Scenario: 已有文件进入评审路径
- **WHEN** 用户提交纯 `/init`
- **AND** workflow 确认目标项目根已存在 `AGENTS.md`
- **THEN** agent SHALL 读取现有文件并检查相关仓库证据
- **THEN** agent SHALL 输出按优先级排列的改进建议
- **THEN** agent SHALL NOT 调用 `apply_patch` 修改该 `AGENTS.md`

#### Scenario: 现有文件无需明显改进
- **WHEN** 现有 `AGENTS.md` 与已检查的仓库证据一致且没有重要缺失
- **THEN** agent SHALL 明确说明未发现需要优先修改的问题
- **THEN** agent SHALL NOT 为了产生输出而编造规范或建议

### Requirement: /init 从 plan mode 切换到 normal
当 `/init` 在 plan interaction mode 下启动时，workflow handler SHALL 在提交 agent turn 前通过 `CommandHost.mode` 将当前 mode 切换为 normal。该切换 SHALL 作用于当前 `/init` turn 和后续交互，workflow 完成后 SHALL NOT 自动恢复 plan。

#### Scenario: plan mode 启动 /init
- **WHEN** 当前 interaction mode 为 plan 且用户提交纯 `/init`
- **THEN** workflow handler SHALL 先调用受控 mode 能力切换到 normal
- **THEN** `/init` assistant turn SHALL 使用 normal mode 工具边界

#### Scenario: 非 plan mode 不做额外切换
- **WHEN** 当前 interaction mode 不是 plan 且用户提交纯 `/init`
- **THEN** workflow handler SHALL NOT 为 `/init` 执行额外 mode 切换

### Requirement: /init 是优先于同名 skill 的内置命令
系统 SHALL 在通用 direct skill invocation fallback 之前注册 `/init` workflow handler。`/init` SHALL NOT 进入 skill discovery、skill enablement 或项目级 skill 覆盖规则。

#### Scenario: 同名 skill 不覆盖 /init
- **WHEN** 当前用户级或项目级 skill catalog 包含名为 `init` 的 skill
- **AND** 用户提交纯 `/init`
- **THEN** 系统 SHALL 启动内置 `/init` workflow
- **THEN** 系统 SHALL NOT 把该输入作为 direct skill invocation

### Requirement: /review 审查当前工作区代码变更
系统 SHALL 提供纯 `/review` 内置 workflow。该 workflow SHALL 以当前 Git 工作区相对 `HEAD` 的 staged、unstaged 和 untracked 变化为审查范围，并 SHALL 读取必要的未修改代码、测试、配置和文档来理解变更影响。workflow SHALL NOT 修改代码或报告与当前变更无直接关系的存量问题。

#### Scenario: 工作区存在可审查变更
- **WHEN** 用户提交纯 `/review`
- **AND** 当前 Git 工作区包含 staged、unstaged 或 untracked 变化
- **THEN** agent SHALL 建立完整变更清单并检查对应 diff 或文件内容
- **THEN** agent SHALL 读取验证变更行为所需的相关上下文
- **THEN** agent SHALL NOT 调用 `apply_patch` 或执行修改项目文件的命令

#### Scenario: 工作区没有变更
- **WHEN** 用户提交纯 `/review`
- **AND** 当前 Git 工作区相对 `HEAD` 没有可审查变化
- **THEN** agent SHALL 明确说明没有可审查的当前代码变更
- **THEN** agent SHALL NOT 转而审查无关存量代码

#### Scenario: 当前目录不是 Git 工作区
- **WHEN** 用户提交纯 `/review`
- **AND** agent 无法确认当前目录属于 Git 工作区
- **THEN** agent SHALL 明确说明无法确定 review 基线
- **THEN** agent SHALL NOT 猜测文件范围或生成推测性 findings

### Requirement: /review 按务实 code review 方式发现问题
`/review` SHALL 像务实 code reviewer 一样审查当前变更，聚焦 maintainer 会要求合入前修复的 actionable issues，包括正确性、回归、破坏契约、边界条件、错误处理、安全或数据丢失风险，以及具有具体影响的维护性问题。agent SHALL 阅读足够上下文来理解行为和影响，但 SHALL NOT 为了形式完整而穷尽全仓库、强制检查架构或风格分类，或输出与当前变更无关的存量问题。

#### Scenario: 聚焦当前变更和必要上下文
- **WHEN** agent 分析当前代码变更
- **THEN** agent SHALL 先理解 changed files、diff 和变更意图
- **THEN** agent SHALL 在有助于理解行为或影响时读取周边代码、调用方、类型、测试、配置、文档或 AGENTS.md 约束
- **THEN** agent SHALL NOT 为了完整性穷尽映射整个仓库

#### Scenario: 只报告 actionable issues
- **WHEN** agent 准备报告一个候选问题
- **THEN** 候选问题 SHALL 由当前变更新增或直接暴露
- **THEN** 候选问题 SHALL 具有现实触发条件、破坏契约、用户可见影响或具体维护成本之一
- **THEN** agent SHALL NOT 把缺失测试本身、纯格式偏好、命名偏好、宽泛重构建议或无明确影响的 nit 作为 finding 输出

#### Scenario: 按需要做针对性验证
- **WHEN** agent 发现 plausible candidate finding
- **THEN** agent SHALL 通过代码路径、既有测试或类型、配置，或便宜且有用的 targeted command 来支撑判断
- **THEN** agent SHALL NOT 要求每个 finding 都运行测试
- **THEN** agent SHALL NOT 为了显得完整而默认运行宽泛验证命令

#### Scenario: 验证命令失败但无法归因
- **WHEN** agent 运行测试、类型检查或诊断命令且命令失败
- **AND** 失败无法被确认由当前变更引起
- **THEN** agent SHALL NOT 把该失败作为代码 finding
- **THEN** agent MAY 在结果中简要说明该验证未完成

### Requirement: /review 使用严重级别并排序 findings
`/review` SHALL 使用 `P0`、`P1`、`P2`、`P3` 标记 findings。每个 finding SHALL 包含严重级别、文件和行号、问题、影响，以及明显时的简洁修复方向。结果 SHALL findings-first，并 SHALL 按 P0 到 P3 排列；同级 finding SHALL 优先排列正确性问题，再按影响和置信度排列。

#### Scenario: 输出多个不同严重级别的问题
- **WHEN** agent 验证出多个 findings
- **THEN** agent SHALL 按 `P0`、`P1`、`P2`、`P3` 的顺序输出
- **THEN** 每个 finding SHALL 包含当前变更中的文件位置和行号
- **THEN** 每个 finding SHALL 描述问题、影响和明显时的简洁修复方向

#### Scenario: 仅存在低影响风格候选项
- **WHEN** agent 只发现纯格式偏好、命名偏好或没有明确维护影响的 nit
- **THEN** agent SHALL NOT 输出 `P3` finding
- **THEN** agent SHALL NOT 为了填充严重级别而提升问题等级

#### Scenario: 没有达到门槛的问题
- **WHEN** agent 未发现 actionable issue
- **THEN** agent SHALL 简短输出未发现 actionable issues
- **THEN** agent MAY 用至多一句话说明检查范围
- **THEN** agent SHALL NOT 输出推测性建议替代 findings

### Requirement: /review 从 plan mode 切换到 normal
当 `/review` 在 plan interaction mode 下启动时，workflow handler SHALL 在提交 agent turn 前将当前 mode 切换为 normal，使该 turn 能执行必要的测试和项目诊断。该切换 SHALL NOT 改变 `/review` 只审查、不修改代码的行为边界。

#### Scenario: plan mode 启动 /review
- **WHEN** 当前 interaction mode 为 plan 且用户提交纯 `/review`
- **THEN** workflow handler SHALL 在提交 agent turn 前切换到 normal
- **THEN** `/review` SHALL 能使用 normal mode 下的验证工具
- **THEN** `/review` SHALL NOT 因 mode 切换而修改项目代码

### Requirement: /review 是优先于同名 skill 的内置命令
系统 SHALL 在通用 direct skill invocation fallback 之前注册 `/review` workflow handler。`/review` SHALL NOT 进入 skill discovery、skill enablement 或项目级 skill 覆盖规则。

#### Scenario: 同名 skill 不覆盖 /review
- **WHEN** 当前用户级或项目级 skill catalog 包含名为 `review` 的 skill
- **AND** 用户提交纯 `/review`
- **THEN** 系统 SHALL 启动内置 `/review` workflow
- **THEN** 系统 SHALL NOT 把该输入作为 direct skill invocation

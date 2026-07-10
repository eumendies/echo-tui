## ADDED Requirements

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

# tool-approval Specification

## Purpose
定义本地工具执行前的用户授权拦截、授权决策和拒绝结果语义，第一版覆盖 `apply_patch` 写文件工具。
## Requirements
### Requirement: apply_patch 执行前授权
在交互式 TUI 或默认单轮模式下，系统 SHALL 在执行本地 `apply_patch` 工具前完成授权决策。交互式 TUI 的 manual 审批模式 SHALL 请求用户授权；auto 审批模式 SHALL 在未命中会话授权缓存时先请求配置的审批模型，模型精确返回 yes 时可自动允许本次执行，返回 no 或失败时 SHALL 回退相同的用户授权 surface。授权发生在 tool executor 调用具体 handler 之前；用户允许时 SHALL 执行本次工具调用，用户拒绝或提交反馈文本时 SHALL NOT 执行工具，并 SHALL 生成可回传模型的 tool result。MCP tools SHALL 根据 server 审批策略复用同一授权流程：默认需要审批，显式信任的 server 可跳过授权。通过 `run_bash_command` 执行的 agent memory skill 脚本 SHALL NOT 获得 memory 专属审批分类，只按现有通用 bash 风险规则处理。`echo-tui --once --full-access` 是显式非交互例外：对当前单轮中被风险分类为 approval-required 的已注册工具 SHALL 自动允许，不得等待 UI 或请求自动审批模型。

#### Scenario: apply_patch 执行前完成授权
- **WHEN** 交互式 TUI 或默认单轮 agent loop runtime 收到工具名为 `apply_patch` 的 tool call
- **THEN** 系统 SHALL 在调用 tool executor 执行该 tool call 前取得允许或拒绝决策
- **THEN** 交互式 manual 模式 SHALL 使用通用 choice surface 显示该授权请求
- **THEN** 交互式 auto 模式 SHALL 按 automatic-tool-approval 能力先判断是否可自动 `allow_once`
- **THEN** 默认单轮模式 SHALL 返回非交互失败结果而不是等待 surface 输入或请求自动审批模型

#### Scenario: Memory skill 脚本不触发专属授权
- **WHEN** normal mode 下 `run_bash_command` 执行未命中通用高风险规则的 `agent-memory` 脚本命令
- **THEN** classifier SHALL 按普通安全 bash 命令处理
- **THEN** 系统 SHALL NOT 因命令读取或修改 memory 而打开专属审批 surface或请求自动审批模型

#### Scenario: MCP tool 默认执行前完成审批
- **WHEN** 交互式 TUI 或默认单轮 agent loop runtime 收到未显式信任 server 的 MCP tool call
- **THEN** 交互式 TUI SHALL 在调用 MCP server 前按当前工具审批模式取得授权决策
- **THEN** 默认单轮模式 SHALL 生成失败 tool result 而不是等待用户选择或请求自动审批模型

#### Scenario: 用户允许本次执行
- **WHEN** `apply_patch` 或 MCP tool 授权请求处于活跃状态且用户选择 `Allow once`
- **THEN** 系统 SHALL 执行该次 tool call
- **THEN** 系统 SHALL 将真实工具执行结果作为对应的 tool result 回传给模型

#### Scenario: 用户拒绝本次执行
- **WHEN** `apply_patch` 或 MCP tool 授权请求处于活跃状态且用户选择 `Deny` 或按下 Esc
- **THEN** 系统 SHALL NOT 执行该次 tool call
- **THEN** 系统 SHALL 生成 `ok: false` 的 tool result
- **THEN** 该 tool result SHALL 保留原始 tool call id 和 tool name
- **THEN** 该 tool result 文本 SHALL 明确说明用户拒绝执行该工具

#### Scenario: 用户提供反馈文本
- **WHEN** `apply_patch` 或 MCP tool 授权请求处于活跃状态且用户通过 `Tell model what to do` 提交非空文本
- **THEN** 系统 SHALL NOT 执行该次 tool call
- **THEN** 系统 SHALL 生成可回传模型的失败 tool result
- **THEN** 该 tool result 文本 SHALL 包含用户输入的反馈文本

#### Scenario: 受信任 MCP tool 不触发授权
- **WHEN** agent loop runtime 收到显式信任 server 的 MCP tool call
- **THEN** 系统 SHALL 按现有工具执行流程执行该 tool call
- **THEN** 系统 SHALL NOT 为该 MCP tool call 请求自动审批模型或用户选择

#### Scenario: 不需要风险分类授权的工具不触发授权
- **WHEN** agent loop runtime 收到不需要风险分类授权的 tool call
- **THEN** 系统 SHALL 按现有工具执行流程执行该 tool call
- **THEN** 系统 SHALL NOT 因工具审批能力请求自动审批模型或用户选择

#### Scenario: 非 bash 授权选项保持简洁
- **WHEN** `apply_patch` 的人工授权 choice surface 显示
- **THEN** 选项列表 SHALL 包含 `Allow once`、会话级 allow、`Allow all tools for this session`、`Deny` 和 `Tell model what to do`
- **THEN** 系统 SHALL NOT 为 `Allow once` 或 `Deny` 生成冗长的 option description

#### Scenario: full-access 自动允许 approval-required 工具
- **WHEN** 用户使用 `echo-tui --once --full-access <prompt>` 且 agent 请求 approval-required 的已注册工具
- **THEN** 系统 SHALL NOT 打开 TUI approval surface、等待 stdin 或请求自动审批模型
- **THEN** 系统 SHALL 直接执行该工具并把真实结果回传给模型
- **THEN** 该自动允许策略 SHALL 只影响当前单轮运行

#### Scenario: full-access 不改变普通 TUI 授权
- **WHEN** 用户未使用 `echo-tui --once --full-access` 而在普通 TUI 中请求 approval-required 工具
- **THEN** 系统 SHALL 根据工具审批模式使用 manual surface，或先执行 auto 判断并在 no/失败时回退同一 surface
- **THEN** 系统 SHALL 继续使用现有结构化授权决策和会话授权缓存

### Requirement: 工具授权决策模型
系统 SHALL 使用结构化工具授权决策表示用户选择。决策模型 SHALL 支持允许本次执行、拒绝本次执行、提供文本反馈、允许当前会话内同名非 bash 工具、允许当前会话内同一 bash command，以及允许当前会话内所有需审批工具调用。系统 SHALL NOT 依赖 boolean 作为唯一授权协议。

#### Scenario: 允许本次执行决策
- **WHEN** 用户选择允许当前工具调用
- **THEN** 系统 SHALL 将该选择表示为允许本次执行的结构化决策
- **THEN** agent loop runtime SHALL 根据该决策继续执行原始 tool call

#### Scenario: 拒绝本次执行决策
- **WHEN** 用户选择拒绝当前工具调用或按 Esc
- **THEN** 系统 SHALL 将该选择表示为拒绝执行的结构化决策
- **THEN** agent loop runtime SHALL 根据该决策跳过原始 tool call 执行并创建拒绝 tool result

#### Scenario: 提供文本反馈决策
- **WHEN** 用户在工具授权请求中提交非空反馈文本
- **THEN** 系统 SHALL 将该选择表示为 `provide_feedback` 结构化决策
- **THEN** 该决策 SHALL 包含用户输入的反馈 message
- **THEN** agent loop runtime SHALL 根据该决策跳过原始 tool call 执行并创建反馈 tool result

#### Scenario: 允许同名非 bash 工具的会话级决策
- **WHEN** 用户选择允许当前会话内同名非 bash 工具调用
- **THEN** 系统 SHALL 将该选择表示为包含 tool name 的结构化决策
- **THEN** `ToolApprovalContext` SHALL 能够基于该 tool name 复用本会话授权

#### Scenario: 允许同一 bash command 的会话级决策
- **WHEN** 用户选择允许当前会话内同一 bash command
- **THEN** 系统 SHALL 将该选择表示为包含 `run_bash_command` 和 command 文本的结构化决策
- **THEN** `ToolApprovalContext` SHALL 能够基于该 command 文本复用本会话授权

#### Scenario: 允许所有需审批工具的会话级决策
- **WHEN** 用户选择允许当前会话内所有需审批工具调用
- **THEN** 系统 SHALL 将该选择表示为允许所有工具的结构化决策
- **THEN** `ToolApprovalContext` SHALL 能够基于该决策复用本会话授权

### Requirement: 工具授权会话级允许选项
工具授权 choice surface SHALL 提供会话级允许选项。所有 allow 选项 SHALL 在选项列表中连续排列，并 SHALL 出现在 `Deny` 和 `Tell model what to do` 之前。`ToolApprovalContext` SHALL 持有当前 CLI 进程会话内的授权缓存；会话级允许选项 SHALL 只影响当前 CLI 进程会话，SHALL NOT 写入 transcript、持久化 session 或用户配置。

#### Scenario: 显示 allow 选项分组
- **WHEN** tool approval 请求处于活跃状态
- **THEN** choice surface SHALL 依次显示 `Allow once`、一个会话级 allow 选项、`Allow all tools for this session`
- **THEN** `Deny` SHALL 显示在所有 allow 选项之后
- **THEN** `Tell model what to do` SHALL 继续显示为支持内联文本输入的 option

#### Scenario: 非 bash 工具显示 tool 级授权
- **WHEN** `apply_patch` 或其他非 `run_bash_command` 的 tool approval 请求处于活跃状态
- **THEN** 会话级 allow 选项 SHALL 使用当前 tool name 表达 `Allow <toolName> for this session`
- **THEN** 用户选择该选项 SHALL 生成允许当前会话内同名工具的结构化授权决策

#### Scenario: bash 工具显示 command 级授权
- **WHEN** `run_bash_command` tool approval 请求处于活跃状态
- **THEN** 会话级 allow 选项 SHALL 显示为 `Allow this command for this session`
- **THEN** 用户选择该选项 SHALL 生成只允许当前 bash command 文本的结构化授权决策

#### Scenario: 允许所有工具的会话级授权
- **WHEN** tool approval 请求处于活跃状态
- **AND** 用户选择 `Allow all tools for this session`
- **THEN** 系统 SHALL 生成允许当前会话内所有后续需审批工具调用的结构化授权决策

#### Scenario: 命中会话授权时不打开 surface
- **WHEN** `ToolApprovalContext` 收到 tool approval 请求
- **AND** 该请求命中当前 CLI 进程会话内已有授权缓存
- **THEN** `ToolApprovalContext` SHALL 立即返回允许执行的结构化授权决策
- **THEN** TUI SHALL NOT 打开 tool approval choice surface

### Requirement: 工具授权 permission gate 展示
工具授权 UI SHALL 使用通用 choice card 呈现 permission gate。该 surface SHALL 突出授权标题、command 或 tool preview 区块、action 选项区和操作提示，并 SHALL 使用项目现有终端渲染能力完成，不引入全屏 UI、alternate screen 或第三方 TUI 库。MCP tool 授权 SHALL 展示 MCP server 名、原始 tool 名和参数摘要，避免只显示内部 namespace。

#### Scenario: 高危 bash 授权显示 permission gate
- **WHEN** 高危 bash tool call 需要用户授权
- **THEN** 授权 surface SHALL 显示 `PERMISSION` 或等价明确授权标题
- **THEN** 授权 surface SHALL 显示 code-like command 区块
- **THEN** 授权 surface SHALL 显示 action 选项区
- **THEN** 授权 surface SHALL 显示确认、移动和取消相关操作提示

#### Scenario: MCP 授权显示 server 和 tool preview
- **WHEN** MCP tool call 需要用户授权
- **THEN** 授权 surface SHALL 显示 `PERMISSION` 或等价明确授权标题
- **THEN** 授权 surface SHALL 显示 MCP server 名称和原始 MCP tool 名称
- **THEN** 授权 surface SHALL 显示参数摘要或可读 preview
- **THEN** 授权 surface SHALL 显示 action 选项区和操作提示

#### Scenario: command preview 使用突出代码区块
- **WHEN** 授权请求包含 command 文本
- **THEN** 授权 surface SHALL 将 command 文本放在独立视觉区块中
- **THEN** command 文本 SHALL 比普通说明文本更醒目
- **THEN** command 文本 SHALL 保持纯文本宽度可计算，不得因 ANSI 样式破坏布局

#### Scenario: action 选项保留现有授权语义
- **WHEN** tool approval 请求处于活跃状态
- **THEN** action 选项 SHALL 继续包含 `Allow once`、会话级 allow、`Allow all tools for this session`、`Deny` 和 `Tell model what to do`
- **THEN** 所有 allow 选项 SHALL 继续出现在 `Deny` 和 `Tell model what to do` 之前
- **THEN** 用户选择任一选项后 SHALL 继续生成现有结构化授权决策

#### Scenario: 高危 bash 授权不显示系统 reason
- **WHEN** 高危 bash tool call 需要用户授权
- **THEN** 授权 surface SHALL NOT 显示系统风险分类生成的 reason 文案
- **THEN** 授权 surface SHALL 让用户基于 command preview 自行判断是否允许执行

### Requirement: apply_patch 删除授权 preview
工具授权 permission gate SHALL 在 `apply_patch` 请求包含删除文件操作时显示明确的删除 preview。该 preview SHALL 使用轻量 patch header 扫描或等价机制生成，并 SHALL 只作为用户识别风险的展示信息；最终安全校验仍由 `apply_patch` handler 在执行阶段完成。

#### Scenario: Begin Patch 删除显示删除标记
- **WHEN** `apply_patch` 授权请求的 patch 包含 `*** Delete File: <path>`
- **THEN** permission gate SHALL 在 tool preview 中显示该路径
- **THEN** permission gate SHALL 使用 `delete <path>`、`- <path>` 或等价破坏性标记突出该文件会被删除
- **THEN** permission gate SHALL NOT 只以普通路径摘要展示该文件

#### Scenario: unified diff 删除显示删除标记
- **WHEN** `apply_patch` 授权请求的 patch 包含 `--- a/<path>` 到 `+++ /dev/null` 的删除文件语义
- **THEN** permission gate SHALL 在 tool preview 中显示该路径
- **THEN** permission gate SHALL 使用 `delete <path>`、`- <path>` 或等价破坏性标记突出该文件会被删除
- **THEN** permission gate SHALL NOT 只以普通路径摘要展示该文件

#### Scenario: 删除 preview 不改变授权决策语义
- **WHEN** `apply_patch` 删除授权 preview 显示在 permission gate 中
- **THEN** action 选项 SHALL 继续包含现有 allow、deny 和反馈选项
- **THEN** 用户选择任一选项后 SHALL 继续生成现有结构化授权决策
- **THEN** handler SHALL 在用户允许后重新执行完整解析、校验和写盘流程

#### Scenario: 删除 preview 遵守高度预算
- **WHEN** `apply_patch` 授权请求包含多个删除文件或很长路径
- **THEN** permission gate SHALL 继续遵守 footer 全局高度预算
- **THEN** preview SHALL 可被裁剪或摘要化
- **THEN** 被裁剪或摘要化时 SHALL 保留至少一个可见的删除标记或等价删除摘要

### Requirement: 工具授权详情高度受限
工具授权 permission gate SHALL 遵守 footer 全局高度预算。高危 bash command preview 很长时，授权 UI SHALL 裁剪或摘要化长内容，并 SHALL 显示 `truncated`、省略号或等价提示，同时保留用户作出决策所需的标题、授权选项、拒绝路径和操作提示。当高度足以容纳所有授权 option 行时，preview SHALL 让位给全部授权选项。

#### Scenario: 长 bash command 审批不进入 scrollback
- **WHEN** 高危 `run_bash_command` 授权请求包含很长的 command preview
- **AND** terminal rows 已知
- **THEN** 授权 permission gate SHALL 在 footer 高度预算内渲染
- **THEN** footer layout 的总行数 SHALL 不超过 `rows - 2`
- **THEN** 后续 footer redraw SHALL 能清理旧授权 surface 的全部可见内容

#### Scenario: 长审批详情仍保留安全决策信息
- **WHEN** 高危 bash 授权详情因高度预算被裁剪
- **THEN** 授权 permission gate SHALL 继续显示授权标题
- **THEN** 授权 permission gate SHALL 显示详情被裁剪的可见提示
- **THEN** 授权 permission gate SHALL 在高度足够时显示全部允许、拒绝和反馈相关选项
- **THEN** 用户 SHALL 仍能通过 `Deny` 或 Esc 拒绝该工具调用

#### Scenario: apply_patch 简洁授权仍受高度约束
- **WHEN** `apply_patch` 授权请求没有 command preview
- **THEN** 授权 permission gate SHALL 继续显示简洁授权选项
- **THEN** 授权 permission gate SHALL 仍遵守 footer 全局高度预算

### Requirement: 工具授权文本反馈选项
工具授权 choice surface SHALL 提供 `Tell model what to do` 选项，允许用户在同一个授权面板内输入反馈文本并回传给模型。该反馈 SHALL 使用结构化 `provide_feedback` 决策表达。

#### Scenario: 显示文本反馈选项
- **WHEN** tool approval 请求处于活跃状态
- **THEN** choice surface SHALL 显示 `Allow once`、会话级 allow、`Allow all tools for this session`、`Deny` 和 `Tell model what to do` 选项
- **THEN** `Tell model what to do` SHALL 是支持内联文本输入的 option

#### Scenario: 提交文本反馈
- **WHEN** tool approval 请求处于活跃状态
- **AND** 用户选中 `Tell model what to do`
- **AND** 用户输入非空文本并按 Enter
- **THEN** 系统 SHALL NOT 执行原始 tool call
- **THEN** 系统 SHALL 生成 `provide_feedback` 授权决策
- **THEN** 该决策的 message SHALL 等于用户输入文本

#### Scenario: 文本反馈只包含用户输入
- **WHEN** 用户通过 `Tell model what to do` 提交反馈文本
- **THEN** 回传给模型的反馈 SHALL 只包含用户输入文本
- **THEN** 回传给模型的反馈 SHALL NOT 自动包含系统风险分类信息

### Requirement: 会话授权优先于自动审批
交互式工具审批 SHALL 在发起自动审批模型请求或打开人工 surface 前检查现有进程会话授权缓存。Auto 模型产生的 yes SHALL 只允许当前调用，不得写入该缓存；只有用户通过现有人工 surface 作出的会话级 allow 决策可以扩展后续调用权限。

#### Scenario: Allow-all 缓存跳过 auto 请求
- **WHEN** 当前进程已启用 `Allow all tools for this session`
- **AND** 后续 tool call 被分类为 `approval_required`
- **THEN** 系统 SHALL 立即返回现有 allow-all 结构化决策
- **THEN** 系统 SHALL NOT 请求自动审批模型或打开人工 surface

#### Scenario: Tool 缓存跳过 auto 请求
- **WHEN** 当前进程已允许某个非 bash tool name 在本会话执行
- **AND** 后续同名 tool call 被分类为 `approval_required`
- **THEN** 系统 SHALL 立即返回现有 tool 级允许决策
- **THEN** 系统 SHALL NOT 请求自动审批模型或打开人工 surface

#### Scenario: Bash command 缓存跳过 auto 请求
- **WHEN** 当前进程已允许某个 bash command 文本在本会话执行
- **AND** 后续相同 command 被分类为 `approval_required`
- **THEN** 系统 SHALL 立即返回现有 command 级允许决策
- **THEN** 系统 SHALL NOT 请求自动审批模型或打开人工 surface

#### Scenario: Auto yes 不形成会话授权
- **WHEN** 自动审批模型为一个 approval-required 调用精确返回 yes
- **THEN** 系统 SHALL 只为当前调用生成 `allow_once`
- **THEN** 后续同名工具或相同 bash command SHALL 在缓存仍未命中时重新进入 auto 判断

### Requirement: Auto no 复用现有人工授权 surface
自动审批模型返回 no、返回非法文本或请求失败后，系统 SHALL 使用与 manual 模式相同的 `ToolApprovalContext`、permission choice surface 和结构化授权决策，不得创建降级版审批界面或删除现有操作。

#### Scenario: Auto no 显示现有操作
- **WHEN** 自动审批结果为 no 且人工授权 surface 打开
- **THEN** action 选项 SHALL 继续包含 `Allow once`、适用的会话级 tool/command allow、`Allow all tools for this session`、`Deny` 和 `Tell model what to do`
- **THEN** 所有选项 SHALL 继续生成现有结构化 `ToolApprovalDecision`

#### Scenario: Auto no 保留 feedback 输入
- **WHEN** 自动审批结果为 no 且用户选中 `Tell model what to do`
- **THEN** 用户 SHALL 能按现有 inline composer 语义输入非空反馈
- **THEN** 系统 SHALL 继续生成 `provide_feedback` 决策并跳过原始工具执行

#### Scenario: Auto no 保留 Esc 拒绝
- **WHEN** 自动审批结果为 no 且 permission surface 处于活跃状态
- **AND** 用户按下 Esc
- **THEN** 系统 SHALL 按现有语义拒绝原始 tool call
- **THEN** 系统 SHALL 生成可回传主模型的失败 tool result

## ADDED Requirements

### Requirement: 工具授权 permission gate 展示
工具授权 UI SHALL 使用通用 choice card 呈现 permission gate。该 surface SHALL 突出授权标题、command 区块、action 选项区和操作提示，并 SHALL 使用项目现有终端渲染能力完成，不引入全屏 UI、alternate screen 或第三方 TUI 库。

#### Scenario: 高危 bash 授权显示 permission gate
- **WHEN** 高危 bash tool call 需要用户授权
- **THEN** 授权 surface SHALL 显示 `PERMISSION` 或等价明确授权标题
- **THEN** 授权 surface SHALL 显示 code-like command 区块
- **THEN** 授权 surface SHALL 显示 action 选项区
- **THEN** 授权 surface SHALL 显示确认、移动和取消相关操作提示

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

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: 工具授权展示风险详情
**Reason**: 固定规则生成的风险原因无法可靠解释复杂 shell command，展示出来容易误导用户；新的 permission gate 以 command preview 和明确 action 选项为主要判断依据。

**Migration**: 使用 `工具授权 permission gate 展示` 要求替代。风险分类仍决定是否需要授权，但 UI 不再展示系统 reason 文案。

## ADDED Requirements

### Requirement: Subagent 投影按实际 Agent 身份显示
Subagent rail、footer pending、用户问题surface、审批surface和外层`run_subagent`紧凑结果 SHALL使用当前run的`agentName`或外层调用中的`agent`参数投影身份。通用工具显示名 SHALL NOT把`run_subagent`固定命名为Explorer；无法安全解析Agent名称时 SHALL使用通用`Run subagent`回退。

#### Scenario: Worker 状态使用 Worker 身份
- **WHEN** Worker运行产生start、内部工具、用户问题、审批和completed事件
- **THEN** 对应rail、footer和modal标题 SHALL显示Worker身份
- **THEN** 外层成功pair SHALL显示Worker完成任务的紧凑状态且不重复最终正文

#### Scenario: Explorer 投影不回归
- **WHEN** Explorer运行完成
- **THEN** rail和外层紧凑pair SHALL继续显示Explorer身份
- **THEN** renderer SHALL NOT因支持Worker而改变Explorer内部工具的muted tone和宽度规则

### Requirement: Worker 用户问题活动受 run identity 隔离
Worker等待`ask_user_questions`时 SHALL把Subagent transient phase更新为`waiting_question`，再由共享choice surface接管footer和输入。问题结束且父turn与Worker run仍有效时 SHALL恢复Worker活动；运行取消或失效后的问题、答案和迟到callback SHALL NOT污染新turn或其他Subagent运行。

#### Scenario: Worker 问题接管并恢复 footer
- **WHEN** 当前Worker发起合法`ask_user_questions`
- **THEN** 系统 SHALL校验Worker run identity后显示带Worker身份的choice surface
- **THEN** 用户提交或取消后tool result SHALL返回当前Worker continuation
- **THEN** 父turn仍有效时footer SHALL恢复Worker后续活动

#### Scenario: 陈旧 Worker 问题被拒绝
- **WHEN** Worker所属父turn已结束、取消或当前run identity已变化
- **THEN** 系统 SHALL NOT打开或更新用户问题surface
- **THEN** 迟到答案 SHALL NOT追加Subagent records、改变response lock或进入新turn

### Requirement: 子 Agent 外层轨道使用专属主题 token
子 Agent过程块的最外层marker、连续rail和Agent标题 SHALL使用当前render theme的`subagentRail` blocks token，而 SHALL NOT借用顶层`tool`强调色。内部工具标题、状态、prefix、正文以及reasoning/assistant/阶段文本 SHALL继续统一映射`toolOutput`。顶层普通工具与footer其它surface SHALL保持现有颜色行为。

#### Scenario: 子 Agent 轨道与标题使用专属色
- **WHEN** 系统渲染任意Explorer或Worker过程块
- **THEN** 最外层marker、连续rail和Agent标题 SHALL使用`subagentRail`主题token
- **THEN** 内部嵌套工具内容 SHALL继续使用`toolOutput`暗色语义

#### Scenario: 顶层工具颜色不回归
- **WHEN** 主Agent普通工具call/result不位于子Agent rail内
- **THEN** renderer SHALL继续使用现有顶层工具语义色
- **THEN** `subagentRail` token SHALL NOT改变顶层工具、banner、footer或其它transcript block的颜色

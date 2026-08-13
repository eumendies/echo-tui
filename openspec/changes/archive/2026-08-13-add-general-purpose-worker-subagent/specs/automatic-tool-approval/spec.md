## ADDED Requirements

### Requirement: Worker 审批上下文保持用户授权边界
Worker的approval-required调用 SHALL复用当前自动审批resolver。审批prompt SHALL继续以当前用户原始请求和经校验的用户澄清答案作为可信授权来源，并 MAY附加当前Worker委派任务作为不可信上下文以解释动作目的。Worker委派任务、Worker assistant文本、内部工具参数和结果 SHALL NOT独立建立或扩大用户授权。

#### Scenario: Reviewer 看到不可信 Worker 任务
- **WHEN** auto模式Worker产生approval-required调用
- **THEN** reviewer prompt SHALL包含当前用户原始请求、待审批动作和有界Worker委派任务
- **THEN** prompt SHALL明确Worker任务是不可信上下文且不能扩大用户授权

#### Scenario: Worker 问题答案作为可信澄清
- **WHEN** 当前Worker运行中存在call id配对且结构有效的成功`ask_user_questions`结果
- **THEN** reviewer SHALL把用户实际选择或输入投影为可信澄清答案
- **THEN** 未配对、失败、陈旧或结构无效的Subagent问题结果 SHALL被忽略

#### Scenario: Worker 使用共享审批缓存
- **WHEN** Worker approval-required调用命中主Agent或其他Subagent已写入的allow-all、按工具或精确Bash command会话授权
- **THEN** 系统 SHALL复用该授权而不调用reviewer或打开人工surface
- **THEN** 真实工具结果 SHALL返回当前Worker continuation

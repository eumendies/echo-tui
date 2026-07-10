## ADDED Requirements

### Requirement: 默认 slash command 集合注册内置 agent workflows
系统 SHALL 在默认 slash command handlers 中注册内置 agent workflow handlers，并 SHALL 将它们排列在通用 direct skill invocation fallback 之前。workflow handler SHALL 复用现有 `submit_user_message` 结果和 `CommandHost` 受控能力。

#### Scenario: 默认 handlers 包含 /init workflow
- **WHEN** 系统创建默认 slash command handlers
- **THEN** handlers SHALL 包含 `/init` 内置 workflow
- **THEN** slash command descriptors SHALL 包含 `/init` 的说明

#### Scenario: workflow handler 位于 skill fallback 之前
- **WHEN** 系统装配默认 slash command handlers
- **THEN** 所有内置 agent workflow handlers SHALL 位于 `SkillInvocationCommandHandler` 之前
- **THEN** command runtime SHALL 继续按既有顺序匹配第一个命中的 handler

#### Scenario: workflow 使用现有 host 和提交结果
- **WHEN** 内置 workflow 需要读取或设置 interaction mode 并启动 agent turn
- **THEN** handler SHALL 通过 `CommandHost.mode` 访问 mode
- **THEN** handler SHALL 返回现有 `submit_user_message` 结果
- **THEN** `CommandHost` SHALL NOT 暴露裸 agent 或 tool executor

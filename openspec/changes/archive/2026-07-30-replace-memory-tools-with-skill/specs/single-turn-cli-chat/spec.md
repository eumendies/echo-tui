## MODIFIED Requirements

### Requirement: 单轮模式的非交互工具策略
默认单轮模式 SHALL 允许不需要审批的工具继续执行。对于需要用户 approval 的工具，系统 SHALL 立即生成可回传模型的拒绝 tool result；对于 `ask_user_questions`，系统 SHALL 立即生成取消或失败 tool result。单轮模式 SHALL NOT 等待不存在的 TUI 输入。未命中通用高风险 bash 规则的 agent memory skill 脚本 SHALL 按普通安全 bash 命令执行，即使其 action 会修改 agent memory。

#### Scenario: 安全工具继续执行
- **WHEN** 默认单轮 agent 请求不需要审批的工具
- **THEN** 系统 SHALL 使用现有 tool executor 执行该工具
- **AND** 工具结果 SHALL 继续回传给 agent loop

#### Scenario: 默认单轮执行 memory skill 脚本
- **WHEN** 默认单轮 agent 通过 `run_bash_command` 执行未命中通用高风险规则的 `agent-memory` 脚本
- **THEN** 系统 SHALL 不要求 `--full-access` 即执行该命令
- **THEN** 读取或 mutation 结果 SHALL 作为普通 bash tool result 回传

#### Scenario: approval-required 工具默认拒绝
- **WHEN** 默认单轮 agent 请求 `apply_patch`、高风险 bash 或未信任 MCP tool
- **THEN** 系统 SHALL NOT 打开 TUI approval surface
- **AND** 系统 SHALL 立即返回失败 tool result
- **AND** agent loop SHALL 能够继续收尾或返回最终错误

#### Scenario: 用户问题在单轮模式取消
- **WHEN** 单轮 agent 请求 `ask_user_questions`
- **THEN** 系统 SHALL NOT 等待 stdin 或用户问题 surface
- **AND** 系统 SHALL 返回结构化取消/失败结果

### Requirement: `--full-access` 显式放开工具授权
当且仅当用户使用 `echo-tui --once --full-access <prompt...>` 时，系统 SHALL 自动允许当前单轮中被风险分类为 approval-required 的已注册工具。该选项 SHALL 不启用未配置的工具、不改变 plan mode 规则或普通 TUI approval 行为，并 SHALL 在帮助或错误提示中说明其可能修改工作区或系统状态。无需审批的 agent memory skill 脚本行为 SHALL 不依赖该选项。

#### Scenario: full-access 自动允许高风险工具
- **WHEN** 用户使用 `--once --full-access` 且 agent 请求高风险 bash、`apply_patch` 或未信任 MCP tool
- **THEN** 系统 SHALL 不打开 approval surface
- **AND** 系统 SHALL 直接执行已注册工具并把结果回传给 agent loop

#### Scenario: full-access 不改变普通 TUI
- **WHEN** 用户不使用 `echo-tui --once --full-access` 而在普通 TUI 中运行 agent
- **THEN** 系统 SHALL 继续使用现有 approval surface 和会话授权语义
- **AND** 系统 SHALL NOT 因 CLI flag 变更普通 TUI 的风险策略

#### Scenario: full-access 不启用未知工具
- **WHEN** full-access agent 请求未注册或未配置的工具
- **THEN** 系统 SHALL 继续返回未知工具失败结果
- **AND** 系统 SHALL NOT 因 full-access 动态创建或启用该工具

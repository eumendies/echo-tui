## MODIFIED Requirements

### Requirement: `--full-access` 显式放开工具授权
当且仅当用户使用 `echo-tui --once --full-access <prompt...>` 时,系统 SHALL 自动允许当前单轮中被风险分类为 approval-required 的已注册工具,并 SHALL 同时关闭本次运行的沙箱包装,使被放开的命令不受 `tools.sandbox` 边界限制。该选项 SHALL 不启用未配置的工具、不改变 plan mode 规则或普通 TUI approval 行为,并 SHALL 在帮助或错误提示中说明其可能修改工作区或系统状态。无需审批的 agent memory skill 脚本行为 SHALL 不依赖该选项。

#### Scenario: full-access 自动允许高风险工具
- **WHEN** 用户使用 `--once --full-access` 且 agent 请求高风险 bash、`apply_patch` 或未信任 MCP tool
- **THEN** 系统 SHALL 不打开 approval surface
- **AND** 系统 SHALL 直接执行已注册工具并把结果回传给 agent loop

#### Scenario: full-access 关闭沙箱包装
- **WHEN** 用户使用 `--once --full-access` 且用户配置启用了沙箱
- **THEN** 本次单轮运行的 `run_bash_command` SHALL 不经过沙箱包装
- **AND** 该豁免 SHALL 仅作用于本次单轮运行

#### Scenario: full-access 不改变普通 TUI
- **WHEN** 用户不使用 `echo-tui --once --full-access` 而在普通 TUI 中运行 agent
- **THEN** 系统 SHALL 继续使用现有 approval surface 和会话授权语义
- **AND** 系统 SHALL NOT 因 CLI flag 变更普通 TUI 的风险策略或沙箱配置

#### Scenario: full-access 不启用未知工具
- **WHEN** full-access agent 请求未注册或未配置的工具
- **THEN** 系统 SHALL 继续返回未知工具失败结果
- **AND** 系统 SHALL NOT 因 full-access 动态创建或启用该工具

# single-turn-cli-chat Specification

## Purpose
TBD - created by archiving change add-once-cli-chat. Update Purpose after archive.
## Requirements
### Requirement: `--once` 单轮命令行对话

系统 SHALL 提供 `echo-tui --once <prompt...>` CLI 入口。命令 SHALL 将 `--once` 后的 prompt 参数按命令行顺序组合为本次 user message；prompt 缺失、参数无效或 `--full-access` 未与 `--once` 一起使用时 SHALL 输出脱敏错误并以非零状态退出。

#### Scenario: 使用命令行 prompt 启动单轮对话
- **WHEN** 用户运行 `echo-tui --once "解释当前项目"`
- **THEN** 系统 SHALL 将 prompt 提交给当前配置的 agent loop
- **AND** 系统 SHALL 在请求完成后退出，而不是进入 TUI

#### Scenario: 多个参数组成 prompt
- **WHEN** 用户运行 `echo-tui --once explain this project`
- **THEN** 系统 SHALL 按参数顺序将剩余参数组合成 prompt
- **AND** 系统 SHALL NOT 将这些参数当作额外 CLI command

#### Scenario: 缺少 prompt
- **WHEN** 用户运行 `echo-tui --once`
- **THEN** 系统 SHALL 向 stderr 输出用法错误
- **AND** 系统 SHALL 以非零状态退出
- **AND** 系统 SHALL NOT 启动 TUI 或发起模型请求

#### Scenario: full-access 只能用于单轮模式
- **WHEN** 用户运行 `echo-tui --full-access` 但没有 `--once`
- **THEN** 系统 SHALL 向 stderr 输出参数使用错误
- **AND** 系统 SHALL NOT 以 full-access 启动普通 TUI

### Requirement: 单轮模式使用 headless agent 生命周期

单轮命令 SHALL 复用当前工作目录、用户配置、provider adapter、agent loop、已启用 MCP registry、lifecycle hooks 和 provider usage store。单轮命令 SHALL NOT 初始化 terminal raw mode、TUI renderer、stdin 交互监听或持久化 transcript session。

#### Scenario: 单轮命令不进入 raw mode
- **WHEN** 用户运行有效的 `echo-tui --once <prompt>`
- **THEN** 系统 SHALL 在无 TTY 或 stdout 重定向场景下仍可执行
- **AND** 系统 SHALL NOT 调用 raw mode、TUI renderer 或 stdin data listener

#### Scenario: 单轮请求使用当前配置
- **WHEN** 用户运行单轮命令
- **THEN** 系统 SHALL 读取当前 `~/.echo/config.json` 解析 provider 和 model
- **AND** provider request SHALL 使用与普通 TUI assistant turn 相同的 agent loop 和工具 schema

#### Scenario: 单轮模式保留 usage 和 hooks
- **WHEN** 单轮 provider 请求返回 usage 或触发已配置 lifecycle event
- **THEN** 系统 SHALL 按现有语义写入 provider usage store 或派发 hooks
- **AND** 这些旁路行为 SHALL NOT 使命令进入 TUI 交互模式

#### Scenario: 单轮模式不创建持久化 transcript
- **WHEN** 单轮请求成功或失败结束
- **THEN** 系统 SHALL NOT 创建或更新可恢复的 transcript session
- **AND** 后续普通 TUI 启动 SHALL NOT 将该单轮 prompt 当作当前 session 历史记录

### Requirement: 单轮输出和退出码

单轮请求成功时 SHALL 将最终 assistant 文本以纯文本写入 stdout 并以零状态退出。配置、provider、网络、agent loop 或不可恢复资源错误 SHALL 写入脱敏 stderr 并以非零状态退出；stdout SHALL NOT 包含 ANSI TUI 控制序列或 spinner 文本。

#### Scenario: 输出最终 assistant 文本
- **WHEN** agent loop 返回最终 assistant 文本
- **THEN** 系统 SHALL 向 stdout 输出该文本和换行
- **AND** 系统 SHALL 以零状态退出

#### Scenario: provider 配置错误
- **WHEN** 当前 LLM 配置缺失或无效
- **THEN** 系统 SHALL 向 stderr 输出明确的脱敏错误
- **AND** 系统 SHALL 以非零状态退出
- **AND** 系统 SHALL NOT 向 stdout 输出成功回答

#### Scenario: 运行时资源总能清理
- **WHEN** 单轮请求成功、失败或被进程信号中断
- **THEN** 系统 SHALL 尽力关闭 MCP client、debug writer 和本次 runner 创建的其他资源
- **AND** 系统 SHALL NOT 因 cleanup 重复执行而抛出未处理异常

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

## Why

当前 `echo-tui` 的 CLI 无参数路径会直接进入终端 raw mode，用户必须启动完整 TUI 才能完成一次模型请求。对于脚本、管道、快速查询和自动化场景，这会增加交互成本，也不适合没有可用 TTY 的环境。

需要增加 `echo-tui --once "<prompt>"` 单轮入口：复用现有 provider、工具和 usage 运行时，但绕过 TUI 渲染与 raw mode，输出一次最终回答后退出。

## What Changes

- 增加 `echo-tui --once <prompt>` 单轮对话 CLI 入口，支持从命令行参数取得 prompt。
- 单轮入口 SHALL 使用现有 LLM 配置、provider adapter、agent loop、usage 记录和已启用 MCP 能力。
- 单轮入口 SHALL 不进入 stdin raw mode，不启动 TUI renderer，不监听交互式输入。
- 单轮请求完成后 SHALL 将最终 assistant 文本写入 stdout，并以成功状态退出。
- 配置、网络、provider 或 agent 执行失败时 SHALL 将脱敏错误写入 stderr，并以非零状态退出。
- 单轮模式 SHALL 对无法交互的工具审批和用户提问提供明确的非交互失败结果，不得永久等待 UI 输入。
- 增加可选 `--full-access`，仅在 `--once` 模式下生效；启用后自动允许需要审批的工具调用，并在帮助文本中明确其可能修改工作区或系统状态。
- `--full-access` 不得改变普通 TUI 的 approval 行为，也不得在未配置的情况下启用 MCP server 或工具。
- 更新 CLI 帮助、README、架构文档和自动化测试。

## Capabilities

### New Capabilities

- `single-turn-cli-chat`: 定义 `echo-tui --once` 的 prompt 输入、headless agent 执行、输出、退出码、资源清理和单轮工具策略。

### Modified Capabilities

- `installable-cli`: 扩展可安装 CLI 的参数、帮助输出、bootstrap 和异步退出语义，保留无参数启动 TUI、help、version 和 unknown command 行为。
- `tool-approval`: 增加单轮 `--full-access` 对 approval-required 工具的显式自动允许例外，普通 TUI 和默认单轮模式仍遵守原有授权策略。

## Impact

- CLI 入口和 bin wrapper 需要支持异步单轮执行及退出码传播。
- 新增不依赖 terminal/raw mode 的 headless runner，复用 `createAgentLoopRuntime`、provider 配置、usage store、hooks 和 MCP 生命周期。
- agent loop 需要接收单轮工具授权策略；provider adapter 不需要改变协议实现。
- 单轮模式默认不打开持久化 TUI session，不产生 transcript UI 记录；provider usage 仍按现有 usage store 语义记录。
- 测试需要覆盖 CLI 参数、非 TTY 执行、成功/失败退出、工具拒绝、`--full-access` 和资源清理。

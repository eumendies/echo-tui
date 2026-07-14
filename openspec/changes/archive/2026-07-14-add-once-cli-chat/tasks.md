## 1. CLI 参数与入口契约

- [x] 1.1 扩展 `src/cli/main.ts` 的 action 类型和参数解析，支持 `--once <prompt...>`、`--full-access`、缺少 prompt 和非法组合的错误分支
- [x] 1.2 更新 CLI help 文本，说明 `--once` 用法、最终文本输出语义和 `--full-access` 的工作区/系统风险
- [x] 1.3 将 CLI 运行入口和 `bin/echo-tui.ts` 调整为可等待异步 action，同时保持 help、version、unknown command 和无参数 TUI 的退出契约
- [x] 1.4 保持 `bootstrapEchoUserSetup` 只在有效 TUI 或单轮启动前执行，并为 CLI action 补充参数与 bootstrap 回归测试

## 2. Headless 单轮运行时

- [x] 2.1 新增不依赖 terminal/raw mode、renderer 或 stdin listener 的单轮 runner，接收 cwd、prompt、输出流和 full-access 选项
- [x] 2.2 在单轮 runner 中复用现有 `McpManager`、lifecycle hooks、debug context、usage store 和 `createAgentLoopRuntime`，使用当前配置发起一次 agent turn
- [x] 2.3 实现最终 assistant 文本 stdout 输出、脱敏错误 stderr 输出和成功/失败退出码映射，确保 stdout 不包含 ANSI 或 spinner 内容
- [x] 2.4 实现 MCP、debug 和其他 runner 资源的成功/失败/信号清理，并保证单轮不创建或更新 transcript session
- [x] 2.5 为缺少配置、provider 失败、无 TTY、成功输出、错误输出和资源清理补充 headless runner 测试

## 3. 非交互工具策略与 full-access

- [x] 3.1 为 agent session/run state 增加仅作用于当前调用的工具授权策略字段，并保持普通 TUI 默认行为不变
- [x] 3.2 在 agent loop 中让默认单轮模式立即拒绝 approval-required 工具，让 `--full-access` 自动允许已注册的 approval-required 工具，同时保留风险分类器和 plan mode 拒绝规则
- [x] 3.3 为单轮 `ask_user_questions` 提供立即返回的取消/失败结果，禁止等待 TUI question surface 或 stdin
- [x] 3.4 验证 full-access 不启用未知或未配置工具、不创建 TUI approval surface，并补充 apply_patch、高风险 bash、memory mutation、MCP 和普通 TUI 隔离测试

## 4. 文档与架构同步

- [x] 4.1 更新 README 的安装、CLI 用法和工具授权说明，记录单轮不持久化 transcript、默认拒绝交互工具及 full-access 风险
- [x] 4.2 更新 `docs/tui-architecture.md` 和相关 AGENTS.md 命令清单，说明 TUI runner 与 headless runner 的边界

## 5. 集成验证

- [x] 5.1 运行 `npm run typecheck`、`npm test` 和 JavaScript 批量语法检查
- [x] 5.2 使用 fake agent 和真实非 TTY 命令手工验证 `echo-tui --once`、错误退出、无参数 TUI 不回归，以及 `--full-access` 的显式行为

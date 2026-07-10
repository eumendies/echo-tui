## 1. 收窄 agent runtime 装配入口

- [x] 1.1 将 `AgentLoopRuntimeDependencies` 从 `src/types/agent.ts` 移除或改为不导出的内部实现细节。
- [x] 1.2 将 `createAgentLoopRuntime` 签名收窄为真实运行边界参数，例如 `cwd` 和可选 `mcpManager`。
- [x] 1.3 移除 runtime 内部对 `agent`、`loadAgentInstructions`、`loadConfig`、`createAgent`、`createToolRegistry`、`createToolExecutor` 测试专用注入项的分支。
- [x] 1.4 收窄 `prepareAgent` 的依赖参数，确保 provider/config/tool registry 装配走真实生产路径。
- [x] 1.5 更新 runtime 内部 plan mode、MCP tool 合并、context usage、compaction 和 tool continuation 逻辑，确保行为保持不变。

## 2. 收窄 app 装配入口

- [x] 2.1 删除或收窄 `CreateAppOptions`，移除 input/output/terminal/renderer/transcriptStore/parser/shell runner/exit hook 等测试专用字段。
- [x] 2.2 将 `createApp` 签名改为只接收真实 app/agent 边界，例如 `runAgent` 和可选 `mcpManager`。
- [x] 2.3 在 `createApp` 内部直接创建真实 terminal、renderer、transcript store、slash handlers、command runtime、syntax highlight 和 process lifecycle 依赖。
- [x] 2.4 更新 `run()` 中 `McpManager`、`createAgentLoopRuntime` 和 `createApp` 的组合方式。
- [x] 2.5 确认 CLI 启动、MCP 初始化、输入提交、shell mode、slash command、resize recovery 和退出清理行为不变。

## 3. 清理测试

- [x] 3.1 清理 `test/agent/agent-loop-runtime.test.js` 中依赖 runtime 测试专用 dependencies 的用例；保留或迁移纯函数和低层可维护测试。
- [x] 3.2 更新 OpenAI Responses、OpenAI Chat、Anthropic adapter 测试中直接创建 runtime 的用例，无法不污染生产 API 验证的用例删除。
- [x] 3.3 清理 `test/app/main.test.js` 中依赖 `createApp(options)` 高层 harness 的用例；能转移到 AppContext、CommandRuntime、renderer、input parser 的行为转移或保留在对应测试文件。
- [x] 3.4 确认测试中不再通过生产装配入口注入 fake renderer、fake terminal、fake provider、fake config loader 或 fake tool executor。

## 4. 验证与收尾

- [x] 4.1 运行 `npm run typecheck` 并修复类型错误。
- [x] 4.2 运行 `npm test` 并修复失败；对因高层 harness 删除导致的缺口确认已有低层覆盖或接受删除。
- [x] 4.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 4.4 检查代码中新增或保留的 `options` / `dependencies`，确认它们不是测试专用装配入口参数。
- [x] 4.5 汇总删除的测试范围、保留的验证覆盖和用户可见行为不变项。

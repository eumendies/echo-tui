## 1. Provider Records 与 Prompt 稳定性

- [x] 1.1 调整 `src/agent/system-prompt.ts`，移除内置 system prompt 中按 plan mode 拼接的 plan section。
- [x] 1.2 在 agent loop provider records 构造中新增 plan mode transient user instruction，位置为 provider records 末尾，保证 normal 请求是 plan 请求的完整前缀。
- [x] 1.3 确保 plan mode transient instruction 不写入 app transcript、session persistence 或 compaction source records。
- [x] 1.4 更新 context usage breakdown 相关逻辑和测试，使 plan transient instruction 按 messages 分类，system/tools 分类保持稳定。

## 2. Tool Registry 与 Plan Mode 执行策略

- [x] 2.1 调整 agent loop runtime 的 registry 选择逻辑，使 normal 和 plan mode 使用同一 provider-visible default registry，并在 MCP manager 可用时一致合并 MCP tools。
- [x] 2.2 扩展 plan mode 风险分类：`apply_patch` 或等价写入型本地工具直接 rejected，不进入 approval surface，也不执行 executor。
- [x] 2.3 保留并验证 `run_bash_command` 的 plan readonly allowlist 行为，只允许既有只读 inspection 命令执行。
- [x] 2.4 保持 plan mode 下观察型和交互型工具可执行，包括 `glob`、`grep`、`read_files`、`use_skill`、`web_fetch`、`web_search` 和 `ask_user_questions`。
- [x] 2.5 保持 normal mode 的高风险工具审批策略不变，包括 `apply_patch` approval 和高风险 bash approval。

## 3. MCP Plan Mode 行为

- [x] 3.1 更新 MCP registry 相关逻辑或测试断言，使 plan mode provider-visible tools 在相同 MCP 状态下与 normal mode 保持一致。
- [x] 3.2 确保 plan mode 下任意 MCP namespace tool call 在执行前被 rejected，且不会调用 MCP server。
- [x] 3.3 确保 MCP approval 配置在 normal mode 仍按既有语义参与风险分类。

## 4. 测试与验证

- [x] 4.1 增加或更新 agent loop/provider records 测试，覆盖 normal/plan system prompt 文本一致、plan transient user instruction 顺序正确且不持久化。
- [x] 4.2 增加或更新 tool registry 测试，覆盖 normal/plan tool definitions 在相同配置和 MCP 状态下稳定一致。
- [x] 4.3 增加或更新风险分类和 runtime continuation 测试，覆盖 plan mode `apply_patch`、非只读 bash、MCP tool call rejected，以及只读 bash继续执行。
- [x] 4.4 运行 `npm run typecheck`。
- [x] 4.5 运行 `npm test`。
- [x] 4.6 运行 `find bin src test -name '*.js' -exec node --check {} \\;`。

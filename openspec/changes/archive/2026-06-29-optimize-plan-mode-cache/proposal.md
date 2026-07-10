## Why

当前 plan mode 会同时修改 provider system prompt 和 provider-visible tool registry：system prompt 额外插入 plan mode section，tool schema 则切换为只读工具集合。这会让 normal/plan 之间切换时请求前缀和 tools body 都发生变化，降低 prompt cache 复用率。

本变更希望在不削弱 plan mode 只读安全边界的前提下，让 mode 切换尽量只影响靠后的 transient instruction 和执行策略，而不是重写稳定 system/tool schema。

## What Changes

- 将 plan mode 约束从内置 system prompt 中移出，改为 provider 请求内的 transient user instruction，且不写入 app transcript/session。
- normal 与 plan mode 使用同一套 provider-visible tool definitions，避免切换 mode 时改变 tools schema。
- plan mode 下继续在 agent loop 的执行前风险分类阶段拒绝写入型或非只读工具调用，包括 `apply_patch`、非 allowlist bash 命令和 MCP tools。
- 保留 plan mode 已有 UI/状态行为：`/mode plan` 和 Tab 循环仍只更新当前进程 interaction mode，不生成持久 transcript record。
- 更新相关测试，覆盖 provider records 顺序、tool definitions 稳定性、plan mode 写入工具拒绝和 MCP 拒绝行为。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `streaming-llm-service-adapter`: provider 请求构造需要把 plan mode 约束从 system prompt 移到 transient user record，并保持 system prompt 的稳定前缀。
- `local-tool-execution`: plan mode 不再通过只读 registry 隐藏写入工具，而是在执行前策略层拒绝不允许的 tool call。
- `mcp-tool-integration`: plan mode 下 MCP tools 可继续出现在 provider-visible tool schema 中以保持缓存稳定，但实际 MCP tool call 必须被 plan mode 策略拒绝。

## Impact

- 影响 `src/agent/agent-loop-runtime.ts`、`src/agent/system-prompt.ts`、provider request 相关测试以及 context usage breakdown 中 system/messages/tools 分段估算。
- 影响 `src/tools/tool-registry.ts` 和 `src/tools/tool-risk-classifier.ts`：plan mode registry 选择逻辑需要收敛，执行前拒绝策略需要覆盖更多工具类型。
- 影响 `src/mcp/tool-adapter.ts` / `src/mcp/manager.ts` 相关测试语义：MCP tools 在 plan mode 的 provider 可见性改变，但执行仍不得发生。
- 不新增运行时依赖，不改变 provider adapter API，不改变用户可见 `/mode` 命令语义。

## Context

当前项目已经在 `AGENTS.md` 中明确要求“Tests should adapt to runtime code, not the other way around”。但 `src/app/main.ts` 的 `createApp(options)` 和 `src/agent/agent-loop-runtime.ts` 的 `createAgentLoopRuntime(dependencies)` 仍然暴露了大量仅供测试替换实现的可选依赖，造成两个问题：

1. 生产装配入口读起来像一个测试 harness，真实运行路径被 `options.foo || realFoo` 分支分散。
2. 测试高度依赖高层 glue 的 fake 注入，一旦内部组合方式调整就需要同步维护大量脆弱断言。

这次变更把装配根还原为生产语义：入口函数只接收真实运行所需边界参数，其余依赖由入口内部直接创建或由更低层模块负责。

## Goals / Non-Goals

**Goals:**

- 删除 `createApp` 中仅为测试存在的可选依赖注入项。
- 删除 `createAgentLoopRuntime` / `prepareAgent` 中仅为测试存在的 provider、config、tool factory 注入项。
- 保留 CLI 用户可见行为、TUI 渲染行为、agent/tool continuation 行为不变。
- 调整测试结构：优先保留低层模块、纯函数、provider adapter 和真实运行 seam 的测试；删除无法在不污染生产 API 的前提下稳定验证的高层 glue 测试。
- 让创建函数签名表达少量真实边界参数，而不是泛化的 `options` / `dependencies` 对象。

**Non-Goals:**

- 不删除所有名为 `options` 的对象参数。
- 不重构渲染布局、Markdown、tool handler、config reader 等模块中具有业务语义的参数对象。
- 不引入新的测试框架、mock 框架、依赖注入容器或运行时抽象层。
- 不改变外部 CLI 命令、配置文件格式、MCP 行为或 provider 请求协议。

## Decisions

### Decision 1: 将 `createApp` 收窄为生产 app 装配入口

`createApp` 不再接收测试专用 `CreateAppOptions`。它应直接使用真实的 `process.stdin`、`process.stdout`、`setupTerminal`、`createAppRenderer`、`createTranscriptStore`、`parseKeyChunk`、`runBashCommand`、`process.exit`、`process.cwd` 和 `process.version`。

保留的真实边界是 agent loop runner 与 MCP manager。建议签名为：

```ts
function createApp(runAgent: RunAgent, mcpManager?: McpManager): AppController
```

理由：app 层和 agent loop 层是清晰的产品边界；`run()` 负责创建 `McpManager` 和 `createAgentLoopRuntime(cwd, mcpManager)`，再交给 app。相比 `createApp()` 内部自行创建 agent loop，这种方式仍保留模块分层，但不开放一组测试替换点。

替代方案：

- `createApp()` 完全无参数：最简洁，但会把 agent loop 创建也塞进 app，削弱 app/agent 层边界。
- 保留 `CreateAppOptions` 但删字段：仍保留 options bag 形态，容易继续回填测试 seam。

### Decision 2: 将 `createAgentLoopRuntime` 收窄为 agent runtime 装配入口

`createAgentLoopRuntime` 不再接收 `AgentLoopRuntimeDependencies`。它只接收当前工作目录和可选 MCP manager：

```ts
function createAgentLoopRuntime(cwd: string, mcpManager?: McpManager): RunAgent
```

内部直接使用真实实现：

- `loadAgentInstructions({cwd})`
- `prepareAgent({cwd, createToolRegistry: ...})` 或进一步把 `prepareAgent` 收窄为真实装配函数
- `createDefaultToolRegistry(config, cwd)`
- `createReadOnlyToolRegistry(config, cwd)`
- `createToolExecutor(registry)`
- `createMcpToolRegistry(mcpManager)` / `mergeToolRegistries(...)`

理由：runtime 的职责是组合配置、provider、tool registry、tool executor、context compaction 和 continuation 状态机；这些不应该作为测试可替换项暴露给生产调用者。

替代方案：

- 保留一个单独 `createTestAgentLoopRuntime`：会把测试架构带回生产源码，违背本变更目标。
- 通过环境变量切换 fake agent/config：隐式性更强，也会污染运行语义。

### Decision 3: 测试删除优先于恢复测试专用 seam

对于依赖 `createApp(options)` / `createAgentLoopRuntime(dependencies)` 的测试，按以下顺序处理：

1. 能迁移到纯函数或低层公共模块的测试，迁移或保留。
2. 能用 provider adapter 自身测试覆盖的行为，移动到对应 adapter 测试。
3. 只能通过高层 fake 注入验证内部调用顺序的测试，删除。

理由：这符合项目现有测试准则，避免“为了测试创造生产参数”。

替代方案：

- 使用 monkey patch / module cache 替换真实模块：会让测试更脆弱，并引入隐式全局状态。
- 保留旧测试并用兼容 wrapper 支撑：会抵消本次简化收益。

### Decision 4: 明确本轮不清理领域参数对象

渲染、Markdown、tool handler、SDK request 等参数对象如果表达真实领域配置或外部 API 参数，本轮不删除。判断标准是：如果参数在真实运行中有明确语义或来自用户配置/终端状态/工具执行边界，就不是“测试专用 options”。

## Risks / Trade-offs

- 高层交互流程测试减少 → 通过保留 `AppContext`、`CommandRuntime`、renderer、input parser、provider adapter、tool executor 等低层测试降低回归风险。
- agent loop continuation 的细粒度测试覆盖下降 → 保留 `buildProviderRecords` 等纯函数测试，并依赖 provider/tool 层测试覆盖序列化与执行边界。
- 内部导出 API 发生破坏性变化 → 该项目主要面向 CLI，外部用户不直接调用这些内部创建函数；实现时通过 TypeScript 编译发现所有内部调用点。
- 后续开发可能重新添加测试 seam → 在 spec 中加入约束，要求装配入口不得暴露仅为测试替换实现的可选依赖。

## Migration Plan

1. 收窄 app / agent runtime 类型和函数签名。
2. 更新 `run()` 和少量生产调用点。
3. 清理依赖旧签名的测试：迁移可保留用例，删除脆弱高层 harness。
4. 运行 `npm run typecheck`、`npm test`、JS 语法检查。

回滚策略：如果出现难以快速定位的行为回归，可回滚函数签名和测试删除提交；由于不涉及配置或数据迁移，无持久化数据回滚需求。

## Open Questions

- 是否完全删除 `test/app/main.test.js`，还是保留极少量不依赖注入的 smoke 测试，实施时根据可维护性决定。
- `prepareAgent` 是否一次性收窄到无 dependencies，还是先仅由 `createAgentLoopRuntime` 不再传测试依赖，实施时以最小清理面为准。

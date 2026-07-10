## Why

当前 `main.ts`、`agent-loop-runtime.ts` 等装配入口暴露了大量仅为单元测试替换实现而存在的 `options` / `dependencies`，导致生产代码的真实依赖关系被 mock seam 淹没，可读性和维护性下降。现在需要把测试便利性从生产 API 中移除，让应用装配路径直接表达真实运行结构。

## What Changes

- **BREAKING**：收窄 app 装配入口的创建函数签名，删除仅供测试注入的输入、输出、terminal、renderer、transcript store、key parser、slash resolver、shell runner、exit hook、node version、syntax highlight 等可选项。
- **BREAKING**：收窄 agent loop runtime 的创建函数签名，删除仅供测试注入的 agent、config loader、instruction loader、provider factory、tool registry factory、tool executor factory 等依赖项。
- 保留真实运行边界需要的参数，例如当前工作目录和 MCP manager；避免使用泛化的 `options` / `dependencies` bag 表达少量必需运行参数。
- 清理或删除依赖这些测试专用注入点的测试；能够通过更低层公共模块、纯函数或真实组合路径验证的行为继续保留测试，不能稳定验证的高层 glue 测试删除。
- 不把本轮范围扩大到所有名为 `options` 的对象参数；渲染布局参数、工具执行边界、SDK request options 等具有业务语义或外部 API 语义的参数继续保留。

## Capabilities

### New Capabilities
- `composition-root-simplicity`: 约束生产装配入口不得暴露仅为测试替换实现而存在的可选依赖，并明确测试应适配生产结构而不是反向驱动生产 API。

### Modified Capabilities
- `terminal-tui-prototype`: TUI 启动和运行行为保持不变，但 app 装配入口的内部结构和测试策略发生收窄。
- `streaming-llm-service-adapter`: agent loop 对外行为保持不变，但 runtime 创建入口不再暴露测试专用 provider/config/tool 注入点。
- `typescript-build-test-pipeline`: 测试策略调整为优先覆盖公共运行 seam、纯函数和低层模块，删除依赖生产装配入口测试注入的脆弱测试。

## Impact

- 受影响代码：`src/app/main.ts`、`src/types/app.ts`、`src/agent/agent-loop-runtime.ts`、`src/agent/agent-setup.ts`、`src/types/agent.ts`，以及调用这些入口的 CLI / app 启动代码。
- 受影响测试：`test/app/main.test.js`、`test/agent/agent-loop-runtime.test.js`，以及少量 provider adapter 测试中直接创建 runtime 的用例。
- API 影响：内部 TypeScript 导出的创建函数签名会破坏旧测试调用方式；外部 CLI 用户行为不应变化。
- 依赖影响：不新增运行时依赖，不引入新的测试框架或 mock 框架。

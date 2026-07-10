## Why

`src/input`、`src/commands`、`src/render` 和 `src/terminal` 已完成 TypeScript 迁移，下一批低风险运行源码自然落在 `src/agent/` 与 `src/persistence/`。迁移这些模块可以让现有 agent、transcript 和 app 协议类型真正覆盖到真实 LLM adapter 与本地 session 存储边界，同时继续保持 CommonJS 产物、敏感信息脱敏策略和 transcript 持久化语义不变。

## What Changes

- 将 `src/agent/` 下的运行源码模块迁移为 TypeScript：`fake-agent`、`llm-config`、`openai-agent`。
- 将 `src/persistence/` 下的运行源码模块迁移为 TypeScript：`transcript-store`。
- 保持 LLM config 读取与校验、错误脱敏、OpenAI SDK stream 归一化、fake agent fixture 行为、cwd hash 分区、session JSON schema 和 atomic write 语义不变。
- 保持运行时输出为 CommonJS JavaScript，继续由 `tsc` 编译到 `dist/`，不引入 ts-node、tsx、loader、bundler、数据库或第三方持久化库。
- 更新架构文档和 OpenSpec 主规格中的源码路径说明，使 agent/persistence 模块扩展名与迁移结果一致。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `typescript-build-test-pipeline`: 增加 agent 与 persistence 运行源码模块可分批迁移为 TypeScript 的要求，并约束编译后测试路径保持兼容。
- `streaming-llm-service-adapter`: 更新真实 adapter 与配置读取相关实现路径，并明确迁移不得改变回调 contract、stream error 处理和敏感信息脱敏行为。
- `terminal-tui-prototype`: 更新模块组织要求中的 agent/persistence 源码路径，并明确迁移不得改变 fake agent、transcript store 或本地会话持久化行为。

## Impact

- Affected code: `src/agent/fake-agent.ts`、`src/agent/llm-config.ts`、`src/agent/openai-agent.ts`、`src/persistence/transcript-store.ts`。
- Affected tests: `test/agent/*`、`test/persistence/transcript-store.test.js`、`test/app/*`，以及编译后 `dist/test` 运行路径。
- Affected docs/specs: `docs/tui-architecture.md`、`openspec/specs/typescript-build-test-pipeline/spec.md`、`openspec/specs/streaming-llm-service-adapter/spec.md`、`openspec/specs/terminal-tui-prototype/spec.md`。
- No dependency changes: 不新增运行时依赖、测试框架、bundler、数据库或持久化后端。

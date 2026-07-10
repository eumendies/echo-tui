## ADDED Requirements

### Requirement: Agent 运行源码迁移保持 adapter 行为
系统 SHALL 允许真实 LLM adapter、配置读取模块和 fake agent fixture 迁移为 TypeScript，并保持现有配置读取、SDK stream 处理、回调契约、错误脱敏和测试注入行为不变。迁移后的 agent 模块 SHALL 继续通过仓库级 TypeScript 编译管线输出 CommonJS JavaScript 到 `dist/`。

#### Scenario: 配置读取迁移不改变校验和脱敏
- **WHEN** `src/agent/llm-config` 迁移为 TypeScript
- **THEN** 系统 SHALL 继续从 `~/.echo/config.json` 读取 LLM 运行配置
- **THEN** 必要字段、可选字段和输出长度限制的校验语义 SHALL 保持不变
- **THEN** 配置错误和本地错误反馈 SHALL NOT 包含敏感字段值

#### Scenario: 真实 adapter 迁移不改变 stream contract
- **WHEN** `src/agent/openai-agent` 迁移为 TypeScript
- **THEN** adapter SHALL 继续使用 OpenAI 官方 SDK 发起流式文本响应请求
- **THEN** adapter SHALL 继续在请求开始时调用 `onThinking`，在文本增量到达时调用增量回调，并在成功完成时调用 `onComplete(finalText)`
- **THEN** stream 异常、服务错误或完成前中断 SHALL 继续以明确错误失败，而不是伪装成成功回复

#### Scenario: fake agent 迁移不改变测试 fixture 行为
- **WHEN** `src/agent/fake-agent` 迁移为 TypeScript
- **THEN** fake agent SHALL 继续支持 thinking、逐字 streaming 和 completion 回调
- **THEN** 测试通过 `createApp(options).runAgent` 注入 fake 或 stub agent 时，CLI 默认真实 adapter 行为 SHALL 不受影响

#### Scenario: Agent 迁移后测试路径保持兼容
- **WHEN** `src/agent` 中的运行源码模块迁移为 TypeScript
- **THEN** 编译后的 agent 和 app 测试 SHALL 继续能够通过原有相对路径加载 `dist/src/agent` 下的对应模块
- **THEN** `npm test` 的编译后测试路径 SHALL 保持可用

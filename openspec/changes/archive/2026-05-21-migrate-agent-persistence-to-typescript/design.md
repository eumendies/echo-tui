## Context

当前仓库已经启用 TypeScript 编译、类型检查和编译后测试运行，`src/input`、`src/commands`、`src/render` 和 `src/terminal` 已迁移为 TypeScript。剩余运行源码中，`src/agent` 与 `src/persistence` 是下一批较自然的迁移边界：agent 层负责用户级配置读取、OpenAI SDK client 创建、stream 事件归一化和 fake fixture；persistence 层负责 transcript session 的 cwd hash 分区、JSON schema、列表派生和 atomic write。

现有约束保持不变：运行输出仍是 CommonJS，`package.json` 仍为 `type: commonjs`，运行时不得依赖 ts-node、tsx、自定义 loader、bundler、数据库或第三方持久化库。迁移目标是类型收敛和源码扩展名迁移，不改变真实 adapter contract、敏感信息脱敏、session JSON 结构或用户可见行为。

## Goals / Non-Goals

**Goals:**

- 将 `src/agent/fake-agent`、`src/agent/llm-config`、`src/agent/openai-agent` 迁移为 TypeScript，并继续由 `tsc` 输出 CommonJS JavaScript 到 `dist/`。
- 将 `src/persistence/transcript-store` 迁移为 TypeScript，并保持 cwd hash 分区、metadata 派生、session JSON schema 和 atomic write 语义不变。
- 复用或适度收敛 `src/types/agent.ts`、`src/types/transcript.ts`、`src/types/app.ts` 中已有协议类型，避免 agent/persistence 继续依赖隐式对象形状。
- 保持现有 `require('../agent/...')`、`require('../persistence/...')` 这类无扩展名加载路径在编译后继续可用。
- 更新架构文档和主规格中的 agent/persistence 源码路径引用。

**Non-Goals:**

- 不迁移 `src/app/`、`src/commands/`、`src/render/`、`src/terminal/`、`src/input/` 或测试文件到 TypeScript。
- 不改变 `~/.echo/config.json` 读取规则、配置字段名、错误脱敏规则、OpenAI SDK 请求语义、fake agent 行为或 transcript JSON schema。
- 不引入新的日志系统、持久化后端、数据库、缓存层或 SDK 包装抽象。
- 不为了类型迁移新增仅服务测试的 production seam；测试应适配 runtime code。

## Decisions

1. **以 agent + persistence 作为一个迁移批次。**
   - 选择原因：这两个目录都位于 app 边界之外，且分别由 `src/types/agent.ts` 与 `src/types/transcript.ts` 提供已有协议类型；同批迁移可以把真实 adapter 与本地 transcript store 一起收敛到显式类型边界。
   - 替代方案：先迁移 `persistence` 再迁移 `agent`。该方案可进一步降低单次风险，但会把文档和主规格路径同步拆成两轮，收益较小。

2. **保持导出名称与 runtime contract 不变，不借迁移重构调用协议。**
   - 迁移后仍保留 `runFakeAgent`、`readLlmConfig`、`createOpenAiAgent`、`redactSensitiveText`、`createTranscriptStore` 等现有导出与行为。
   - 选择原因：当前 JS 调用方仍通过 CommonJS require 消费这些模块；保持导出与 contract 不变能把风险限制在类型声明和编译输出。
   - 替代方案：趁迁移统一 agent API 或拆分 transcript-store 内部 helper。该方案会混入架构重构，不适合作为低风险 TS 迁移 change。

3. **优先使用已有协议类型，必要时在信任边界补充窄类型。**
   - `llm-config` 和 `openai-agent` 应复用 `LlmConfig`、`AgentCallbacks`、`OpenAiAgentDependencies` 等类型。
   - `transcript-store` 应复用 `TranscriptRecord`、`TranscriptSession`、`TranscriptSessionMetadata`、`TranscriptProjectMetadata`、`TranscriptStore` 等类型。
   - 对 OpenAI SDK 事件、JSON parse 结果和文件系统输入这类外部值，使用局部 `unknown` + 显式收窄，而不是引入宽泛 `any`。
   - 选择原因：类型迁移应表达现有 runtime shape，并在真实外部输入边界维持显式校验。

4. **验证以现有测试为主，补充语法检查覆盖剩余 JS。**
   - 迁移完成后运行 `npm run build`、`npm run typecheck`、`npm test`。
   - 继续对仍存在的 JS 源文件运行 `node --check`，并检查关键编译产物如 `dist/bin/echo-tui.js`。
   - 选择原因：agent 与 persistence 行为已有专门测试覆盖，并由 app integration tests 兜底；迁移不应通过改 production 行为来迁就测试。

## Risks / Trade-offs

- [Risk] `openai-agent` 直接接触 SDK stream 事件，类型迁移时容易对未知事件做过度假设。→ Mitigation：保持现有“文本增量/完成/失败/忽略暂不支持事件”的最小判断逻辑，并在外部事件边界使用显式收窄。
- [Risk] `llm-config` 和错误脱敏逻辑位于敏感信息边界，迁移时可能把配置值意外写入错误文本。→ Mitigation：保持现有错误消息策略不变，并复用现有 agent tests 验证不泄露 credential-like 内容。
- [Risk] `transcript-store` 涉及文件系统、JSON schema 和 atomic rename，类型迁移时容易顺手调整对象 shape 或写入流程。→ Mitigation：保持 session JSON 字段、metadata 派生逻辑和临时文件写入顺序不变，只添加类型与必要的局部收窄。
- [Risk] 文档和主规格中仍有 `src/agent/*.js`、`src/persistence/*.js` 路径引用。→ Mitigation：迁移完成后用 `rg` 扫描相关引用，仅保留历史 archive change 中的旧路径。

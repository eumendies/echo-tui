## 1. 迁移 agent 运行源码到 TypeScript
- [x] 1.1 将 `src/agent/fake-agent.js` 迁移为 `src/agent/fake-agent.ts`，复用 `src/types/agent.ts` 中的回调与运行契约类型，保持 fake fixture 的 thinking、streaming 与 completion 行为不变。
- [x] 1.2 将 `src/agent/llm-config.js` 迁移为 `src/agent/llm-config.ts`，为配置文件读取、JSON 解析与字段校验补充显式类型收窄，保持 `~/.echo/config.json` 读取规则、错误脱敏和字段校验语义不变。
- [x] 1.3 将 `src/agent/openai-agent.js` 迁移为 `src/agent/openai-agent.ts`，复用现有 agent 类型并在 SDK stream 事件边界使用显式收窄，保持 `onThinking`、文本增量、`onComplete(finalText)` 和失败反馈 contract 不变。

## 2. 迁移 transcript store 到 TypeScript
- [x] 2.1 将 `src/persistence/transcript-store.js` 迁移为 `src/persistence/transcript-store.ts`，复用 `src/types/transcript.ts` 中的 session、metadata 和 store 协议类型。
- [x] 2.2 保持 transcript store 的 cwd hash 分区、session JSON schema、session metadata/project metadata 派生和 atomic write 语义不变，不引入新的持久化依赖或运行时数据格式。

## 3. 同步调用方、测试和文档路径引用
- [x] 3.1 更新运行时和测试中的 agent / persistence 模块引用，确保无扩展名 `require(...)` 在编译后仍能解析到 `dist/src/agent` 与 `dist/src/persistence` 下的 CommonJS 产物。
- [x] 3.2 更新 `docs/tui-architecture.md` 与受影响主规格中的源码路径引用，把 `src/agent/*.js`、`src/persistence/transcript-store.js` 同步为 `.ts` 路径，并保持描述的职责边界不变。

## 4. 验证迁移结果
- [x] 4.1 运行 `npm run build`、`npm run typecheck` 和 `npm test`，确认 TypeScript 编译、编译后测试路径和相关行为回归通过。
- [x] 4.2 运行 `find bin src test -name '*.js' -exec node --check {} \;` 与 `node --check dist/bin/echo-tui.js`，确认剩余 JavaScript 文件和关键编译产物语法有效。
- [x] 4.3 使用 `rg` 复核仓库中的 agent / persistence 旧 `.js` 路径引用，仅保留历史归档或明确不在本次迁移范围内的引用。

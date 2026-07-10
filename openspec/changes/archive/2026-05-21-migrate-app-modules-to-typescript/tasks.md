## 1. 确认 app 运行源码 TypeScript 边界

- [x] 1.1 `src/app/composer-context.ts`、`src/app/model-context.ts`、`src/app/render-context.ts`、`src/app/transcript-context.ts`、`src/app/turn-context.ts` 复用 app / render / transcript / agent 协议类型，并保持输入历史、模型信息脱敏、render state、transcript 持久化和 turn lifecycle 行为稳定。
- [x] 1.2 `src/app/app-context.ts` 复用语义子 context 类型与门面 contract，保持实例级状态隔离、getter/setter 门面和基础状态操作语义稳定。
- [x] 1.3 `src/app/command-runtime.ts` 复用 command effect / session / input event 类型，并在 effect 与 session 边界补显式收窄，保持 slash runtime 行为和错误语义稳定。
- [x] 1.4 `src/app/main.ts` 复用 app / render / agent / transcript 协议类型，保持顶层依赖装配、输入事件分发、thinking / streaming 生命周期、resize destructive recovery 和测试注入 contract 稳定。
- [x] 1.5 源码 CLI entry shim 位于 `bin/echo-tui.ts`，编译产物入口 `dist/bin/echo-tui.js` 和 CommonJS 输出稳定。

## 2. 同步调用方、文档和规格路径引用

- [x] 2.1 运行时和测试中的 `src/app` 模块引用使用无扩展名 `require(...)`，编译后解析到 `dist/src/app` 下的 CommonJS 产物。
- [x] 2.2 `docs/tui-architecture.md` 与受影响主规格使用 `bin/echo-tui.ts` 和 `src/app/*.ts` 路径引用，并描述 `main`、`command-runtime`、`app-context` 和五个子 context 的职责边界。

## 3. 验证结果

- [x] 3.1 运行 `npm run build`、`npm run typecheck` 和 `npm test`，确认 TypeScript 编译、编译后测试路径和 app 相关行为通过。
- [x] 3.2 运行 `find bin src test -name '*.js' -exec node --check {} \;` 与 `node --check dist/bin/echo-tui.js`，确认 JavaScript 测试文件和关键编译产物语法有效。
- [x] 3.3 使用 `rg` 复核仓库中的 app 和 bin 路径引用。

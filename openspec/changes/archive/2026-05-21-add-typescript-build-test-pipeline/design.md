## Context

当前项目是 Node.js >= 20 + CommonJS 的终端 TUI 原型，`bin/`、`src/`、`test/` 下共有约 41 个 JavaScript 文件，测试使用 Node 内置 `node:test`，运行时依赖只有 OpenAI SDK。项目刚完成 command runtime、handler、AppContext/context 边界收紧，模块职责已经比较清晰，但类型仍主要依赖 JSDoc 和约定。

现有 `package.json` 没有 TypeScript、tsconfig、build step 或 bundler；`npm test` 直接运行源码 JS。仓库规则仍要求 CommonJS、Node >= 20、中文注释、不引入第三方 TUI 库，以及完成前运行 `npm test` 和批量 `node --check`。本变更需要同步这些规则，但不应把 TS 迁移扩大成 ESM 迁移或测试框架迁移。

## Goals / Non-Goals

**Goals:**

- 建立 TypeScript 编译、类型检查、清理和测试脚本，使项目可以从源码生成 `dist/` CommonJS 产物。
- 保持运行产物为 CommonJS，继续用 Node 原生能力和 `node:test`。
- 允许现有 `.js` 源码先通过 `allowJs` 进入编译输出，避免第一步全量重命名/改写所有文件。
- 新增少量纯类型文件，先把 command/input/render/app 之间最容易漂移的协议形状收敛为 TypeScript 类型。
- 更新文档、OpenSpec 主规格和仓库验证命令，让后续迁移有明确落点。

**Non-Goals:**

- 不在本变更中把所有 `bin/`、`src/`、`test/` 文件迁成 `.ts`。
- 不切换到 ESM，不改变 `type: commonjs` 的运行产物语义。
- 不引入 bundler、Babel、ts-node、tsx 或自定义 Node loader。
- 不更换测试框架，不改 transcript 持久化格式，不改变 TUI 用户可见行为。
- 不借 TS 迁移重构 UI、command 交互或 OpenAI adapter 行为。

## Decisions

### 1. 使用 `tsc` 编译到 `dist/`，产物保持 CommonJS

新增 `typescript` 和 `@types/node` 作为 devDependencies，新增 `tsconfig.json`，以 `tsc -p tsconfig.json` 作为唯一 build/typecheck 入口。`compilerOptions.module` 使用 `CommonJS`，`target` 使用 Node 20 适配的 `ES2022`，`outDir` 为 `dist`，`rootDir` 为仓库根目录。

理由：这条路线只新增一个官方编译器，不引入运行时 loader，也不改变 Node 对产物的加载方式。当前项目没有 bundler 和前端构建需求，`tsc` 足够。

替代方案：直接 ESM + `.ts` + tsx/ts-node。该方案能减少显式构建步骤，但会引入 loader、ESM interop、bin 入口和测试运行的新变量，不适合作为第一步。

### 2. 第一阶段启用 `allowJs`，不强制 `checkJs`

`tsconfig.json` 先包含 `bin/**/*`、`src/**/*`、`test/**/*`，开启 `allowJs: true` 让现有 JS 被复制/编译到 `dist/`。同时开启 `strict: true` 约束新增 TS 类型文件，但暂不把所有既有 JS 纳入 `checkJs` 严格检查。

理由：当前 JSDoc 数量较多，直接 `checkJs` 全开容易把迁移第一步变成大量噪音修复。此阶段目标是建立管线和核心类型落点，而不是一次性清空所有 JS 类型错误。

替代方案：先只加 `checkJs`，不输出 `dist/`。这能更快发现一部分错误，但无法解决后续 `.ts` 源码、测试和发布入口如何运行的问题。

### 3. `npm test` 运行编译后的 `dist/test`

脚本建议收敛为：`clean` 删除 `dist`，`build` 执行 `tsc`，`typecheck` 执行 `tsc --noEmit`，`test` 先 build 再 `node --test dist/test`。`start` 先 build 再运行 `dist/bin/echo-tui.js`。

理由：测试运行产物而不是源码，可以保证 CommonJS 输出真实可执行，也能尽早发现路径、shebang、module export 等编译后问题。

替代方案：测试直接跑源码 JS，同时只把 TS build 当作旁路检查。这样迁移过程中可能出现“测试过了但 dist 不能跑”的断层。

### 4. 新增少量纯类型文件，不急着改运行逻辑

优先新增 `src/types/` 下的纯类型文件，例如：

- `input.ts`：`InputEvent`、输入事件 type union。
- `composer.ts`：`Composer`、光标/文本状态。
- `transcript.ts`：`TranscriptRecord`、session metadata。
- `command.ts`：`CommandEffect`、`CommandSession`、`CommandSurface`、handler 协议。
- `app.ts` 或 `agent.ts`：agent callback、render state 等跨层类型。

这些类型文件先作为后续迁移的公共定义，可以被后续 `.ts` 文件逐步引用；本阶段不要求现有 JS 全部使用这些类型。

理由：先把最重要的协议命名出来，比在每个 JS 文件继续复制 JSDoc 对象字面量更有价值，也能为下一阶段迁移 command/runtime 提供类型基础。

替代方案：直接从 `command-runtime.js` 或 `main.js` 开始改 `.ts`。这些文件依赖面大，第一步就改会把类型定义、模块输出和测试 fixture 问题混在一起。

### 5. 保持 `node --check` 但调整对象

迁移后 JS 源码仍存在，`node --check` 可以继续覆盖 `.js` 文件；新增 TS 语法正确性由 `tsc --noEmit` 覆盖。随着源码逐步迁到 `.ts`，验证命令应从“只检查 JS 语法”扩展为“build/typecheck + 必要的 JS 产物语法检查”。

理由：这保留了现有轻量验证习惯，同时承认 TS 文件不能用 `node --check` 直接检查。

## Risks / Trade-offs

- [Risk] `allowJs` 让第一阶段类型覆盖有限 → Mitigation：把核心协议先放进纯类型文件，并在后续迁移 command/runtime 时逐步改为真实 TS 引用。
- [Risk] `dist/` 测试可能暴露相对路径、bin shebang 或 CommonJS 输出问题 → Mitigation：`npm test` 必须跑 `dist/test`，并在实现阶段优先修正编译后路径问题。
- [Risk] 测试 fake stream/EventEmitter 类型在 TS 中会比较噪音 → Mitigation：本阶段不全量迁测试为 TS；后续迁测试时使用小型 fixture interface，而不是给生产代码增加测试 seam。
- [Risk] OpenAI SDK 类型复杂，可能污染全局类型设计 → Mitigation：本阶段不迁 `openai-agent` 实现，只在必要时定义本项目内部的窄 adapter 类型。
- [Risk] `package.json` 的 `bin` 指向 `dist` 后，未 build 时本地 bin 不存在 → Mitigation：开发脚本先 build 再运行；发布/安装流程后续再明确是否提交 dist 或增加 prepack。

## Migration Plan

1. 新增 TypeScript devDependencies、`tsconfig.json` 和 `dist` ignore 规则。
2. 增加 `clean`、`build`、`typecheck`、更新后的 `start` 和 `test` scripts。
3. 新增 `src/types/` 纯类型文件，覆盖 input、composer、transcript、command、app/agent/render 等核心协议。
4. 确认 `tsc` 可把现有 `bin/`、`src/`、`test/` JS 输出到 `dist/`，并修复编译输出运行所需的路径或模块问题。
5. 更新文档和仓库规则，把验证命令调整为 TS build/typecheck/test + JS/产物语法检查。
6. 运行 `npm test`、`npm run typecheck`、必要的 `node --check`，确认行为不变。

回滚策略：删除 `tsconfig.json`、TS devDependencies、`src/types/`、脚本改动和 `dist` ignore 即可回到当前纯 JS 运行方式；因为本阶段不改变运行协议和持久化格式，数据层无需迁移。

## Open Questions

- 是否在本阶段把 `package.json#bin` 改到 `dist/bin/echo-tui.js`，还是暂时保留源码 bin 并只让 `npm start` 使用 dist？推荐实现时根据本地运行体验选择较低风险方案。
- `checkJs` 是否作为后续单独 change 逐步开启？当前建议不在本阶段全开。

## Context

项目已经具备 `tsc -> dist/` 的 CommonJS build/test/typecheck 管线，`npm start` 和 `npm test` 都会先生成 `dist/` 再运行编译产物。当前 `src/input/event-types.js`、`src/input/composer.js` 和 `src/input/key-parser.js` 仍是 JavaScript，但它们正好定义了输入事件、composer state 和 raw key chunk 解析这条核心输入链路。

这条链路的特点是纯逻辑多、外部依赖少、测试覆盖明确，适合作为第一批真实运行源码 `.ts` 迁移对象。现有 `src/types/input.ts` 和 `src/types/composer.ts` 已经描述了相关协议，但还没有被运行源码消费。

需要特别注意：`package.json#bin` 当前仍指向 `bin/echo-tui.js`。一旦 `src/input/*.js` 改名为 `.ts`，直接从源码入口加载 `src/app/main.js` 时，Node.js CommonJS 不会在 Node 20 基线下自动加载 `.ts` 文件。实现阶段必须显式处理这个兼容性边界，不能只让 `npm start` 通过而静默破坏已记录的 bin 策略。最终策略是保留 `package.json#bin` 指向 `bin/echo-tui.js`，但把该文件改为 build-output shim：优先加载 `dist/src/app/main.js`，没有 build 产物时明确提示先 build 并退出。

## Goals / Non-Goals

**Goals:**

- 将 `src/input/event-types.js`、`src/input/composer.js`、`src/input/key-parser.js` 迁移为 TypeScript 源码。
- 复用或调整 `src/types/input.ts`、`src/types/composer.ts`，让运行源码与纯类型定义保持一致。
- 保持所有 input/composer 行为不变，包括 Unicode/中文编辑单元、控制键解析、光标移动、多行 composer 和词级删除。
- 保持编译输出为 CommonJS，继续通过 `npm run build`、`npm run typecheck`、`npm test` 验证编译产物。
- 明确处理源码 bin 入口与 `.ts` 运行源码之间的兼容性边界。

**Non-Goals:**

- 不迁移 `src/app/main.js`、command runtime、render、terminal、transcript store 或 OpenAI adapter。
- 不开启全仓库 `checkJs`，不把所有测试一次性迁移到 TypeScript。
- 不切换 ESM，不引入 bundler、Babel、ts-node、tsx 或自定义 loader。
- 不改变用户可见 TUI 行为、输入快捷键语义或 composer 数据结构。

## Decisions

### 1. 先迁移 input 叶子模块，而不是 app 编排层

`event-types`、`composer` 和 `key-parser` 位于依赖图叶子位置：app、command runtime 和 render 会消费它们，但它们自身不依赖 app、render 或 agent。先迁移这些模块能在较小 blast radius 内验证 `.ts` 运行源码、纯类型复用和 CommonJS 输出。

替代方案是直接迁移 `src/app/main.js` 或 context classes。该方案类型收益更大，但会同时牵动 terminal、renderer、agent、command runtime、transcript store 和测试 fixture，容易把迁移第一步放大成全局重构。

### 2. 使用 TypeScript export 作为源码边界，由 `tsc` 输出 CommonJS

迁移后的 `.ts` 文件建议使用标准 TypeScript `export`，例如导出 `INPUT_EVENTS` 和各个 composer 操作函数。`compilerOptions.module = CommonJS` 会把这些导出编译成 CommonJS，现有编译后 `require('../input/composer')` / destructuring 语义应保持可用。

替代方案是在 `.ts` 中继续写 `module.exports`。这能更贴近旧源码，但类型推导和后续 TS 调用体验更差，也不利于逐步形成 typed module 边界。

### 3. 类型文件与运行源码避免重复漂移

`src/types/input.ts` 与 `src/types/composer.ts` 应继续作为跨层协议类型来源。迁移运行源码时可以从这些文件 import type，也可以在必要时让类型文件重新导出运行源码派生的类型；选择标准是避免同一事件集合或 composer state 在两个位置手写两套不一致定义。

替代方案是每个迁移文件内自行声明局部类型。短期实现更快，但会削弱第一阶段新增纯类型文件的价值。

### 4. 源码 bin 入口兼容性必须显式验证

迁移 `.js` 到 `.ts` 后，`npm start` 和 `npm test` 运行 `dist/` 产物应自然可用；风险点在于 `bin/echo-tui.js` 仍被 `package.json#bin` 暴露。实现采用 build-output shim：源码路径执行 `node bin/echo-tui.js` 时加载 `dist/src/app/main.js`；编译后执行 `node dist/bin/echo-tui.js` 时加载同一份 `dist/src/app/main.js`；如果没有 `dist/`，则输出明确错误提示并以非零状态退出。

该策略不引入 ts-node/tsx、自定义 loader 或重复业务入口，代价是未 build 的源码 bin 不再直接运行源码 app，而是明确要求先 build。

该决策不应通过引入 ts-node/tsx 或自定义 loader 解决，因为这会违背现有 TypeScript 管线约束。

## Risks / Trade-offs

- [Risk] `.ts` 源码改名导致直接源码 bin 入口无法加载 → Mitigation：`bin/echo-tui.js` 改为 build-output shim，已有 `dist/` 时加载编译产物；无 `dist/` 时明确提示先 build，而不是尝试让 Node 直接加载 `.ts` 源码。
- [Risk] `INPUT_EVENTS` 常量值和 `InputEventType` union 漂移 → Mitigation：迁移时让类型从常量派生，或让常量显式满足既有 union。
- [Risk] `parseKeyChunk` 的 `events.filter(Boolean)` 在 TS 下产生类型收窄噪音 → Mitigation：优先让 `parseCharacter` 返回确定的 `InputEvent`，只在确有 nullable 值时使用类型 guard。
- [Risk] 为了满足 TS 类型而改变 composer 行为 → Mitigation：以现有 `test/input/*` 行为为准，测试适配类型迁移而不是反向修改 runtime 语义。
- [Risk] 迁移测试文件扩大范围 → Mitigation：默认保留测试为 JS，只有在能减少 fixture 噪音时才迁移 `test/input/*`。

## Migration Plan

1. 先运行当前 `npm run typecheck`、`npm test` 和 input 测试，确认迁移前基线。
2. 迁移 `event-types`，保持 `INPUT_EVENTS` 的 key 和 value 完全不变，并确认编译后 CommonJS 导出形状兼容。
3. 迁移 `composer`，为 state、文本参数和 mutation 函数补充类型，保持原地修改语义和 Unicode 行为。
4. 迁移 `key-parser`，把 key sequence map、匹配结果和返回事件声明为 input event 类型。
5. 检查并处理所有引用路径，包括源码 JS 对 `.ts` 模块的引用、编译后 `dist/src` 模块解析和测试加载。
6. 单独验证 `npm run build`、`npm run typecheck`、`npm test`，并补充必要的 `node --check` 覆盖仍存在的 JS 源码与关键编译产物。
7. 验证或明确记录源码 bin 入口策略；如行为边界变化，同步 `AGENTS.md`、`docs/README.md` 和相关规格。

回滚策略：恢复三个 `src/input/*.js` 文件，删除对应 `.ts` 迁移，恢复类型文件调整和文档/spec 改动即可。由于本 change 不改变持久化格式和用户可见行为，无数据迁移。

## Open Questions

- 已决策：`node bin/echo-tui.js` 在没有 `dist/` 时不再直接运行源码 app，而是提示先运行 `npm run build`；有 `dist/` 时作为 package bin shim 启动编译产物。
- 是否迁移 `test/input/*.test.js` 到 TypeScript？默认建议先保留 JS 测试，降低范围。

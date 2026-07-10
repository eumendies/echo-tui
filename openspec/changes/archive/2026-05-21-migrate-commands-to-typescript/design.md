## Context

项目已经具备 `tsc -> dist/` 的 CommonJS build/test/typecheck 管线，并且 `src/input/event-types.ts`、`src/input/composer.ts` 和 `src/input/key-parser.ts` 已完成第一批运行源码迁移。当前 `src/commands/` 仍是 JavaScript，但这一层已经围绕 `command surface`、`command effect`、`command session` 和 `handler` 协议形成了清晰边界，且 `src/types/command.ts` 已经描述了这些协议。

`src/commands/` 当前包含两类模块：

- 协议/装配模块：`command-effects.js` 和 `resolve-slash-command.js`
- 默认 handler：`help-command-handler.js`、`model-command-handler.js`、`clear-command-handler.js`、`resume-command-handler.js`

这些模块的共同特点是：业务逻辑集中在纯匹配、对象创建、surface 派生和 event-to-effect 转换上，不直接操作 terminal、renderer、transcript store 或 app state。它们适合一次性迁移到 TypeScript，以避免 command 协议在 JS 与 TS 之间继续重复维护。

需要刻意控制边界：`src/app/command-runtime.js` 虽然消费 command effects 和 handlers，但它属于 app runtime 层，负责 active session、effect interpreter 和 app 回调执行。把它放进同一批会把 change 从 commands 模块迁移扩大成 app 编排迁移，因此本 change 默认不迁移它，只做必要的编译兼容调整。

## Goals / Non-Goals

**Goals:**

- 将 `src/commands/` 下现有 JavaScript 运行源码整体迁移为 TypeScript。
- 复用或调整 `src/types/command.ts`，让 command surface、effect、session 和 handler 类型被运行源码消费。
- 保持 `/help`、`/model`、`/clear`、`/resume` 的匹配规则、surface 形状、事件处理和 effect 输出不变。
- 保持编译输出为 CommonJS，继续通过 `npm run build`、`npm run typecheck` 和 `npm test` 验证编译产物。
- 保持现有 JS 测试入口和 `node --test dist/test` 路径不变。

**Non-Goals:**

- 不迁移 `src/app/command-runtime.js`、`src/app/main.js`、AppContext、render、terminal、persistence 或 agent 模块。
- 不新增 slash command，不改变任何命令 UX、文案、快捷键或 transcript 行为。
- 不开启全仓库 `checkJs`，不迁移测试文件到 TypeScript。
- 不切换 ESM，不引入 bundler、Babel、ts-node、tsx 或自定义 loader。

## Decisions

### 1. 一次迁移整个 `src/commands/`，而不是只迁 effects/resolver

`command-effects`、`resolve-slash-command` 和默认 handlers 共享同一组 command 类型。如果只迁其中一部分，会在 TS 运行源码和 JS handlers 之间继续保留宽泛 `object` 边界，导致类型收益被削弱。一次迁移整个 `src/commands/` 可以让 handler `start()` / `handleEvent()`、surface 派生和 effect 工厂形成闭环。

替代方案是分两步先迁 `command-effects` 和 `resolve-slash-command`，再迁 handlers。该方案风险更低，但会制造一个短期混合边界；用户已明确倾向不拆两步，因此本 change 选择一次迁完整 commands 目录。

### 2. 使用标准 TypeScript `export`，由 `tsc` 输出 CommonJS

迁移后的 `.ts` 文件使用标准 TypeScript `export` / `export class`。`compilerOptions.module = CommonJS` 会输出兼容现有 `require('../commands/...')` 的 CommonJS JavaScript，app 与测试在编译后路径下继续通过 destructuring require 消费模块。

替代方案是在 `.ts` 中继续使用 `module.exports`。这更接近旧源码形态，但会削弱类型推导和跨模块类型引用，不利于后续迁移 `command-runtime`。

### 3. `src/types/command.ts` 作为协议来源，但允许按实现事实修正

commands 迁移时应优先 import type 复用 `CommandSurface`、`CommandEffect`、`CommandHandler`、`CommandSession` 等类型。如果现有类型与 runtime 实际对象不完全匹配，应修正类型定义来表达现有行为，而不是为了类型方便改变 runtime shape。

特别需要关注：

- handler `match()` 在类型中是否应继续可选；resolver 实际只接收可匹配 handler。
- `/resume` 的 session data 结构应有局部类型，避免退化为宽泛 `Record<string, unknown>` 后到处 cast。
- command surface 的 optional 字段必须与 render 层当前容忍的 shape 保持一致。

### 4. 保持 app runtime 为 JS 消费者

`src/app/command-runtime.js` 仍然通过编译后的 CommonJS commands 产物消费 `COMMAND_EFFECT_TYPES` 和 handler 对象。实现阶段应重点验证：

- 编译后 `dist/src/commands/*.js` 的导出形状与旧 CommonJS destructuring require 兼容。
- `src/app/command-runtime.js`、`src/app/main.js` 和测试在 `dist/` 下能解析迁移后的 commands 模块。
- 不为了让 JS app runtime 更好类型化而迁移或重写 app runtime。

## Risks / Trade-offs

- [Risk] handler 类型过窄导致为了过 typecheck 改变 surface 或 effect shape → Mitigation：以现有测试和 runtime 行为为准；类型表达当前对象格式，不反向驱动行为变化。
- [Risk] `/resume` 数据结构复杂，迁移时引入过多 casts 或隐式 any → Mitigation：为 resume session data、option 和 dependencies 定义局部类型，并保持函数边界清晰。
- [Risk] TS `export` 编译后的 CommonJS 导出形状和旧 `require` 不兼容 → Mitigation：迁移后运行 `npm run build`、`npm test`，并重点覆盖 `test/commands/*` 与 `test/app/*`。
- [Risk] 一次迁完整 commands 目录比只迁 effects/resolver 范围更大 → Mitigation：不同时迁移 `src/app/command-runtime.js`，并把每个 handler 作为独立小步处理。
- [Risk] `src/types/command.ts` 与 render/app 当前可接受字段不一致 → Mitigation：只按现有 runtime shape 收敛类型；行为变更必须通过测试证明或退出本 change。

## Migration Plan

1. 运行 `npm run typecheck`、`npm test` 和 commands 相关测试，记录迁移前基线。
2. 迁移 `command-effects`，让 effect type 常量和工厂函数返回 `CommandEffect` 相关类型，保持返回对象不变。
3. 迁移 `help`、`model`、`clear`、`resume` handlers，分别为 dependencies、surface、session data 和 event 参数补充类型。
4. 迁移 `resolve-slash-command`，让默认 handler 装配和 resolver 返回类型与 `CommandHandler` 协议对齐。
5. 清理 `src/types/command.ts`，确保类型表达迁移后的真实 runtime shape，避免重复或漂移。
6. 检查 `src/app/command-runtime.js`、`src/app/main.js`、测试和文档中对 `src/commands/*.js` 的引用描述，必要时同步为 `.ts` 或编译产物语义。
7. 运行 `npm run build`、`npm run typecheck`、`npm test`，并补充必要的 `node --check` 覆盖仍存在的源码 JS 和关键编译产物。

回滚策略：恢复 `src/commands/*.js` 文件，删除对应 `.ts` 文件，恢复 `src/types/command.ts` 和文档/spec 调整即可。由于本 change 不改变持久化格式和用户可见行为，无数据迁移。

## Open Questions

- 是否需要在本 change 中更新 `docs/tui-architecture.md` 的重要函数表和模块图中 commands 文件扩展名？默认建议迁移完成后同步。
- 如果迁移暴露 `CommandHandler.match` 可选性与 resolver 实际需求冲突，是否把 resolver 参数收窄为 `Array<CommandHandler & { match: ... }>`，还是把 `match` 改为 handler 协议必需字段？默认建议以现有默认 handlers 和 resolver 用法为准，优先收窄 resolver 参数。

## Context

当前仓库已经启用 TypeScript 编译、类型检查和编译后测试运行，`src/input` 与 `src/commands` 已迁移为 TypeScript。剩余运行源码中，`src/render` 与 `src/terminal` 是下一批较自然的迁移边界：render 层主要消费 composer、command surface、pending state 和 transcript record 并生成字符串布局；terminal 层主要封装 ANSI 控制序列与 raw mode setup/cleanup。

现有约束保持不变：运行输出仍是 CommonJS，`package.json` 仍为 `type: commonjs`，运行时不得依赖 ts-node、tsx、自定义 loader、bundler 或第三方 TUI 库。迁移目标是类型收敛和源码扩展名迁移，不改变用户可见 TUI 行为。

## Goals / Non-Goals

**Goals:**

- 将 `src/render/layout`、`src/render/blocks`、`src/render/footer`、`src/render/app-renderer` 迁移为 TypeScript，并继续由 `tsc` 输出 CommonJS JavaScript 到 `dist/`。
- 将 `src/terminal/ansi` 与 `src/terminal/tty` 迁移为 TypeScript，并保持现有 ANSI 字符串、raw mode setup/cleanup 和 terminal size 读取语义。
- 复用或适度收敛 `src/types/render.ts`、`src/types/app.ts`、`src/types/transcript.ts`、`src/types/command.ts` 中已有协议类型，避免 render 边界继续依赖隐式对象形状。
- 保持现有 `require('../render/...')`、`require('../terminal/...')` 这类无扩展名加载路径在编译后继续可用。
- 更新架构文档和主规格中的 render/terminal 源码路径引用。

**Non-Goals:**

- 不迁移 `src/app/main.js`、`src/app/command-runtime.js`、`src/app/*-context.js`、`src/agent`、`src/persistence` 或测试文件到 TypeScript。
- 不改变 footer 布局、banner 文案、ANSI 样式、display width 计算、thinking shimmer、destructive recovery 或 raw mode 行为。
- 不引入新渲染抽象、terminal UI 库、快照测试框架或 bundler。
- 不为了类型迁移新增仅服务测试的 production seam；测试应适配 runtime code。

## Decisions

1. **以 render + terminal 作为一个迁移批次。**
   - 选择原因：`render` 直接依赖 `terminal/ansi`，`terminal/tty` 又依赖 `ansi`；同批迁移可以避免短时间内 JS/TS 文件互相引用造成文档和规格路径反复更新。
   - 替代方案：只迁移 `src/render` 和 `src/terminal/ansi`，暂缓 `tty`。该方案风险更低，但用户明确希望迁移 render 和 terminal 代码，且 `tty` 边界较小、测试可由 app 集成路径覆盖。

2. **保留模块边界和导出名称，不做行为重构。**
   - 迁移后仍保留 `createAppRenderer`、`buildAppSnapshot`、`renderFooterLayout`、`renderBanner`、`displayWidth`、`setupTerminal` 等现有导出语义。
   - 选择原因：当前 JS 调用方仍通过 CommonJS require 消费无扩展名模块；保持导出名能把风险限制在类型声明和编译输出。
   - 替代方案：趁迁移拆分 renderer 或重命名 helper。该方案会混入架构重构，不适合作为低风险 TS 迁移 change。

3. **优先使用现有协议类型，必要时局部补充窄类型。**
   - `render/app-renderer` 和 `render/footer` 应消费 `RenderState`、`RenderInitialOptions`、`RenderDestructiveOptions`、`RenderFinalOptions`、`AppendRecordOptions`、`FooterLayout` 等类型。
   - `render/blocks` 应消费 `BannerContext`、`PendingState`、`TranscriptRecord` 等类型。
   - `terminal/tty` 可在不扩大公共 API 的前提下使用 Node stream 类型和 `TerminalController` 兼容形状。
   - 选择原因：类型迁移应表达现有 runtime shape，而不是引入新的 runtime 数据格式。

4. **验证以现有测试为主，补充语法检查覆盖剩余 JS。**
   - 迁移完成后运行 `npm run build`、`npm run typecheck`、`npm test`。
   - 继续对仍存在的 JS 源文件运行 `node --check`，并检查关键编译产物如 `dist/bin/echo-tui.js`。
   - 选择原因：render/terminal 行为已有 render unit tests 和 app integration tests 覆盖；迁移不应通过改 production 行为来迁就测试。

## Risks / Trade-offs

- [Risk] `render/blocks` 的 display width、ANSI 样式和 thinking shimmer 逻辑较多，类型迁移时容易顺手重排逻辑导致视觉回归。→ Mitigation：逐文件迁移，优先保持函数结构和测试断言；行为变更必须显式新增/更新测试。
- [Risk] `terminal/tty` 涉及 raw mode、signal handler 和 cleanup，自动化测试覆盖有限。→ Mitigation：只添加类型，不改 cleanup 顺序；必要时通过现有 app 退出测试和手动 `npm start` 做补充验证。
- [Risk] TypeScript strict 模式可能暴露宽松对象形状，诱导新增过宽的 `any` 或运行时 fallback。→ Mitigation：优先从 `src/types` 复用协议类型；确实位于 Node stream 或 ANSI 字符串边界时才使用局部窄类型或 `unknown` 解析。
- [Risk] 文档和主规格中仍有 `.js` 路径引用。→ Mitigation：迁移完成后用 `rg` 扫描 `src/render/*.js`、`src/terminal/*.js` 相关路径引用，仅保留历史 archive change 中的旧路径。

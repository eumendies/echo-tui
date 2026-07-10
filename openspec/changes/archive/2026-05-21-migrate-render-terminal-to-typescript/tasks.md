## 1. 迁移前基线与范围确认

- [x] 1.1 运行当前 `npm run typecheck`、`npm test` 和 render/terminal 相关测试，记录迁移前布局、ANSI、footer redraw 和 app renderer 行为基线。
- [x] 1.2 确认本 change 只覆盖 `src/render/` 与 `src/terminal/` 运行源码迁移，不迁移 `src/app/`、`src/agent/`、`src/persistence/` 或测试文件到 TypeScript。

## 2. Terminal 运行源码迁移

- [x] 2.1 将 `src/terminal/ansi.js` 迁移为 `src/terminal/ansi.ts`，保持所有 ANSI 控制序列、样式 helper 和导出名称不变。
- [x] 2.2 将 `src/terminal/tty.js` 迁移为 `src/terminal/tty.ts`，保持 terminal size 读取、raw mode setup/cleanup、信号处理和光标恢复行为不变。

## 3. Render 运行源码迁移

- [x] 3.1 将 `src/render/layout.js` 迁移为 `src/render/layout.ts`，保持 display width、safe width、wrap 和 composer 光标坐标计算行为不变。
- [x] 3.2 将 `src/render/blocks.js` 迁移为 `src/render/blocks.ts`，保持 banner、transcript block、pending preview 和 thinking shimmer 渲染行为不变。
- [x] 3.3 将 `src/render/footer.js` 迁移为 `src/render/footer.ts`，保持 composer surface、command surface、divider、footer cursor 和 cursor visibility 行为不变。
- [x] 3.4 将 `src/render/app-renderer.js` 迁移为 `src/render/app-renderer.ts`，保持 footer-only redraw、append record、destructive replay、final render 和 snapshot 构建行为不变。

## 4. 类型收敛与引用兼容

- [x] 4.1 复用或适度收敛 `src/types/render.ts`、`src/types/app.ts`、`src/types/transcript.ts` 和 `src/types/command.ts`，让迁移后的 render/terminal 模块表达真实 runtime shape。
- [x] 4.2 修复 `src/app/main.js`、`src/app/render-context.js`、`src/app/command-runtime.js`、测试或其他 JS 调用方对迁移后模块的编译兼容性问题，同时保持无扩展名 require 路径可用。
- [x] 4.3 如测试需要调整，更新 `test/render/*` 或 `test/app/*` 以适配迁移后的运行源码，不改变 runtime 行为或新增测试专用 production seam。

## 5. 文档、规格与验证

- [x] 5.1 更新 `docs/tui-architecture.md` 中 render/terminal 源码路径和实现索引的扩展名说明。
- [x] 5.2 如实现过程中发现规格表述需要微调，同步更新本 change 的 delta specs，确保 archive 前可同步到主规格。
- [x] 5.3 运行 `npm run build`，确认迁移后的 render/terminal 模块能正确输出到 `dist/src/render` 与 `dist/src/terminal`，且 app/tests 能通过相对路径加载。
- [x] 5.4 运行 `npm run typecheck` 并修复迁移引入的所有 TypeScript 错误。
- [x] 5.5 运行 `npm test`，确认 render unit tests、app integration tests、slash command 集成路径和 terminal 行为相关断言全部通过。
- [x] 5.6 运行必要的 `node --check` 覆盖仍存在的源码 JS 和关键编译产物，并更新 `tasks.md` 勾选状态。

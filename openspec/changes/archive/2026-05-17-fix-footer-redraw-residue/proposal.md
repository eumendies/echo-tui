## Why

当前 TUI 在普通输入、spinner 更新和 pending 变化时，会先清理再重绘整块 app-owned region。这个策略即使在终端宽度不变时也会反复重新输出 banner 和 transcript；一旦用户向上翻到 scrollback，就能看到未被真正回收的旧 banner 和旧快照残留，破坏 append-only transcript 的终端语义。

现在需要修复这个残留问题，把普通交互路径恢复为只重绘 footer，可变内容只包含 pending、composer 和 hint；完整快照重放只保留给 resize 等必须重建布局的场景。

## What Changes

- 调整普通渲染路径：输入编辑、光标移动、thinking spinner 和 pending draft 更新时，只重绘 footer 区域，不再清理并重写 banner 与 transcript。
- 保持 transcript 为 append-only：用户提交和 assistant 完成时，先清掉临时 footer，再向终端追加新的 transcript block，随后重新绘制 footer。
- 保留列宽变化时的 destructive recovery：仅在 resize 触发的完整重放中重建 banner、transcript 和 footer，以适配新的折行宽度。
- 补充针对 normal redraw / transcript append / resize replay 的自动化测试，防止 scrollback 残留问题回归。

## Capabilities

### New Capabilities
- 无

### Modified Capabilities
- `terminal-tui-prototype`: 修正普通交互与 resize 场景下的渲染责任边界，要求 normal path 只重绘 footer，避免在 scrollback 中残留旧 banner 和旧快照。

## Impact

- 受影响代码：`src/app/main.js`、`src/render/footer.js`、`src/render/app-region.js` 以及相关测试。
- 受影响行为：普通输入、pending 更新、消息提交追加、resize recovery 和退出前的最终清理逻辑。
- 不引入新的运行时依赖；继续使用 Node.js 内建能力、ANSI 控制序列和现有的 append-only transcript 记录模型。

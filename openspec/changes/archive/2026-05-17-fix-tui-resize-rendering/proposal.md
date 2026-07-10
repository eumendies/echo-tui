## Why

当前 TUI 在终端列宽变化后仍会暴露根本性的重排问题：旧 banner、transcript 和 footer 会被终端按新宽度重新折行，而应用若继续尝试“回到旧顶部逐行清理”，就会遇到 scrollback 已经变化、物理高度不可可靠回推的边界，最终表现为 banner 残留、消息复制或灰底/分割线没擦干净。

之前探索过 bounded viewport / live region 方向，但这会明显改变当前原型的可见历史语义，也引入额外的 viewport 模型复杂度。当前项目接受更强的恢复语义：只要终端列宽发生变化，应用就直接清当前 screen 与 scrollback，然后基于当前状态完整重绘。这比继续猜测旧输出物理行数更直接，也更符合这次修复的目标。

## What Changes

- 明确 append-only 的对象是 transcript 内容记录：用户和 assistant 已提交消息只追加记录，不修改消息事实内容。
- 引入 width resize 的 destructive resize recovery：当 `newColumns !== previousColumns` 时，应用直接清可见屏幕、清 scrollback、回到左上角，并从当前状态完整重绘 app snapshot。
- destructive repaint 的完整快照包含 banner、transcript projection、pending preview、divider、composer 和 hint；重绘后光标恢复到 composer 逻辑位置。
- height 变化和普通输入/streaming 更新仍走统一 render 入口，但任意列宽变化都切换到 destructive full repaint 模式，而不是继续依赖旧区域高度估算。
- 保留用户消息整行灰色背景，但背景宽度必须来自当前渲染宽度；resize 后重新渲染时应覆盖新的整行宽度，并保持多行缩进正确。
- 明确 footer 分割线必须在每次 redraw 时按当前 terminal width 重新计算，并且不得因为写满最后一列触发自动换行。
- 允许列宽变化的恢复路径清除用户此前的 visible screen 与 scrollback；应用在当前终端继续运行，但不切 alternate screen。
- 梳理并测试宽度变窄、变宽、中文宽字符、多行输入、streaming 中 resize、完成后 resize 等边界。
- 不使用 alternate screen，不改变输入快捷键，不改变 mock assistant 语义。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `terminal-tui-prototype`: 补充终端 resize 下的 destructive width-change recovery、整屏重绘、scrollback 清理、分割线宽度、整行用户背景和布局稳定性要求。

## Impact

- 影响 `src/app/main.js`：除保存 transcript message records 外，还需要跟踪上一次 terminal columns，并在任意列宽变化时切换到 destructive repaint 模式。
- 影响 `src/render/blocks.js`：消息块渲染需要成为基于当前 width 的纯投影，用户整行背景必须按当前宽度计算。
- 影响 `src/render/footer.js`：分割线宽度、composer 高度和光标恢复仍需稳定，并且 destructive repaint 后也要回到 composer 逻辑位置。
- 影响 `src/render/app-region.js` 或后续同类模块：需要支持从左上角完整输出 app snapshot，并在 shrink 路径上绕开旧区域高度估算和局部擦除逻辑。
- 影响 `src/terminal/ansi.js`：可能新增 clear visible screen、clear scrollback、cursor home、reset scroll region 等 helper，用于表达 destructive repaint 语义。
- 影响启动/运行语义：应用启动时仍可在已有输出后运行，但列宽变化的恢复路径会清理当前终端 screen 与 scrollback。
- 影响 `docs/README.md`、`docs/tui-architecture.md` 和 `openspec/specs/terminal-tui-prototype/spec.md` 的 resize 行为说明。
- 不引入第三方依赖，不改变输入快捷键，不改变 mock assistant 语义。

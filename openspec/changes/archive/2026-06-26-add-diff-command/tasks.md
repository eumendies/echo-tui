## 1. 数据模型与持久化 history

- [x] 1.1 新增 diff/change history 类型，描述 source、文件、hunk、line、统计、notice、checkpoint、invalid boundary 和可序列化 session 状态。
- [x] 1.2 扩展 `TranscriptSession`、`TranscriptContext` 和 `TranscriptStore`，保存/加载可选 `changeHistory` 字段，并不保留旧字段兼容。
- [x] 1.3 调整 `ChangeHistoryContext` 或新增受控 change history 记录器，使 `apply_patch` 成功写入、checkpoint finalize、invalid 和 `/undo` 成功后同步更新 history。
- [x] 1.4 确保 `/resume` 恢复 persisted change history，供 `/diff` fallback 和跨进程 `/undo` 共用。

## 2. diff source 与解析生成

- [x] 2.1 新增 Git diff source，使用 argv 形式执行只读 git 命令，检测 worktree，并读取禁用 external diff/color 的 unified diff。
- [x] 2.2 实现 unified diff parser，支持常见 `diff --git`、`---`/`+++`、`@@` hunk、added/deleted/modified/renamed 文本 diff，并生成统一 `DiffFile` 模型。
- [x] 2.3 新增 history fallback source，按最近 invalid boundary 之后的 ready entries 折叠同一文件，使用最早 before snapshot 与当前磁盘内容生成最终 diff。
- [x] 2.4 实现轻量 line diff / hunk 生成工具，用于 history fallback 的 added、deleted、updated 文本文件，不引入第三方依赖。
- [x] 2.5 为 Git 不可用、非 Git worktree、Git source 失败、history 空、文件不可读/二进制/超限等情况生成明确 source result 和 notice。

## 3. /diff command 集成

- [x] 3.1 扩展 `CommandHost` 的 diff 领域能力，暴露读取当前 diff source result 的受控入口，handler 不直接访问完整 `AppContext`、renderer 或 terminal。
- [x] 3.2 新增 `DiffCommandHandler`，匹配纯 `/diff`，打开 diff surface；无差异时展示可关闭 info surface。
- [x] 3.3 在 handler data 中维护 `focus`、`selectedIndex`、`detailScroll`，实现 Up/Down、Left/Right、Enter/Esc 交互。
- [x] 3.4 将 `/diff` 注册到默认 slash command handlers，并更新 slash descriptor 覆盖。

## 4. diff footer surface

- [x] 4.1 扩展 `CommandSurface` union，新增 `DiffCommandSurface`，包含 source、notice、文件列表、当前选择、焦点和滚动状态。
- [x] 4.2 新增 `renderDiffSurface`，渲染标题、source、文件数、总增删、文件列表、当前文件详情和操作提示。
- [x] 4.3 实现详情区自动布局：宽度足够时使用 old/new side-by-side，宽度不足时自动 unified 单栏，无用户手动 layout toggle。
- [x] 4.4 确保 surface 遵循 footer 高度预算、安全宽度、最后一列规避、局部重绘和不使用 alternate screen 的约束。
- [x] 4.5 渲染 fallback 完整性提示和 invalid boundary 提示，避免用户误以为 history diff 等同 Git diff。

## 5. 测试

- [x] 5.1 增加 change history / persistence 测试，覆盖 apply_patch 记录、invalid 清边界、undo 后同步移除、session 保存/加载和 `/resume` 后 `/undo` 可恢复。
- [x] 5.2 增加 diff source 测试，覆盖 Git source 成功、Git 不可用/非 Git 降级、Git 失败 notice、history fallback 多次修改折叠、新增/删除/无法比较文件。
- [x] 5.3 增加 `/diff` command handler/runtime 测试，覆盖打开 surface、空 diff info、方向键焦点/滚动/选择、Enter/Esc 关闭和不追加 transcript。
- [x] 5.4 增加 diff surface renderer 测试，覆盖宽屏 side-by-side、窄屏 unified、fallback notice、invalid notice、宽度不溢出和高度裁剪。
- [x] 5.5 更新 slash command descriptor 测试，确认默认建议包含 `/diff`。

## 6. 文档与验证

- [x] 6.1 更新 `docs/README.md` 的 slash 命令表和 `/diff` 行为说明，明确 Git 优先和 fallback 不完整提示。
- [x] 6.2 更新 `docs/tui-architecture.md`，说明 diff command、diff source、change history persistence 和 surface 设计。
- [x] 6.3 运行 `npm run typecheck`。
- [x] 6.4 运行 `npm test`。
- [x] 6.5 运行 `find bin src test -name '*.js' -exec node --check {} \\;`。
- [x] 6.6 手动验证 `npm start` 下 Git 仓库 `/diff`、非 Git fallback `/diff`、宽/窄终端自适应、方向键交互、Enter/Esc 关闭、`/resume` 后 fallback diff 和 `/undo` 边界。

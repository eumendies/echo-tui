## Why

当前 `/resume` 右侧预览只能显示最近最多 5 条单行摘要，且明确不支持独立滚动；当会话较长或消息内容较长时，用户在恢复前很难判断该 session 是否是目标会话。

刚完成的 `@` file picker 已建立“左侧列表 + 右侧可滚动预览”的交互模式，`/resume` 可以复用同类心智模型，让历史恢复前的预览更有用。

## What Changes

- `/resume` command surface 增加 list / preview 双焦点状态。
- 在 list focus 下，Up/Down 继续移动 session 选择，并在选择变化时重置右侧 preview 滚动位置。
- 在 preview focus 下，Up/Down 滚动右侧预览内容，不改变左侧 session 选择。
- 支持通过 Right 或 Tab 进入 preview focus，通过 Left 返回 list focus；Enter 恢复和 Esc 取消语义保持不变。
- 右侧 preview 从固定 5 条单行摘要增强为更多记录、更长文本的可窗口化预览，并在 footer 高度预算内渲染。
- 不改变 transcript session 的持久化 schema，不把 `/resume` 预览行为写入 transcript 或 input history。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `terminal-tui-prototype`: 修改 `/resume` 的消息预览要求，从“不支持独立滚动”改为支持 preview focus 和右侧滚动预览更多内容。

## Impact

- `src/commands/resume-command-handler.ts`: 增加 `/resume` command data 中的 preview focus / scroll 状态和事件分发。
- `src/types/command.ts`: 扩展 `ResumeCommandSurface`，让 renderer 能知道当前焦点和 preview scroll。
- `src/render/footer/resume-surface.ts`: 将右侧 preview 渲染改为可窗口化、多行投影，并保持安全宽度和 footer 高度约束。
- `src/persistence/transcript-store.ts`: 调整恢复面板 metadata 派生的 preview record 数量和文本长度上限，不改变落盘 schema。
- `test/commands/slash-command.test.js`、`test/render/footer.test.js`、相关 persistence/app 测试：覆盖焦点切换、滚动、选择重置和渲染裁剪。

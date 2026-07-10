## Why

当前 `/resume` 只在通用单选列表中显示 session metadata 和最后一条消息摘要，用户很难在多个相近历史会话之间快速判断要恢复哪一个。已有终端历史浏览 demo 验证了左侧 session 列表、右侧消息预览的布局更适合恢复场景，因此需要把 `/resume` 从纯列表提升为可预览的历史浏览面板。

## What Changes

- 为 `/resume` 引入专用的历史恢复 command surface，视觉上采用左侧 session 列表和右侧消息预览面板。
- 保持现有 `/resume` 交互语义：`Up/Down` 移动、`Enter` 恢复、`Esc` 取消，不增加预览区滚动或搜索。
- 在预览面板中展示选中 session 最近几条 transcript record 的 role 和截断文本，帮助用户确认上下文。
- 保持 session 列表按 `updatedAt` 倒序，并保留最多 5 条可见窗口的现有行为。
- 空状态、恢复确认、取消恢复和 response lock 行为保持不变。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `terminal-tui-prototype`: 修改 `/resume` command surface 的用户可见要求，从通用 `select` 列表升级为带消息预览的专用历史恢复面板。

## Impact

- 影响 `src/commands/resume-command-handler.ts` 的 surface 构造和 session preview 数据组织。
- 影响 `src/types/command.ts` 的 command surface 类型定义。
- 影响 `src/render/footer/command-surfaces.ts` 及新增 footer surface renderer 模块。
- 可能影响 transcript metadata/listing seam，以便 `/resume` 获取最近几条消息预览；不改变持久化 session 文件格式中的完整 `records[]`。
- 需要更新 `/resume` command、app 集成和 footer renderer 相关测试。

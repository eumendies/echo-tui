## Why

`/resume` 与 `/reference` 的右栏预览目前只保留每个会话最近 20 条记录（`SESSION_PREVIEW_RECORD_LIMIT = 20`），且每条消息被压成单行、超出右栏宽度直接截断，长会话中更早的对话和消息正文都无法在预览中看到，恢复或引用会话前无法确认完整内容。用户希望不引入独立查看器界面，直接让现有右栏预览承载完整会话内容。

## What Changes

- 取消 transcript store 预览记录的 20 条上限：`loadSessionPreview` 返回会话全部可见文本记录；连续 subagent 运行仍折叠为单条摘要，单条文本保持 500 字符截断
- 预览保持每条记录单行摘要投影（超出右栏宽度省略号截断），滚动按渲染行（等于记录数）裁剪，配合条数放开后可逐条遍历全部消息；`↑ n 更多 / ↓ n 更多` 滚动提示逻辑保持不变
- resume 双栏面板高度随终端自适应：renderer 接收 `maxLines` 行数预算，面板主体高度 = `maxLines − 6`（顶边、标题、表头、分割线、键位提示、底边共 6 行固定）；未提供 `maxLines` 时保持现有 8 行
- `previewScroll` 的数据层上界钳制（按消息条数计算）移除，滚动边界由渲染层在投影后统一钳制；数据层仅保证偏移非负
- 左栏会话窗口从数据层分页（`pageSize = 5`、`windowStart`）改为渲染层 `createSelectedWindowRows` 投影：`ResumeCommandSurface` 删除 `hiddenSessionCountAbove` / `hiddenSessionCountBelow` 字段，`selectedIndex` 改为完整候选列表中的绝对索引，`resume-command-handler` 移除 `RESUME_PAGE_SIZE` 导出
- `/reference` 与 `/resume` 共用 session-browser 纯状态层与 resume renderer，同步获得上述预览与布局行为

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `resume-session-browser-performance`: 预览记录从"最近 20 条有界"改为"覆盖会话全部可见文本记录"，预览缓存随之承载全量预览记录；列表分页窗口与滚动钳制职责从数据层移到渲染层；新增预览多行换行渲染与面板高度自适应要求

## Impact

- `src/persistence/transcript-store.ts`：移除 `SESSION_PREVIEW_RECORD_LIMIT`，`createSessionPreviewRecords` 保留全部可见文本记录
- `src/commands/session/session-browser.ts`：移除 `SESSION_BROWSER_PAGE_SIZE`、`SESSION_BROWSER_PREVIEW_PAGE_SIZE`、`windowStart` 分页与 `previewScroll` 消息级上界钳制
- `src/types/command.ts`：`ResumeCommandSurface` 删除 `hiddenSessionCountAbove` / `hiddenSessionCountBelow`，`selectedIndex` 与 `sessions` 语义调整为完整列表与绝对索引
- `src/render/footer/resume-surface.ts`：预览多行换行投影、左栏渲染层窗口、`maxLines` 高度自适应
- `src/render/footer/command-surfaces.ts`：resume 分支向 renderer 传入 `options.maxLines`
- `src/commands/resume-command-handler.ts`：移除 `RESUME_PAGE_SIZE` 导出
- 内存权衡：预览记录与 `TranscriptContext` 预览 LRU（最多 5 项）随完整记录增长，大会话占用相应增大；该权衡由用户明确接受，且完整恢复路径仍以 `loadSession` 为事实来源，预览不写入 journal 或 index
- 测试影响：`test/commands/slash-command.test.js`（窗口与滚动断言）、`test/render/footer.test.js`（surface 字段与布局断言）、`test/persistence/transcript-store.test.js`（新增超过 20 条全保留用例）

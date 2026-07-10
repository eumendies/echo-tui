## Context

`/resume` 当前通过 `TranscriptStore.listSessions()` 读取当前 cwd 下的 session metadata，并为每个 session 派生 `previewRecords`。现状中 preview 只包含最近 5 条记录、每条最多 120 字，renderer 将每条记录投影成右侧一行，因此 preview 更像“短摘要列表”而不是可浏览内容。

`@` file picker 已经引入了用户可理解的双栏交互：左侧列表负责选择对象，右侧 preview 可以获得焦点并用 Up/Down 滚动。`/resume` 的布局同样是左侧 session 列表 + 右侧 preview，适合复用这个交互模型，但不需要抽象出通用双栏组件。

## Goals / Non-Goals

**Goals:**

- 让 `/resume` 右侧 preview 能在独立 focus 下滚动更多内容。
- 保持左侧 session 选择窗口和恢复语义稳定：Enter 恢复、Esc 取消、Up/Down 在 list focus 下选择 session。
- 增加 preview 可用信息量，同时保持 bounded metadata，不修改 session 文件 schema。
- 让 renderer 在窄屏和长 preview 下仍遵守 footer 安全宽度与高度约束。

**Non-Goals:**

- 不把 `/resume` 做成完整 transcript 浏览器，不懒加载完整 session 全文。
- 不新增搜索、PageUp/PageDown、跳到顶部/底部等高级浏览能力。
- 不修改 transcript session 持久化 schema。
- 不抽象通用双栏滚动 surface 框架。

## Decisions

### 1. 使用 list / preview 双焦点而不是复用 Up/Down 的隐式模式

`/resume` command data 增加 `focus: 'list' | 'preview'` 和 `previewScroll`。list focus 下 Up/Down 继续移动 session；preview focus 下 Up/Down 滚动右侧内容。Right 或 Tab 进入 preview，Left 返回 list。

这样和 file picker 的心智模型一致，也避免引入额外快捷键。Enter 和 Esc 不随 focus 改变，分别继续恢复当前 session 和取消 `/resume`。

### 2. preview 数据仍来自 session metadata 派生，但扩大派生窗口

继续在 `listSessions()` 阶段从完整 session records 派生 preview metadata，但把限制从“最近 5 条、每条 120 字”调整为更适合滚动的 bounded 数据，例如最近 20 条、每条 500 字。这样不改变落盘 schema，也不要求 command handler 在选择变化时重新读文件。

替代方案是选中 session 后懒加载完整 session；它能提供完整预览，但会要求 `CommandHost` 暴露只读加载能力、处理移动选择时的 IO 与缓存，并增加 late state 问题。第一版不采用。

### 3. renderer 将 preview records 投影为单行摘要窗口

`resume-surface` 不再让 preview 总记录数决定整个 surface 高度，而是把每条 preview record 投影为一行 `ROLE text` 摘要，再用 `previewScroll` 和固定 body height 裁剪。每条 preview record 保留 role 前缀，正文按右栏宽度截断，保持原有摘要列表形态。

renderer 负责按当前右栏宽度 clamp `previewScroll` 的可见效果；command handler 只保证 scroll 不小于 0，不需要知道 terminal 宽度。

### 4. session 选择变化重置 preview scroll

当 list focus 下移动到另一个 session 时，`previewScroll` 重置为 0，避免新 session 打开时停留在旧 session 的滚动偏移。preview focus 下滚动不改变 `selectedIndex` 或 `windowStart`。

## Risks / Trade-offs

- preview metadata 变多导致 `/resume` 打开时占用更多内存 → 继续使用固定记录数和固定文本长度上限，并只派生展示数据。
- renderer 的 preview 可见行数由固定 body height 决定，command state 无法精确限制 scroll 上限 → renderer 负责窗口裁剪和空行填充，过大 scroll 只显示接近尾部的合法窗口。
- 新增 focus 后快捷键提示可能变复杂 → 使用和 file picker 一致的简短提示：`↑↓ 选择/滚动 · →/Tab 预览 · ← 列表 · Enter 恢复 · Esc 取消`。
- 右侧预览变长可能撑高 footer → body height 使用固定上限并遵守现有 footer 布局预算，不由全部 preview 行数决定高度。

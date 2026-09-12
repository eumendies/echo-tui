## Context

`/resume` 与 `/reference` 共用 `src/commands/session/session-browser.ts` 的纯状态层、`SessionBrowserPreviewController` 防抖控制器和 `src/render/footer/resume-surface.ts` 双栏 renderer。当前右栏预览由 `TranscriptStore.loadSessionPreview` 的 `createSessionPreviewRecords` 只保留最近 `SESSION_PREVIEW_RECORD_LIMIT = 20` 条可见文本记录（单条文本截断 500 字符，连续 subagent 运行折叠为单条），渲染时每条记录再压成单行并按右栏宽度截断；`previewScroll` 在数据层按"消息条数 − `SESSION_BROWSER_PREVIEW_PAGE_SIZE = 8`"钳制上界。左栏候选窗口由数据层 `pageSize = 5` 与 `windowStart` 分页维护，surface 通过 `hiddenSessionCountAbove` / `hiddenSessionCountBelow` 传递窗口提示。footer 渲染链路已向各 surface 传入 `maxLines`（终端行数 − 2 顶部 padding − 1 spacer），copy、config 等 surface 已按该预算在渲染层完成高度自适应与窗口投影。

## Goals / Non-Goals

**Goals:**

- 预览框在不新增独立界面的前提下遍历会话全部可见内容：记录条数不设上限，逐条消息以单行摘要滚动遍历
- 面板高度随终端行数自适应，高终端一屏看到更多预览行与候选
- 保持 `/resume` 与 `/reference` 共用状态层与渲染器的既有架构，以及现有导航语义（→/Tab 切焦点、↑↓ 滚动、Enter 确认、Esc 取消）

**Non-Goals:**

- 不引入独立的全量会话查看器 surface 或新按键
- 不改变单条文本 500 字符截断与 subagent 折叠投影
- 不增加 PgUp/PgDn 翻页滚动
- 不改动 journal / index 持久化格式与完整恢复（`loadSession`）路径

## Decisions

### 1. 预览记录数量不设上限，文本保持 500 字符截断

`createSessionPreviewRecords` 移除 `SESSION_PREVIEW_RECORD_LIMIT` 循环边界，遍历最终 session 的全部 records。读取成本不变：`loadSessionPreview` 本就整文件读取并 replay，20 条只是返回边界而非 I/O 优化点。单条文本继续 `SESSION_PREVIEW_TEXT_LIMIT = 500` 截断，叠加连续 subagent 折叠，单会话预览体积与"最长消息 × 记录数"线性相关，由 `TranscriptContext` 最多 5 项的 LRU 承载。备选方案"调大到固定 N 条"会在超长会话重新截断，与"看到完整内容"的目标冲突，不采用。

### 2. 预览保持每条记录单行投影

预览渲染行数等于可见文本记录数：每条记录压成单行，正文超出右栏安全宽度时按现有 `clampPlainText` 以省略号截断。曾按"完整展示长消息正文"设计为按右栏宽度折行，但手动验证反馈：500 字符截断的长消息会折成 10 行以上，在未引入 PgUp/PgDn 翻页的前提下，一条消息跨多屏滚动导致遍历全部消息的体验明显变差。单行摘要下逐条滚动即可遍历全部消息，与既有渲染语义一致；`stripAnsi` 仍保留在投影前，避免 ANSI 序列破坏宽度计算。

### 3. 面板高度自适应采用 copy-surface 同款预算

`renderResumeSurface` 增加 `maxLines` 参数：主体高度 = `Number.isFinite(maxLines) ? max(1, maxLines − 6) : 8`，固定外壳 6 行 = 顶边 + 标题 + 表头 + 分割线 + 键位提示 + 底边。`command-surfaces.ts` 的 resume 分支改为传入 `options.maxLines`，外层 `constrainLayoutTail` 保留作为极小终端的最终兜底。备选方案"数据层 pageSize 跟随终端高度"需要 command 层感知终端尺寸并重复高度公式，且窄终端下仍会被尾部裁剪，复杂度更高，不采用。

### 4. 滚动上界钳制交给渲染层

主体高度随终端自适应（默认 8 行，实际由 footer 的 maxLines 决定），数据层按固定消息条数计算的 `maxPreviewScroll` 无法反映真实视口高度，因此删除数据层上界（`normalizeSessionBrowserData` 仅钳制非负），`createPreviewRows` 现有的 clamp 成为唯一边界。滚动超出上界时按键仍会更新 data 并触发一次重绘（显示不变），与现状"每次滚动按键都重绘"一致；选中项变化时 `previewScroll` 重置为 0 的既有行为保留。

### 5. 左栏窗口移到渲染层 `createSelectedWindowRows`

数据层删除 `pageSize`、`windowStart` 与 `resolveWindowStart`，`createSessionBrowserSurface` 输出完整候选列表与绝对 `selectedIndex`；renderer 用 `createSelectedWindowRows(sessions, selectedIndex, bodyHeight)` 以选中项为中心投影窗口与上下更多提示。surface 删除 `hiddenSessionCountAbove` / `hiddenSessionCountBelow` 字段，`resume-command-handler` 移除仅服务于旧分页的 `RESUME_PAGE_SIZE` 导出。左栏与右栏由此共用同一主体高度，窗口实现单点维护；`confirmResumeSelection` / `confirmReference` 仍按数据层绝对索引取候选，确认语义不变。备选方案"数据层窗口调大 pageSize"在窄终端下会让左栏溢出或被 `constrainLayoutTail` 裁掉底边，不采用。

## Risks / Trade-offs

- [大会话预览内存与预览 LRU 占用增长] → 单条文本 500 字符截断 + 最多 5 项 LRU 兜底；该权衡由用户明确接受；完整恢复路径仍以 `loadSession` 为事实来源，预览不写入 journal 或 index。
- [renderer 每帧全量折行投影 O(总字符数)] → 数千条消息的极端会话滚动重绘可能变慢；如实测卡顿，后续可引入以 records 引用与宽度为 key 的投影缓存，本期不增加该复杂度。
- [surface 契约变化影响 `/reference`] → 共享层一次性修改并同步更新两处命令测试；`/reference` 的确认路径与引用总结生命周期不受影响。
- [previewScroll 数据层无上界可能持续增长] → 数值增长无害，选中变化即重置为 0；渲染层 clamp 保证显示正确。
- [极小终端（少于约 10 行）主体预算不足] → 主体下限 1 行，外层 `constrainLayoutTail` 兜底，与 copy surface 行为一致。

## Migration Plan

1. store 层移除预览记录上限并补充"超过 20 条全保留"测试；
2. 调整 session-browser 状态层与 `ResumeCommandSurface` 契约；
3. 重写 resume renderer 的预览与左栏投影并接入 `maxLines`；
4. 同步更新 slash-command、footer renderer 两处测试；
5. 全量 `npm run typecheck`、`npm test`、`node --check`。

无持久化迁移：journal、index 格式不变，预览始终是按需只读投影；回滚仅需还原代码。

## Open Questions

（无：记录条数不限、单条文本保持 500、不加翻页键、面板高度自适应均已由用户确认。）

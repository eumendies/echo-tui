## 1. 数据层：取消预览记录上限

- [x] 1.1 在 `src/persistence/transcript-store.ts` 移除 `SESSION_PREVIEW_RECORD_LIMIT`，`createSessionPreviewRecords` 遍历全部可见文本记录；subagent 折叠与 `SESSION_PREVIEW_TEXT_LIMIT = 500` 保持不变
- [x] 1.2 在 `test/persistence/transcript-store.test.js` 新增用例：超过 20 条记录的会话，`loadSessionPreview` 返回全部可见文本记录

## 2. 状态层与 surface 契约

- [x] 2.1 在 `src/commands/session/session-browser.ts` 移除 `SESSION_BROWSER_PAGE_SIZE`、`SESSION_BROWSER_PREVIEW_PAGE_SIZE`、`pageSize`、`windowStart` 与 `resolveWindowStart`；`previewScroll` 仅钳制非负，`normalizeSessionBrowserData` 与 `navigateSessionBrowser` 同步简化
- [x] 2.2 在 `src/types/command.ts` 的 `ResumeCommandSurface` 删除 `hiddenSessionCountAbove` / `hiddenSessionCountBelow`，`sessions` 与 `selectedIndex` 注释改为完整列表与绝对索引语义
- [x] 2.3 在 `src/commands/resume-command-handler.ts` 移除 `RESUME_PAGE_SIZE` 导出；确认 `confirmResumeSelection` 仍按数据层绝对索引取候选

## 3. 渲染层：预览投影与高度自适应

- [x] 3.1 在 `src/render/footer/resume-surface.ts` 保持预览单行投影：`stripAnsi` 后按右栏宽度 `clampPlainText` 省略号截断；按行 slice 与 `↑ n 更多 / ↓ n 更多` 提示逻辑保持不变
- [x] 3.2 在 `src/render/footer/resume-surface.ts` 为左栏接入 `createSelectedWindowRows(sessions, selectedIndex, bodyHeight)`，以选中项为中心投影窗口与上下更多提示
- [x] 3.3 在 `src/render/footer/resume-surface.ts` 增加 `maxLines` 参数：主体高度 = `Number.isFinite(maxLines) ? max(1, maxLines − 6) : 8`；在 `src/render/footer/command-surfaces.ts` 的 resume 分支传入 `options.maxLines`，保留外层 `constrainLayoutTail` 兜底

## 4. 测试更新

- [x] 4.1 更新 `test/commands/slash-command.test.js`：移除 `windowStart`、hidden counts、`RESUME_PAGE_SIZE` 与 previewScroll 钳制断言，改为绝对索引与原始偏移断言
- [x] 4.2 更新 `test/render/footer.test.js`：resume surface 测试改为完整候选 + 绝对 `selectedIndex` 输入，新增单行截断、窗口提示与 `maxLines` 高度自适应断言

## 5. 验证

- [x] 5.1 依次运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 5.2 手动验证：`npm start` 后 `/resume` 与 `/reference` 打开长会话，确认预览单行摘要完整、面板高度自适应、↑↓ 滚动可达底部、→/Tab 切焦点、Enter 恢复/引用与 Esc 取消行为不变

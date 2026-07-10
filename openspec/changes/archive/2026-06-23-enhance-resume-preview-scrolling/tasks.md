## 1. Resume 数据与事件状态

- [x] 1.1 扩展 `/resume` command data，增加 `focus` 和 `previewScroll`，并在 `normalizeResumeData` 中提供默认值和边界归一化。
- [x] 1.2 扩展 `ResumeCommandSurface` 类型，向 renderer 暴露当前焦点和 preview scroll。
- [x] 1.3 更新 `createResumeSurface`，传递 focus、previewScroll，并更新 dismiss hint 说明选择/滚动/焦点切换快捷键。
- [x] 1.4 更新 `/resume` 事件处理：list focus 下 Up/Down 移动 session 且重置 scroll；preview focus 下 Up/Down 滚动 preview；Right/Tab 切到 preview；Left 回到 list；Enter/Esc 保持原语义。

## 2. Preview 数据派生与渲染

- [x] 2.1 调整 transcript store 的 resume preview 派生上限，让 metadata 包含更多最近记录和更长文本，但不修改 session 持久化 schema。
- [x] 2.2 保持 resume preview 单行摘要列表形态：role 前缀保留，每条消息按右栏宽度截断。
- [x] 2.3 在 renderer 中使用 previewScroll 对 preview lines 做窗口化裁剪，长 preview 不得撑高 footer。
- [x] 2.4 在 preview focus 下提供明确视觉反馈，并在存在隐藏内容时显示上/下剩余提示或等价滚动提示。
- [x] 2.5 保持窄屏安全宽度约束，确保每一行 display width 不超过 safe render width。

## 3. 测试与验证

- [x] 3.1 增加 `/resume` command handler 测试，覆盖焦点切换、preview scroll、preview focus 下不移动 session、list 选择变化重置 scroll。
- [x] 3.2 增加 resume surface renderer 测试，覆盖单行 preview、scroll 后展示后续内容、preview focus 视觉反馈、窄屏不溢出。
- [x] 3.3 更新 transcript store 测试或相关用例，覆盖更大的 previewRecords 派生窗口和文本长度上限。
- [x] 3.4 更新 OpenSpec 对应任务或测试断言中关于 `/resume` preview “不支持独立滚动”的旧预期。
- [x] 3.5 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 3.6 手动验证 `npm start` 下 `/resume` 打开、session 选择滚动、preview focus 切换、右侧滚动、Enter 恢复、Esc 取消和 resize 后布局稳定。

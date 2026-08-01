## 1. Renderer 重构

- [x] 1.1 在 `src/render/tool-message-renderers/read-files.ts` 引入专属常量 `READ_FILES_MAX_DISPLAY_LINES = 30`，并在文件头注释说明其与共享 `TOOL_RESULT_MAX_DISPLAY_LINES` 的关系
- [x] 1.2 将 `renderReadFilesToolResultLines` 改为先解析全部 envelope，再按 `p = floor((30 - H - (outputTruncated ? 1 : 0)) / contentCount)` 计算内容行预算，其中 H 为 envelope 数量、contentCount 为成功 text 与 directory 数量之和
- [x] 1.3 移除 `⎿` 前缀与 `truncateDisplayText` 整体截断，改为逐 envelope 树状渲染后合并；保留 `output_truncated` 状态为整块末尾提示行并计入预算

## 2. 树状投影

- [x] 2.1 实现树前缀选择：非最后一个 envelope 的 header 用 `  ├─ `，最后一个用 `  └─ `（`renderReadFilesEnvelope` 族函数按需接收 isLast 参数）
- [x] 2.2 实现内容行 rail：非最后一个 envelope 的内容行用 `  │ `，最后一个闭合为 `    `；text 预览行格式为 `rail + 右对齐行号 + │ + 内容`，同文件内行号右对齐到该文件预览行最大宽度
- [x] 2.3 全部行（header、gutter、预览、entries、省略提示）统一使用 `blockText(theme, 'toolOutput', ...)` 单色渲染，不引入 syntax/markdown 高亮

## 3. 内容预览与预算

- [x] 3.1 `renderTextEnvelope` 输出 header + 前 p 个带行号源行作为预览；内容行数超出 p 时最后一行替换为 `… +N more` 提示；文件内容行数不足 p 时按实际行数显示；空文件保持 `lines: empty`
- [x] 3.2 `renderDirectoryEnvelope` 输出 header（追加 entries 计数）+ 预算内 entries；entries 超出 p 条时显示前 p-1 条 + `… +N more`（p=1 显示 1 条不加提示，p=0 不显示）
- [x] 3.3 预览行与 entries 行在输出前按可用宽度（safe render width - 前缀宽度）做尾部省略，复用 grep 的 `clampToDisplayWidth`/`stripAnsi` 思路，保证 1 源行 = 1 物理行

## 4. 测试与验证

- [x] 4.1 新增 `test/render/tool-message-renderers-read-files.test.js`，覆盖：单 text 占满 30 行、多 text 等分预算、text 与 directory 超出预算的省略提示与 entries 计数、最后一个 envelope `└─` 闭合、单一 envelope 闭合、内容行宽度省略、`output_truncated` 提示行、解析失败返回 null 降级
- [x] 4.2 确认 `renderReadFilesToolCallLines` 与 `src/render/tool-message-renderer.ts` 分发路径无需改动，历史 transcript 记录渲染兼容
- [x] 4.3 按序运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`，并请用户 `npm start` 手动验证多文件/单文件/混合类型的树状投影效果

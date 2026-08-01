## Why

当前 `read_files` 结果投影对文本文件只输出一行摘要（`text: <path>  lines: 1-120 (120)`），正文完全不进入终端，用户无法在 transcript 中确认读取内容本身；多文件时也只是平铺多个摘要头。同时现有 `⎿` 前缀（U+23BF）与内容行使用的 `│`（U+2502）不属于同一组 box-drawing 字符，等宽字体下竖线无法对齐，视觉上"折线"与后续内容脱节。

## What Changes

- 将 `read_files` 结果投影从"仅路径摘要"升级为**树状内容投影**：envelope header 使用 `├─` / `└─` 树节点（最后一个 envelope 用 `└─` 闭合），内容行使用与 header 同族且保证对齐的 `│` rail；最后一个 envelope 的内容行 rail 闭合为空格，竖线不悬空。
- 为文本文件结果增加**有界内容预览**：展示带行号前缀的前 N 行正文，行号在文件内右对齐，样式与 grep 匹配行 gutter 一致。
- 为目录结果增加 **entries 展示预算**：超出预算时显示 `… +N more` 省略提示，并在 header 中补充 entries 计数。
- 引入 read_files 专属总预算 `30` 行（不影响共享的 `TOOL_RESULT_MAX_DISPLAY_LINES = 12`，grep 等其他 renderer 不变）；内容行预算由所有内容型 envelope（text 与 directory）**等分**，单文件场景占满剩余预算，多文件场景按请求顺序等分，总行数恒不超过预算。
- 移除 `⎿` 前缀（因对齐不可靠）；`output_truncated` 状态保留为整块末尾的独立提示行并计入预算；`has_more` 内部状态继续不进入终端投影。
- 全部投影保持 `toolOutput` 单色，**不应用语法高亮**；每行内容按可用宽度做尾部省略，保证 1 源行 = 1 物理行，行数预算精确。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tool-message-rendering`: 修改 `read_files result projection` requirement——从"不常态显示 fenced block 正文"改为"在 30 行专属预算内展示有界树状内容预览"，并新增树状连接、等分预算、内容省略提示与单色样式的 requirement 场景。

## Impact

- `src/render/tool-message-renderers/read-files.ts`: 结果投影重构，调用行摘要不变；`renderReadFilesEnvelope` 及其子渲染函数改为产出树状行并接受预算参数。
- `src/render/tool-message-renderer.ts`: 仅消费现有导出，无接口变化。
- 测试：新增 `test/render/tool-message-renderers-read-files.test.js`（单文件占满、多文件等分、目录省略、闭合节点、宽度省略、降级 fallback）。
- 不改动 `src/tools/read-files/`、transcript record、`details.display` metadata 或共享 `shared.ts` 常量；会话回放与 resize 重渲染自然兼容。

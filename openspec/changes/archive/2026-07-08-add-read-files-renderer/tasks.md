## 1. Renderer 结构与接入

- [x] 1.1 新增 `read_files` 专属 renderer 模块，保持与现有 apply_patch、todo renderer 相同的分层方式
- [x] 1.2 在 `renderToolRecordLines` 中按 `read_files` toolName 分发到专属 renderer，并保留解析失败时的通用 fallback
- [x] 1.3 确保 tool call 行继续使用 `◆ ` 前缀、call status 颜色和 snake_case 工具名

## 2. Tool call 摘要

- [x] 2.1 解析 `argumentsText.files`，支持单路径、多路径、offset 和 limit 的摘要展示
- [x] 2.2 在 arguments 无法解析或结构不符合预期时安全降级，不抛出渲染异常
- [x] 2.3 为路径过多或过长的调用提供省略摘要，避免完整 JSON 污染 transcript

## 3. Tool result 投影

- [x] 3.1 解析 `read_files` result envelope：`--- <kind>: <path>`、字段行、列表和 fenced block
- [x] 3.2 渲染 text 结果，显示路径、类型、读取摘要和截断状态，隐藏正文与 envelope/fence 噪音
- [x] 3.3 渲染 directory 结果，显示路径、类型和直接子项列表，保留类型与大小信息
- [x] 3.4 渲染 image 与 pdf 结果，展示附件/大小/页数等元数据，隐藏 PDF 提取文本正文
- [x] 3.5 渲染 error 或 unsupported 结果，突出失败路径、类型、错误和原因
- [x] 3.6 遵守现有 tool output 显示预算、safe render width 和 ANSI theme 约束

## 4. 测试与验证

- [x] 4.1 添加或更新渲染测试，覆盖 `read_files` call 摘要、text、directory、image、pdf、错误和 fallback 场景
- [x] 4.2 确认专属 renderer 不改变 transcript record、tool result 文本、attachments 或 provider continuation 语义
- [x] 4.3 运行 `npm run typecheck`
- [x] 4.4 运行 `npm test`
- [x] 4.5 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`

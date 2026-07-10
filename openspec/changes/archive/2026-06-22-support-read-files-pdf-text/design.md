## Context

`read_files` 当前已经支持 UTF-8 文本读取和 PNG/JPEG/GIF/WebP 图片附件读取。PDF 文件虽然会被识别为 `kind: pdf` / `application/pdf`，但仍作为 unsupported media 返回，模型无法看到 PDF 中的文字内容。

本变更目标是补齐 PDF 中“可提取文字”的读取能力。和 Claude Code 一类工具的 PDF document block 或 PDF 页面转图片方案不同，本变更刻意保持 provider-neutral：PDF 内容最终仍是普通工具文本结果，不新增 provider-specific document 附件，也不依赖 Poppler/OCR 等系统能力。

## Goals / Non-Goals

**Goals:**

- 让 `read_files` 能读取可搜索 PDF 中的文字内容，并以现有 tool result 文本形式返回。
- 保持和文本文件一致的安全边界：文件数量限制、PDF 文件大小限制、单文件输出限制、总输出限制和 `truncated` metadata。
- 对加密 PDF、损坏 PDF、无可提取文字 PDF 返回明确错误，不抛出未捕获异常。
- PDF 读取结果不包含原始 PDF 二进制或 base64，不生成图片或 document 附件。
- 使用 `pdfjs-dist` 做 PDF 文本提取，避免要求用户安装 Poppler 等系统工具。
- 当 `read_files` 单文件实现继续膨胀时，做适度目录拆分以维持可读性。

**Non-Goals:**

- 不做 OCR，扫描版 PDF 没有文字层时不尝试识别图片文字。
- 不做 PDF 页面渲染，不把 PDF 页转成 PNG/JPEG 图片附件。
- 不新增 `pages`、`pageOffset`、`mode` 等工具参数；PDF 读取继续使用当前 `files[].path` 和既有输出限制。
- 不保留复杂版面语义，不保证表格、双栏、公式、页眉页脚顺序完全还原。
- 不新增 provider converter 行为；OpenAI/Anthropic 均只接收普通 tool result 文本。

## Decisions

### 1. PDF 作为文本提取 reader，而不是附件 reader

PDF 分支在 `readOneFile` 中独立处理：检测到 `media.kind === 'pdf'` 后调用 PDF 文本提取 helper，成功后格式化为和文本文件类似的 envelope。

替代方案：把 PDF 作为 `application/pdf` document 附件发送给 provider。该方案对 Anthropic 更自然，但 OpenAI Chat 兼容 API 支持不稳定，并且需要新增 `ToolResultDocumentAttachment` 和多个 provider converter 分支，超出“仅做文字提取”的范围。

### 2. PDF 文本提取依赖固定为 `pdfjs-dist`

实现阶段使用 `pdfjs-dist` 提取 PDF 文字内容。`pdfjs-dist` 相比简单封装库更接近 PDF.js 原始能力，能逐页获取 text content，便于后续输出 page count、逐页聚合和截断 metadata。实现时需要验证它在 Node.js >= 20 和当前 TypeScript CommonJS 输出下的导入方式，必要时使用动态 `import()` 隔离 ESM 兼容性。

替代方案：使用 `pdf-parse`。该方案 API 更简单，但控制力较弱，页面级 metadata 和错误分类不如直接使用 PDF.js 清晰。另一个替代方案是调用 Poppler 的 `pdftotext`，文本抽取能力强，但要求用户安装系统工具，并带来跨平台安装、GPL 分发边界和错误提示复杂度，不作为第一版默认路径。

### 3. `offset` / `limit` 不重新解释为 PDF 页码

当前工具 schema 中 `offset` / `limit` 的语义是文本行分页。为了避免同一字段在不同文件类型下含义变化，本变更不把它们解释为 PDF 页码。PDF 提取出的文本在格式化和大小限制后返回；若未来需要页码范围，应新增显式参数并单独设计。

### 4. PDF 结果使用 metadata 说明提取边界

PDF envelope 应包含 `size_bytes`、`pdf_text_extracted: true`、`page_count`（如依赖可提供）、`content_truncated`、`has_more` 或等价 metadata。正文使用清晰的 `extracted_text:` fenced block，避免和原始 PDF 二进制混淆。

### 5. 无可提取文本视为该文件读取失败

如果 PDF 解析成功但没有可用文字，应返回该 file item 的 `ok: false`，reason 表示 `no extractable text` 或等价语义。批量读取时，其他成功文件结果仍保留，整体 result 按既有规则标记为失败。

### 6. 仅在必要时适度拆分 `read_files` 实现

当前 `read-files-tool-handler.ts` 已包含参数校验、文本 reader、图片 reader、媒体识别、格式化和限制逻辑。加入 PDF 后如果单文件明显过长或职责混杂，应把 `read_files` 相关实现移入 `src/tools/read-files/` 子目录，并保留现有 `src/tools/read-files-tool-handler.ts` 作为薄入口或兼容导出。

推荐拆分粒度保持克制：

- `handler.ts` 或现有入口：工具 definition、execute、顶层调度。
- `readers.ts` / `pdf-reader.ts`：文本、图片、PDF 的实际读取 helper；只有 PDF 逻辑较重时才单独成文件。
- `format.ts` / `media.ts`：仅当格式化或媒体识别继续膨胀时再拆。

不引入 reader class 层级、插件注册表或通用 pipeline，除非后续出现多个复杂文档 reader。第一版目标是降低文件长度和局部复杂度，而不是建立文件解析框架。

## Risks / Trade-offs

- PDF 文本顺序不准确 → 在 metadata 或错误语义中明确该能力是“文字提取”，不承诺版面还原；测试只验证稳定结构，不验证复杂排版。
- 扫描件无文字层 → 明确返回无可提取文字，不做 OCR，避免引入重依赖和不可控耗时。
- `pdfjs-dist` 包体积或 ESM/CommonJS 兼容问题 → 实现前验证 Node 20 + 当前 `tsc` CommonJS 输出可用；必要时用动态 import 包装在 PDF helper 内，避免影响普通 `read_files` 文本/图片路径。
- 大 PDF 内存/耗时过高 → 增加 PDF 文件大小上限，并复用现有文本输出截断策略；解析失败或超限返回明确错误。
- 拆分过度导致跳转成本上升 → 只按现有膨胀点拆 2-4 个文件，不引入 class/registry/pipeline 等提前抽象。
- 依赖许可证风险 → 使用 npm 依赖 `pdfjs-dist`，不内置 Poppler 二进制，不链接 GPL 库。

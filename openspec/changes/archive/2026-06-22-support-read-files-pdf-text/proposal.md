## Why

当前 `read_files` 能读取 UTF-8 文本和受支持图片，但 PDF 仍作为 unsupported media 返回，导致用户无法让模型查看本地 PDF 文档中的文字内容。

为 `read_files` 增加 PDF 文字提取能力，可以覆盖论文、设计文档、合同、报告等常见本地资料，同时保持 provider-neutral 的纯文本工具结果，不引入 PDF 页面渲染、OCR 或 provider-specific document block 的复杂度。

## What Changes

- `read_files` 支持读取 PDF 文件中的可提取文本，并以 bounded 文本结果返回。
- PDF 读取仅做文字提取，不做 OCR、不做页面转图片、不生成 PDF/document 附件，也不把 PDF 原始二进制或 base64 写入结果文本。
- PDF 结果包含 path、absolute path、media/kind、size、page/extraction metadata、截断状态和提取出的文字内容。
- 加入 PDF 文件大小、输出大小、解析失败、加密 PDF、无可提取文本等明确失败或降级语义。
- 引入 `pdfjs-dist` 作为 PDF 文本提取依赖，避免要求用户安装 Poppler 或其他系统级工具。
- 如果 `read-files-tool-handler.ts` 因 PDF 支持继续膨胀，可将 `read_files` 相关实现适度拆到 `src/tools/read-files/` 子目录；仅拆分 reader/helper 级别，避免过度抽象。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-tool-execution`: 扩展 `read_files` 的本地文件读取语义，使 PDF 文件可作为可提取文本读取。

## Impact

- 影响 `src/tools/read-files-tool-handler.ts`，必要时新增 `src/tools/read-files/` 子目录承载 PDF/text/image reader helper。
- 影响 `package.json` / lockfile：新增 `pdfjs-dist` 运行时依赖。
- 影响 `read_files` 工具描述，使模型知道 PDF 支持范围仅限文字提取。
- 需要更新 `test/tools/tool-execution.test.js` 覆盖 PDF 成功提取、无文本/解析失败、大小限制和批量部分失败场景。
- 不影响 provider transcript converter：PDF 以普通工具文本结果参与后续上下文，不新增附件类型。

## 1. 依赖与边界确认

- [x] 1.1 验证 `pdfjs-dist` 的许可证、Node.js >= 20 兼容性，以及当前 TypeScript CommonJS 构建下的导入方式。
- [x] 1.2 将 `pdfjs-dist` 加入 `package.json` 和 lockfile。
- [x] 1.3 为 `read_files` 增加 PDF 文件大小上限配置与安全默认值。

## 2. read_files 结构整理

- [x] 2.1 评估 `read-files-tool-handler.ts` 加入 PDF 后的复杂度；若单文件过长或职责混杂，将 `read_files` 实现适度移动到 `src/tools/read-files/` 子目录。
- [x] 2.2 保留 `src/tools/read-files-tool-handler.ts` 作为薄入口或兼容导出，避免影响默认 tool registry 的导入路径。
- [x] 2.3 拆分仅限 reader/helper/format/media 等直接职责，不引入 reader class、插件注册表或通用 pipeline。

## 3. PDF 文字提取实现

- [x] 3.1 使用 `pdfjs-dist` 实现 PDF 文本提取 helper，替代当前 PDF unsupported 返回。
- [x] 3.2 格式化 PDF 结果 envelope，包含 path、absolute path、kind、media type、size bytes、提取 metadata 和 `extracted_text` 内容块。
- [x] 3.3 对 PDF 提取文本应用单文件内容上限和总输出上限，正确设置 `content_truncated` 与 tool result `truncated`。
- [x] 3.4 对 PDF file item 中的 `offset` / `limit` 明确忽略并在结果文本中标记，不将其解释为页码。
- [x] 3.5 确保 PDF 读取不生成图片附件、document 附件、原始二进制或 base64 文本。

## 4. 失败语义与批量行为

- [x] 4.1 为无可提取文字 PDF 返回明确失败结果，不尝试 OCR 或页面渲染。
- [x] 4.2 为加密、损坏、解析失败或超出 PDF 大小上限的 PDF 返回明确失败结果，不抛出未捕获异常。
- [x] 4.3 确认批量读取中 PDF 成功结果按输入顺序保留，单个 PDF 失败不会丢弃其他成功文本或图片结果。
- [x] 4.4 更新 unsupported media 语义，使 PDF 不再归类为暂不支持媒体，BMP 和其他二进制媒体保持原行为。

## 5. 工具描述与类型整理

- [x] 5.1 更新 `read_files` 工具描述，说明支持 PDF 文字提取且不支持 OCR、页面渲染或 PDF 附件传递。
- [x] 5.2 整理 PDF helper 类型，避免把 `pdfjs-dist` 返回结构泄漏到工具公共类型。

## 6. 测试与验证

- [x] 6.1 增加 `read_files` PDF 成功提取测试，验证 metadata、提取文本、无附件和不暴露 base64。
- [x] 6.2 增加 PDF offset/limit 忽略测试。
- [x] 6.3 增加 PDF 无可提取文本、解析失败或超大小失败测试。
- [x] 6.4 增加批量部分失败测试，覆盖 PDF、文本和图片组合。
- [x] 6.5 若进行了子目录拆分，确认默认 tool registry、测试导入和编译输出路径仍兼容。
- [x] 6.6 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \;`。

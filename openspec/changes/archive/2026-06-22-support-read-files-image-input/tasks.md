## 1. 类型与数据流

- [x] 1.1 在工具结果类型中新增 provider-neutral 图片附件结构，包含 kind、mediaType、dataBase64、path 和 sizeBytes。
- [x] 1.2 在 tool result transcript record 类型中保留可选附件字段，并确保旧 transcript 记录无需迁移即可继续读取。
- [x] 1.3 检查 agent loop 追加工具结果记录的路径，确保 handler 返回的附件会进入 transcript 和后续 provider continuation。

## 2. read_files 图片读取

- [x] 2.1 为 `read_files` 增加受支持图片格式白名单：PNG、JPEG、GIF、WebP。
- [x] 2.2 实现图片读取分支，读取图片 bytes、校验大小上限、生成 base64 附件，并返回简洁 metadata 文本。
- [x] 2.3 对图片 file item 忽略 offset/limit，并在结果文本中标明这些字段对图片读取不生效。
- [x] 2.4 保持 PDF、BMP 和其他暂不支持非文本媒体返回明确 unsupported metadata，且不生成附件。
- [x] 2.5 确认批量读取中成功图片附件按输入顺序保留，单个失败不会丢弃其他成功文件结果。

## 3. Provider 转换

- [x] 3.1 扩展 OpenAI Responses transcript converter，把带图片附件的 tool result 转换为模型可见图片输入，同时保留 function call output 文本。
- [x] 3.2 扩展 OpenAI Chat transcript converter，把带图片附件的 tool result 转换为模型可见 image_url 输入，同时保留 tool message 文本。
- [x] 3.3 扩展 Anthropic transcript converter，把带图片附件的 tool result 转换为包含文本和 image blocks 的 tool_result 内容。
- [x] 3.4 对缺少 mediaType、缺少 dataBase64 或 provider 不支持格式的附件实现安全降级，保留文本 metadata 且不中断请求构造。
- [x] 3.5 确认不带附件的 tool result 仍保持现有纯文本转换行为。

## 4. 渲染、持久化与兼容性

- [x] 4.1 确认 TUI 工具结果展示只显示图片摘要，不展示完整 base64 或二进制内容。
- [x] 4.2 确认 session 保存和恢复能保留图片附件字段，并能兼容没有附件字段的历史 session。
- [x] 4.3 确认上下文压缩、错误过滤和本地 notice 过滤不会意外把附件丢失或误展示为普通文本。

## 5. 测试与验证

- [x] 5.1 更新 `read_files` 工具测试：图片成功读取、offset/limit 忽略、大小超限、unsupported 图片格式和批量部分失败。
- [x] 5.2 增加 OpenAI Responses converter 测试，覆盖单图、多图、无附件和无效附件降级。
- [x] 5.3 增加 OpenAI Chat converter 测试，覆盖单图、多图、无附件和无效附件降级。
- [x] 5.4 增加 Anthropic converter 测试，覆盖单图、多图、无附件和无效附件降级。
- [x] 5.5 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \;`。

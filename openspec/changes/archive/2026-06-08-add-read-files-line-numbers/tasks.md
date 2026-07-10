## 1. 结果格式与实现

- [x] 1.1 扩展 `read_files` 文本读取结果模型，记录返回片段的 `startLine` 和 `endLine`。
- [x] 1.2 将文本内容格式化为带真实 1-based 文件行号的内容块，并将字段名调整为 `content_with_line_numbers`。
- [x] 1.3 保持现有 `offset`、`limit`、`total_lines`、`returned_lines`、`has_more`、`content_truncated`、截断和错误处理语义不变。
- [x] 1.4 处理空文件或 offset 超过文件末尾时的 `returned_lines: 0` 与空 `end_line` 输出。

## 2. 规格与测试

- [x] 2.1 更新主规格 `openspec/specs/local-tool-execution/spec.md`，同步 read_files 带行号输出要求。
- [x] 2.2 更新 `read_files` 工具测试，覆盖完整读取时的行号输出和 metadata。
- [x] 2.3 更新分页读取测试，验证 offset 后第一条内容行号等于 `offset + 1`。
- [x] 2.4 增加或更新空内容边界测试，验证无返回行时不会输出文件第 0 行。

## 3. 验证

- [x] 3.1 运行 `npm run typecheck`。
- [x] 3.2 运行 `npm test`。
- [x] 3.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 3.4 运行 `openspec validate --all --strict`。

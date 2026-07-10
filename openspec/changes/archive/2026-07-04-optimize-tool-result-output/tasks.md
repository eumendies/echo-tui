## 1. 输出边界确认

- [x] 1.1 确认 provider transcript converter 仍只注入 `tool_result.text`，不改 tool schema、approval、MCP adapter 或 transcript 基础结构
- [x] 1.2 梳理受影响内置工具的现有 formatter 测试断言，标记需要替换为紧凑格式的快照或字符串断言

## 2. 本地工具紧凑输出

- [x] 2.1 优化 `run_bash_command` result 文本：成功时返回输出或无输出提示，失败/timeout/truncated 时保留关键状态
- [x] 2.2 优化 `glob` result 文本：正常返回纯路径列表，空结果和 `has_more` 使用简洁提示
- [x] 2.3 优化 `grep` result 文本：正常返回 `path:line:column: text` 匹配列表，保留无匹配、错误和 `has_more` 语义
- [x] 2.4 优化 `read_files` 文本/目录/图片/PDF result envelope，去除常态 absolute path、media type、offset/limit 等冗余字段
- [x] 2.5 优化 `web_fetch` result 文本，常态只返回 URL/status/content，redirect、分页、截断和 HTTP 错误时输出必要状态
- [x] 2.6 优化 `web_search` result 文本，常态只返回 title/url/snippet，低质量、截断或失败时输出必要诊断
- [x] 2.7 确认 `apply_patch` 成功和失败结果保持简洁，并仅在需要时做小幅格式调整

## 3. 交互和 todo 工具结果

- [x] 3.1 优化 `ask_user_questions` 成功 JSON，返回答案索引、选择标签和自定义文本，不重复完整问题和 option description
- [x] 3.2 优化 `create_todos` JSON，只返回创建 ids 或清空确认，不返回完整 items/openTodos
- [x] 3.3 优化 `complete_todo` JSON，只返回 completed ids 和 not found ids，不返回完整 items/openTodos
- [x] 3.4 更新 todo tool renderer，兼容新紧凑 JSON 和旧 transcript 中的完整 todo 状态 JSON

## 4. 测试与验证

- [x] 4.1 更新 `test/tools/tool-execution.test.js` 中 bash、glob、grep、read_files、web_fetch、web_search、ask_user_questions 和 todo 相关断言
- [x] 4.2 更新 todo renderer 测试，覆盖新紧凑 JSON、旧格式 JSON 和不可解析降级
- [x] 4.3 增加或调整 provider transcript/context usage 测试，确认结构化字段保留且 provider-visible 文本只来自紧凑 `text`
- [x] 4.4 运行 `npm run typecheck`
- [x] 4.5 运行 `npm test`
- [x] 4.6 运行 `find bin src test scripts -name '*.js' -exec node --check {} \\;`
- [x] 4.7 运行 `openspec validate optimize-tool-result-output --strict`

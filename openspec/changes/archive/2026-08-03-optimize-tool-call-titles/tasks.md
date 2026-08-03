## 1. 共享标题格式化

- [x] 1.1 在 tool message 共享渲染层实现无副作用的 sentence case 工具名格式化，覆盖内置名称、snake_case、camelCase、PascalCase 和稳定缩写
- [x] 1.2 实现标准 `mcp__<server>__<tool>` 名称的三层可见标题格式，并为非标准名称保留安全通用 fallback
- [x] 1.3 为工具名格式化和 MCP 标题解析补充聚焦的纯函数测试

## 2. Tool call renderer 统一

- [x] 2.1 将 ask-user-questions、read-files、apply-patch、edit-file 和 todo 专属调用标题改为 sentence case 与 ` · ` 参数摘要，移除函数调用小括号和空括号
- [x] 2.2 调整通用 tool call fallback，使首行只显示格式化工具名，非空原始 arguments 在后续低强调行中有界展示
- [x] 2.3 确认 Bash、Glob、Grep、Web search、Web fetch 和 Using skill 保持既有自然语言标题、状态、rail/tree 与展示预算语义
- [x] 2.4 确认 transcript 正式记录与 footer pending preview 复用同一格式化路径，且不修改原始 transcript/tool facts

## 3. 回归测试与验证

- [x] 3.1 更新 app renderer 测试，覆盖内置工具、通用 fallback、专属解析失败和 MCP tool call 的新标题及参数分层
- [x] 3.2 更新 footer pending preview 测试，验证标题、参数摘要、safe render width 和重绘行预算
- [x] 3.3 运行 `npm run typecheck`、`npm test` 和 JavaScript 批量语法检查，确认完整验证通过

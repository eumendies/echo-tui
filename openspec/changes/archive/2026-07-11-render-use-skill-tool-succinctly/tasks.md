## 1. Renderer 设计落地

- [x] 1.1 新增 `use_skill` 专属工具消息 renderer 模块，解析 `tool_call.argumentsText` 中的非空 `name` 并生成 `Using skill · <skill-name>` 摘要
- [x] 1.2 在工具消息 renderer 分发中接入 `use_skill` 的 pair-aware 成功渲染路径，使成功 call/result pair 只输出一行摘要
- [x] 1.3 为 pending preview 和单独 `use_skill` tool call 接入同样的 `Using skill` 摘要，且不展示 JSON arguments 或 arguments 文本
- [x] 1.4 为 `ok: false` 的 `use_skill` result 保留 bounded failure text，同时继续隐藏成功 result body
- [x] 1.5 确保 malformed `use_skill` call/result 不抛出异常，并在无法解析 skill name 时使用安全摘要或既有 fallback

## 2. 记录保持与边界验证

- [x] 2.1 确认专属 renderer 不修改 transcript record 的 `toolName`、`argumentsText`、`text`、`ok` 和 `toolCallId`
- [x] 2.2 确认 `use_skill` tool handler 的 provider-visible result 文本格式保持不变，完整 skill 正文仍回传模型
- [x] 2.3 确认 direct slash skill invocation 的 `displayText` 行为不受本变更影响

## 3. 自动化测试

- [x] 3.1 添加 transcript renderer 测试：成功 `use_skill` pair 显示 `Using skill · <skill-name>` 且不显示 skill 正文、source path、resources 或 result body
- [x] 3.2 添加 transcript renderer 测试：成功 `use_skill` pair 不显示 arguments 字段名或 arguments 文本
- [x] 3.3 添加 tool call preview 或单独 call 测试：pending `use_skill` 显示 `Using skill · <skill-name>` 且不显示完整 JSON arguments
- [x] 3.4 添加失败 result 测试：`ok: false` 时显示调用摘要和短错误信息，并遵守现有截断/宽度约束
- [x] 3.5 添加记录保持测试：渲染前后原始 transcript records 深度相等

## 4. 文档与验证

- [x] 4.1 如架构文档描述工具消息渲染边界，补充 `use_skill` 成功结果只做简洁可见投影的说明
- [x] 4.2 运行 `npm run typecheck`
- [x] 4.3 运行 `npm test`
- [x] 4.4 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 4.5 运行 `git diff --check`

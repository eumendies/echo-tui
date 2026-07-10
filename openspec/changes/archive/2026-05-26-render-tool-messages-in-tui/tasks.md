## 1. Transcript 类型与渲染分发

- [x] 1.1 扩展 transcript role 类型，明确包含 `tool_call` 与 `tool_result`。
- [x] 1.2 更新 transcript record block 分发逻辑，让 `tool_call` 与 `tool_result` 不再被 unknown role 路径隐藏。

## 2. Tool 消息可见投影

- [x] 2.1 为 `tool_call` 记录提供可见 block/line 渲染，使用与 assistant 一致的 `◆ ` 前缀和 continuation 缩进。
- [x] 2.2 为 `tool_result` 记录提供可见 block/line 渲染，使用与 assistant 一致的 `◆ ` 前缀和 continuation 缩进。
- [x] 2.3 确保工具消息在 transcript snapshot 重绘、destructive resize recovery 和 `/resume` 恢复后仍可显示。

## 3. 测试与验证

- [x] 3.1 增加 render 层测试，覆盖 `tool_call` 与 `tool_result` 的前缀、换行缩进和 unknown role 对比行为。
- [x] 3.2 增加 app/session 相关测试或复用现有恢复测试，覆盖包含工具消息的 transcript 恢复显示。
- [x] 3.3 运行必要验证：`npm run build`、`npm run typecheck`、`npm test`、`find bin src test -name '*.js' -exec node --check {} \;`、`node --check dist/bin/echo-tui.js`、`npx -y @fission-ai/openspec@latest validate render-tool-messages-in-tui --strict`。

## 1. 回归测试

- [x] 1.1 为包含多行 shell 命令和中间 `node -e "..."` 的 `run_bash_command` pending preview 添加测试，断言渲染行不含原始 `\n` / `\r` 且不超过 safe render width。
- [x] 1.2 为相同命令的 transcript bash call/result rail 添加测试，断言每条 shell 逻辑行保持独立 rail prefix 或 continuation prefix。
- [x] 1.3 为 bash command、stdout/stderr 和通用 tool fallback 中的制表符添加测试，断言可见投影展开为空格并保留原始 record 内容。

## 2. Bash command 解析修复

- [x] 2.1 调整 `parseInlineScriptCommand()` 的生效边界，避免多行 shell command 中的 `-c` / `-e` 匹配吞并前后 shell 逻辑行。
- [x] 2.2 保留安全可识别的 heredoc 和单独 inline script 预览行为，并确保复杂命令继续走普通多行渲染 fallback。
- [x] 2.3 增加或复用内部行规范化逻辑，确保进入 bash rail wrapping 的 row text 不包含原始 `\r` 或未拆分的 `\n`。

## 3. Tool wrapping 行安全

- [x] 3.1 更新 `tool-message-renderers/shared.ts` 的 wrapping 逻辑，按当前可见列使用 `tabWidthAt()` 计算并展开制表符。
- [x] 3.2 确认 bash rail、bash result、pending tool preview 和通用 tool fallback 都经过同一 safe width 约束，不输出未预算物理换行。
- [x] 3.3 确认渲染修复只改变可见投影，不修改 transcript record、tool result text、provider continuation 或 session persistence。

## 4. 验证

- [x] 4.1 运行 `npm run typecheck`。
- [x] 4.2 运行 `npm test`。
- [x] 4.3 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`。
- [x] 4.4 手动验证截图同类场景：运行包含多行 shell 命令、内嵌 `node -e` 和制表符输出的 bash tool call，确认 pending/footer 不再残留重复 `Bash · running` 块且 rail 对齐稳定。

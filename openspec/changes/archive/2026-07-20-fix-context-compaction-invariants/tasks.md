## 1. 摘要请求隔离

- [x] 1.1 扩展 provider turn 请求选项并让压缩摘要显式设置 `isCompaction`
- [x] 1.2 更新 OpenAI Responses、OpenAI Chat、Anthropic 与 Codex 请求构造，确保摘要请求不发送 tools 或 reasoning 参数
- [x] 1.3 增加各 provider 的摘要请求隔离测试，并确认普通 turn 行为不变

## 2. 压缩索引一致性

- [x] 2.1 抽取共享 compaction notice record 构造函数并让 app 复用
- [x] 2.2 自动压缩完成后把 notice 同步追加到 runtime record region
- [x] 2.3 增加同一 agent run 连续两次压缩的索引与上下文去重回归测试

## 3. 验证

- [x] 3.1 运行 `npm run typecheck`
- [x] 3.2 运行 `npm test`
- [x] 3.3 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`

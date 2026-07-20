## 1. Responses 共享重试执行器

- [x] 1.1 扩展 Responses stream 错误解析，基于 `server_error` code 或稳定可重试提示识别目标临时错误，并保持错误脱敏与 request ID 文本
- [x] 1.2 实现接收 stream factory 的共享 attempt runner，最多额外重试一次并在每次 attempt 创建新 stream
- [x] 1.3 在共享 runner 中跟踪文本回调、排除 partial text 与 compaction，并实现可响应 AbortSignal 的短退避

## 2. Provider 接入

- [x] 2.1 将 OpenAI Responses `runTurn` 接入共享 runner，复用同一请求快照和现有取消信号
- [x] 2.2 将 Codex `runTurn` 接入共享 runner，并保证每个 turn 只解析一次 OAuth credential、client 和请求快照
- [x] 2.3 保持 OpenAI Chat、Anthropic、SDK 请求级 retry 和 provider-neutral callback/result 协议不变

## 3. 自动化测试与验证

- [x] 3.1 增加 OpenAI Responses 测试，覆盖临时错误后成功、连续失败上限、非目标错误、partial text、compaction、Abort 和最终 request ID
- [x] 3.2 增加 Codex 测试，覆盖临时错误重试成功、OAuth runtime client 只解析一次、连续失败上限及不应重试的边界
- [x] 3.3 运行 `npm run typecheck`、`npm test` 和 JavaScript 批量语法检查

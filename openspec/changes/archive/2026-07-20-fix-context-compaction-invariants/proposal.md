## Why

上下文压缩请求当前复用普通 agent 请求配置，导致摘要请求仍携带全部工具定义和 reasoning 配置，产生不必要的 token、延迟与工具调用风险。同时，自动压缩向持久化 transcript 追加提示记录却未同步 runtime record region，同一 agent run 内再次压缩时会破坏 `activeStartIndex` 的索引一致性。

## What Changes

- 为 provider turn 增加明确的上下文压缩请求用途，使摘要请求禁用工具定义和 reasoning 配置，普通 agent turn 行为保持不变。
- 统一构造 compaction notice，并在自动压缩完成时同步追加到 runtime record region 与 app transcript。
- 增加各 provider 摘要请求和同一 agent run 连续压缩的回归测试。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `context-compression`: 明确摘要请求不得暴露工具或启用 reasoning，并保证压缩状态索引始终对应持久化 transcript records。

## Impact

- 影响 `ProviderAgent.runTurn` 的请求选项和 OpenAI Responses、OpenAI Chat、Anthropic、Codex 请求构造逻辑。
- 影响 context compaction 摘要生成、agent loop runtime 与 app transcript compaction notice 的共享构造。
- 不改变用户配置格式、session schema、普通 provider 请求或手动 `/compact` 的可见行为。

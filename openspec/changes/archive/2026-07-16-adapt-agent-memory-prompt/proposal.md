## Why

当前 agent memory 无论内容多少都只向 provider 注入 catalog 索引，少量记忆也必须通过 `read_memory` 再发起一次工具调用才能使用，增加了延迟和工具上下文。需要根据全部有效 item 的实际上下文成本自动选择展开或折叠，在记忆较小时直接可用、增长后仍保持受控。

## What Changes

- 每次真实 provider request 读取当前 scope 下所有有效 agent memory catalog 及其 enabled items，并估算展开版 prompt 的 token 数。
- 当展开成本不超过模型上下文窗口的 2% 且不超过 8,000 tokens 时，在 transient system prompt 中展开全部有效 item；超过任一限制时保持现有 catalog 索引形式。
- 展开和折叠采用全局二态选择，不在同一请求中混合部分展开与部分折叠的 catalog。
- 展开内容不暴露 scope、enabled、item id、时间戳等内部元数据；需要精确更新或删除 item 时仍通过 `read_memory` 获取 id。
- catalog 或 item 文件读取失败时整轮回退到 catalog 索引，避免静默注入不完整的 memory 集合。
- `/context` 继续将展开或折叠后的 agent memory prompt 统一计入 Memory 分类。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-memory`: 将 provider 每轮固定注入 catalog 索引改为按 token 预算自动选择全部 item 展开或 catalog 折叠，并定义过滤、回退和 prompt 投影语义。
- `context-usage-command`: Memory 分类需要按该轮实际采用的展开或折叠 prompt 计算 token。

## Impact

- 修改 `src/memory/agent-memory-store.ts` 的有效 memory 聚合读取能力，以及相关 memory 类型和存储测试。
- 新增 `src/agent/memory-prompt.ts`，集中处理 user/agent memory 读取、回退、prompt 投影、模式选择和 token 汇总；`system-prompt.ts` 只拼装 sections，`agent-loop-runtime.ts` 只消费解析结果。
- 调整 `read_memory` 工具描述，使其兼容 catalog 索引和已展开 memory 两种 system prompt 状态。
- 更新 agent loop、system prompt、context usage 和 memory tool 测试；不改变磁盘格式、公开 memory tool 参数或第三方依赖。

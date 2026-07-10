## Why

随着多轮对话和工具调用不断累积，transcript 会无限增长，最终超出模型的上下文窗口导致请求失败或截断。需要在发请求前自动检测上下文长度，触及阈值时调用 LLM 生成结构化摘要来压缩历史，同时保留完整会话历史用于展示与 resume。

## What Changes

- 新增上下文压缩能力：发请求前估算上下文长度，预计超过模型上下文窗口的阈值比例时，调用同一个 LLM 生成结构化摘要压缩较早的历史。
- transcript session 持久化结构新增 `compaction` 元数据（摘要文本 + 活跃区间起点索引 `activeStartIndex`），**BREAKING**：直接修改 `TranscriptSession` schema，不兼容旧版本存储。
- provider 请求投影改为：system prompt + 摘要消息（若存在，以 `user` 注入）+ 活跃区间记录（`records[activeStartIndex:]`）；`records[]` 保持全量 append-only 不变。
- 流式响应解析新增对 `response.completed` 事件中 `usage` 的捕获，用作上下文长度的真值校准基线（当前被丢弃）。
- LLM 模型配置新增可选 `contextWindow`，按「用户配置 → 内置常见模型映射表 → 默认值」三级回退解析上下文窗口大小。
- 压缩窗口按「保留最近 K 条」实现，边界吸附到干净的 turn 起点，绝不切断 `tool_call`/`tool_result` 配对。
- 压缩发生时在 transcript 中插入一个可见提示块（如「已压缩 N 条历史为摘要」）；resume 时仅渲染完整 `records[]`，不显示摘要内容。

## Capabilities

### New Capabilities
- `context-compression`: 上下文长度估算、压缩阈值判定、结构化摘要生成、压缩边界计算（保留最近 K 条且不切断工具配对）、压缩状态（摘要 + 指针）的存储与请求投影。

### Modified Capabilities
- `streaming-llm-service-adapter`: 请求投影注入摘要并基于 `activeStartIndex` 切片；流式解析捕获 `usage`；agent loop runtime 在发请求前执行压缩检查与触发；`RunAgent` 入参改为 `AgentSessionInput`；LLM 配置新增 `contextWindow`。
- `terminal-tui-prototype`: session 持久化结构新增 `compaction` 元数据；新增压缩提示块的 transcript 渲染。

## Impact

- 类型：`src/types/transcript.ts`（`TranscriptSession` 新增 `compaction`）、`src/types/agent.ts`（`LlmConfig` 新增 `contextWindow`）。
- 配置：`src/config/llm-config.ts`（解析 `contextWindow` + 内置模型映射表 + 阈值/K 默认值）。
- 适配器：`src/agent/openai-transcript-converter.ts`（切片 + 注入摘要）、`src/agent/openai-agent.ts`（捕获 `usage`）、`src/agent/agent-loop-runtime.ts`（压缩检查与触发）。
- 新增模块：token 长度估算、摘要生成（复用 OpenAI agent 发专门请求）。
- 持久化与渲染：`src/app/transcript-context.ts`、`src/persistence/transcript-store.ts`（持久化 `compaction`），渲染层新增压缩提示块。
- 存储破坏性变更：旧 session 文件不再兼容。

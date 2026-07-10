## 1. 类型与配置

- [x] 1.1 在 `src/types/transcript.ts` 的 `TranscriptSession` 增加可选 `compaction` 元数据类型（`summaryText`、`activeStartIndex`、`createdAt`）
- [x] 1.2 在 `src/types/agent.ts` 的 `LlmConfig` 增加可选 `contextWindow`
- [x] 1.3 在 `src/config/llm-config.ts` 解析 model profile 的可选 `contextWindow`，并在 `readLlmConfig` 透传到生效配置
- [x] 1.4 在 `src/config/llm-config.ts` 增加内置常见模型→上下文窗口映射表与默认值常量，以及压缩阈值比例和保留条数 K 的默认常量

## 2. 上下文窗口与长度估算

- [x] 2.1 实现上下文窗口解析（用户配置 → 内置映射表 → 默认值三级回退）
- [x] 2.2 实现 token 字符估算函数（区分中英文系数）
- [x] 2.3 实现「usage 真值基线 + 新增活跃记录字符增量」的综合预估，及无真值时的纯字符估算回退

## 3. 流式 usage 捕获

- [x] 3.1 在 `src/agent/openai-agent.ts` 的 `readResponseStream` 捕获 `response.completed` 事件中的 `usage.input_tokens`
- [x] 3.2 通过 `AgentTurnResult`/回调把 usage 真值传回 runtime；缺少 usage 时不报错

## 4. 压缩边界与摘要生成

- [x] 4.1 实现压缩边界计算：初始 `records.length - K`，并向前吸附到干净 turn 起点，避免切断 tool_call/tool_result 配对或以孤立 tool_result 开头
- [x] 4.2 实现结构化摘要 prompt（保留关键决策、文件路径、待办、重要工具结果结论）
- [x] 4.3 实现摘要生成：复用 OpenAI agent 发起专门摘要请求，已有旧摘要时连同新增被压缩记录一起输入，产出单条滚动摘要

## 5. 请求投影

- [x] 5.1 按 `activeStartIndex` 切片活跃区间（在 runtime `buildProviderRecords` 中实现；转换器已天然过滤非 provider role）
- [x] 5.2 在 system prompt 之后、活跃区间之前注入携带摘要文本的 `user` 消息；无压缩状态时退化为全量投影

## 6. 压缩触发编排

- [x] 6.1 在 `src/agent/agent-loop-runtime.ts` 发请求前执行压缩检查（解析窗口 → 预估长度 → 比较阈值）
- [x] 6.2 超阈值且记录足以压缩时，同步生成摘要、更新压缩状态并落盘，再继续本轮请求
- [x] 6.3 维护运行时 usage 真值基线，供下一轮预估使用

## 7. 持久化与状态容器

- [x] 7.1 在 `src/persistence/transcript-store.ts` 持久化与读取 `compaction` 元数据（直接改 schema，不兼容旧存储）
- [x] 7.2 在 `src/app/transcript-context.ts` 维护并保存压缩状态，resume 时加载完整 records + 压缩状态

## 8. 渲染提示块

- [x] 8.1 在渲染层实现上下文压缩提示块，样式区别于 user/assistant/error
- [x] 8.2 确认 resume 只渲染完整 `records[]`，不显示摘要文本

## 9. 测试与验证

- [x] 9.1 为边界吸附、长度估算、窗口三级回退、压缩投影切片+摘要注入、usage 捕获补充 `node:test` 单测
- [x] 9.2 运行 `npm run typecheck`
- [x] 9.3 运行 `npm test`
- [x] 9.4 运行 `find bin src test -name '*.js' -exec node --check {} \;`
- [x] 9.5 手动验证：构造长会话触发压缩、提示块显示、压缩后继续对话、resume 行为

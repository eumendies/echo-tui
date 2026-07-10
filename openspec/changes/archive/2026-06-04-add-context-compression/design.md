## Context

echo_tui 的对话历史以 append-only 的 `TranscriptRecord[]` 维护（`src/app/transcript-context.ts`），每次追加都通过 `persistCurrentSession` 全量落盘（`src/persistence/transcript-store.ts`，schema 版本 1）。每次 agent turn 通过 `createProviderRecords`（注入 system prompt）→ `convertTranscriptToOpenAiInput`（`src/agent/openai-transcript-converter.ts`）→ OpenAI Responses API 发送整条 transcript。

当前代码完全没有 token 计数、上下文窗口或 usage 概念：`LlmConfig`（`src/types/agent.ts`）无相关字段，`readResponseStream`（`src/agent/openai-agent.ts:173`）在收到 `response.completed` 时只标记 `completed=true`，丢弃了事件中携带的 `usage`。随着对话变长，请求会逼近甚至超出模型上下文窗口。

约束（来自 AGENTS.md）：不得引入第三方库（含 tiktoken）、不得引入打包器/ESM 转换；模块小而专注；避免不必要的防御分支与抽象；注释用中文。

## Goals / Non-Goals

**Goals:**
- 发请求前自动估算上下文长度，预计超过模型上下文窗口的阈值比例时触发压缩。
- 用同一个 LLM 生成结构化摘要，最大程度降低对模型表现的影响。
- 完整会话历史（`records[]`）永不丢弃，仍用于 UI 展示和 resume。
- 压缩状态以 session 级元数据存储（摘要 + 指针），请求时投影为「摘要 + 活跃区间」。
- 上下文窗口大小按「用户配置 → 内置映射表 → 默认值」解析。
- 压缩发生时给出可见提示块。

**Non-Goals:**
- 不引入 tiktoken 或任何第三方 token 库；只做字符启发式 + usage 真值校准。
- 不做后台异步压缩；压缩同步发生在发请求前。
- 不兼容旧版 session 存储；直接修改 schema。
- resume 不展示摘要内容，只渲染完整 `records[]`（维持现有行为）。
- 不实现摘要可叠加为多条；始终维护单条滚动摘要。

## Decisions

### 决策 1：压缩状态以 session 级 `compaction` 元数据存储，而非逐条打标记

```
TranscriptSession {
  schemaVersion, sessionId, cwd, createdAt, updatedAt
  records: TranscriptRecord[]      // 全量 append-only，不动
  compaction?: {
    summaryText: string            // 结构化摘要
    activeStartIndex: number       // 活跃区间起点：前 N 条已被摘要取代
    createdAt: string
  }
}
```

`records[]` 保持全量、append-only、落盘逻辑不变。`activeStartIndex` 是**活跃区间起点索引**：`records[0:activeStartIndex]` 已被 `summaryText` 取代，`records[activeStartIndex:]` 为活跃区间。

- 为什么用条数索引而非引用对象：数组 append-only，索引稳定，resume 后依然有效。
- 替代方案（已否决）：给每条 `TranscriptRecord` 加 `compacted` 标记——数据冗余、转换层要逐条过滤、resume 渲染需额外判断。session 级单字段更干净，且天然不进 `records[]`，resume 渲染零改动即满足「不显示摘要」。

### 决策 2：请求投影 = system prompt + 摘要消息 + 活跃区间切片

```
provider input =
   [system prompt]                              (现有内置 system prompt)
 + (compaction ? [user: 摘要前言 + summaryText] : [])
 + convert(records[activeStartIndex:])
```

摘要作为一条 `user` 消息注入，置于 system prompt 之后、活跃区间之前。切片在 runtime 的 `buildProviderRecords` 完成，转换器只负责过滤非 provider role（含 `compaction_notice`）。

- 为什么用 `user` role 注入摘要：部分 OpenAI 兼容端点对多条 `system` 消息支持不一致，摘要作为 `user` 背景消息更稳妥，且明确区别于内置 system prompt。

### 决策 3：长度估算 = 字符启发式 + usage 真值校准

- **真值基线**：在 `readResponseStream` 捕获 `response.completed.usage.input_tokens`，作为「上一次请求实际消耗的 prompt token」记入运行时状态。
- **事前估算**：发请求前，对即将发送的投影内容做字符估算（`字符数 / 系数`，中英文系数不同），得到本轮预估 token。
- **结合方式**：以上一轮 usage 真值为基线，叠加自上次请求以来新增活跃记录的字符估算增量，得到当前预估值，与阈值比较。无 usage 真值（首轮）时纯用字符估算。

- 为什么不用 tiktoken：AGENTS.md 禁止引入第三方库，且 usage 真值已能提供精确基线，字符估算只需覆盖增量部分，误差可接受。

### 决策 4：上下文窗口三级回退

```
contextWindow =
  profile.contextWindow            // 用户在 model profile 显式配置
  ?? builtinModelContextWindow(model)   // 内置常见模型映射表（模糊匹配 model 名）
  ?? DEFAULT_CONTEXT_WINDOW        // 默认值（如 128000）
```

阈值 = `contextWindow * COMPACTION_THRESHOLD_RATIO`（如 0.8）。`LlmModelProfile` 与 `LlmConfig` 增加可选 `contextWindow`。

### 决策 5：压缩边界 = 保留最近 K 条，吸附到干净 turn 起点

```
boundary = records.length - K
boundary 向前吸附：若 records[boundary] 是 tool_result 或处于
  tool_call/tool_result 配对中间，则继续前移到最近的 user/assistant 起点，
  确保活跃区间不以孤立 tool_result 开头、不切断工具配对。
新 summaryText = LLM压缩( 旧 summaryText + records[旧 activeStartIndex : boundary] )
新 activeStartIndex = boundary
```

K 为条数（可配置，含默认值）。滚动压缩：旧摘要作为输入喂回压缩 prompt，始终只产出单条摘要，避免无限堆叠。

- 为什么吸附边界：`convertToolResultRecord` 在缺少配对 `function_call` 时会丢弃 tool_result（`openai-transcript-converter.ts:89`），孤立的工具结果会导致 provider input 不自洽。

### 决策 6：触发位置在 agent loop runtime 发请求前，同步阻塞

在 `agent-loop-runtime` 构造 `nextRecords` 前执行压缩检查；若超阈值则先发一次摘要请求、更新 `compaction`、落盘，再继续正常 turn。摘要生成复用 OpenAI agent 能力，发送一条带结构化摘要指令的专门请求（要求保留：关键决策、涉及文件路径、待办、重要工具结果结论）。

## Risks / Trade-offs

- [摘要丢失关键信息导致后续回答质量下降] → 用结构化摘要 prompt 明确要求保留决策/文件/待办/工具结论；保留最近 K 条原文作为近因上下文。
- [压缩本身消耗一次额外 LLM 往返，用户需等待] → 同步压缩仅在超阈值时发生，频率低；提示块告知用户正在压缩。
- [字符估算与真实 token 偏差导致过早或过晚压缩] → 以 usage 真值为基线校准，仅对增量做估算；阈值比例（0.8）留出安全余量。
- [内置模型映射表覆盖不全，未知模型落到默认值] → 默认值取常见保守窗口；用户可显式配置 `contextWindow` 覆盖。
- [边界吸附后实际保留条数可能多于 K] → 可接受，宁可多留也不破坏工具配对自洽性。
- [BREAKING：旧 session 存储不兼容] → 已确认当前未封版，直接改 schema，无需迁移；旧文件按读取失败处理。

### 决策 7：编排放在 agent loop runtime，通过扩展契约把结果冒泡回 app 层

压缩的「触发检查 + 摘要生成」在 runtime 内执行，覆盖每次发请求前（含工具循环内）。但持久化与渲染是 app 职责，因此扩展契约把状态冒泡回 app：

```
CompactionState = { summaryText: string; activeStartIndex: number; createdAt: string }

AgentSessionInput = { records: TranscriptRecord[]; compaction?: CompactionState }
RunAgent = (session: AgentSessionInput, callbacks?) => Promise<unknown>
AgentCallbacks 增加 onCompacted?: (next: CompactionState) => void
AgentTurnResult 增加 usageInputTokens?: number
```

- 入参用 `AgentSessionInput` 单对象，`TranscriptSession` 可直接赋值传入（结构兼容），避免散落的位置参数。
- runtime 持有「上轮 usage 真值」运行时变量；每次发请求前预估 = 真值基线（若有）+ 新增记录字符估算增量。
- `onCompacted` 由 app 落盘压缩状态并追加提示块记录。
- 摘要生成复用 `ProviderAgent.runTurn`：用「摘要指令 + 被压缩记录」作为 records 发一次请求，取 `draft` 作为摘要，忽略其 toolCalls。

### 决策 8：runtime 内用「provider 数组偏移」统一换算指针

`providerRecords = [systemPrompt, (summary?), ...活跃区间]`。压缩逻辑只作用在与 app `records[]` 平行的 `recordRegion` 上，边界与 `activeStartIndex` 直接对齐 `recordRegion` 索引，provider 前缀（system prompt / 摘要）在每轮发请求时另行拼接。工具循环内追加的 tool_call/tool_result 已通过 `onToolResult` 同步落盘到 app `records[]`，两侧记录区内容平行一致。

### 决策 9：压缩提示块作为一条 `compaction_notice` 记录落盘

压缩发生时 app 追加一条 `role: 'compaction_notice'` 记录到 `records[]` 并落盘。该 role：
- 由渲染层新增一个克制样式分支显示（区别于 user/assistant/error）。
- 在 `convertTranscriptToOpenAiInput` 中与 `error` 一样**不发送给 provider**。
- resume 时照常渲染，复现「此处压缩过」的痕迹；但摘要正文只存于 `compaction.summaryText`，不进 records，满足 resume 不显示摘要内容。

## Open Questions

- 内置模型映射表的初始覆盖范围（仅列当前 README/配置示例用到的模型，还是覆盖主流模型）——倾向最小集，按需扩展。
- 摘要请求是否复用当前 selected model，还是允许单独配置摘要模型——默认复用，避免新增配置面。

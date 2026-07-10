## Context

当前实现把 streaming draft 作为 footer pending preview 的完整文本反复重绘。短回复没有问题，但长回复会让 footer 高度持续增长；一旦触发终端滚动，旧 pending 行就会进入 scrollback，后续局部清理无法再删除这些行，于是用户看到多段重复的 `◇` assistant 内容。即使 pending preview 已按 terminal rows 动态折叠，快速缩小 terminal rows 时，旧 footer 仍可能被终端先挤入 scrollback，因此 rows shrink 也需要走完整恢复路径。

真实 OpenAI adapter 当前还会默认发送 `max_output_tokens = 512`。这给用户制造了一个不必要的客户端输出上限，也让长输出更容易以 `response.incomplete` 结束。当前 adapter 没有识别 `response.incomplete`，stream 结束后只因为没有 `response.completed` 而抛出“模型响应流未完成”，错误语义不准确，且容易丢失已生成内容。

本次修复发生在已有多轮 transcript change 之后：agent 输入事实源已经是 `TranscriptRecord[]`，error record 已可见、可持久化、可恢复且不会进入 OpenAI input。

## Goals / Non-Goals

**Goals:**

- 默认不向 OpenAI request 发送客户端输出 token 上限，让服务端和模型自身策略决定输出长度。
- 用户配置不再需要理解或调整 `maxOutputTokens`。
- streaming pending preview 高度有上限，长输出时折叠头部、显示尾部，避免 footer 内容进入 scrollback 造成重复显示。
- terminal rows 快速压缩时执行 destructive recovery，避免旧 pending/footer 残留在 scrollback 里形成重复显示。
- 最终 assistant transcript record 保持完整，不因 streaming preview 折叠而丢失内容。
- 显式识别 `response.incomplete`，提供比“模型响应流未完成”更准确的失败反馈。
- 如果失败前已有 partial draft，用户已经看到的内容应以 transcript 事实保留下来，然后再追加本地 error record。

**Non-Goals:**

- 不实现 uncommitted scrollback writer，不把 streaming 内容直接写入 transcript 区域再回填数据层。
- 不支持工具调用、函数调用、多模态输入或后台任务。
- 不引入数据库、第三方 TUI 库、状态管理框架或新的渲染后端。
- 不尝试绕过服务端或模型自身最大输出限制；若服务端 incomplete，CLI 只负责清晰呈现和保留 partial。

## Decisions

### 1. 移除默认 `max_output_tokens`，而不是提高默认值

默认 request 不包含 `max_output_tokens`。配置读取不再生成默认 `maxOutputTokens = 512`，文档示例也不再包含该字段。

备选方案是把默认值提高到 2048 或 4096，但这仍然要求用户理解客户端 token 限制，并且未来仍会在长输出时制造人为截断。移除默认字段更符合用户预期：API 返回多少，CLI 就显示多少。

### 2. streaming preview 只折叠预览，不折叠最终 transcript

`renderPendingAssistantLines({ kind: 'streaming', text })` 应先按当前宽度生成可见行，再由 footer layout 根据当前 terminal rows、输入区高度、divider 和安全边距动态给出 pending preview 行数预算；超过预算时保留尾部内容，并在第一行展示折叠提示。完整 draft 仍由 app/agent 生命周期累积，`onComplete(finalText)` 时追加完整 assistant record。

备选方案是把 streaming delta 直接 append 到 transcript 区域，但这会引入 uncommitted visual output、resize replay、partial commit 和失败恢复等复杂状态。本次选择成熟 CLI 常见的折叠尾部 preview，以最小架构变化修复滚屏重复。

### 3. `response.incomplete` 是服务端非完整结束，不是本地未知 stream

adapter 应把 `response.incomplete` 识别为一类明确事件，并尽量从事件的 `response.incomplete_details` 中提取原因。它不应落入“stream 结束但未 completed”的兜底错误。

如果 incomplete 前没有任何 draft，adapter 可以 reject 为明确的 incomplete 错误。如果已有 draft，app 层应能先提交 partial assistant record，再追加 error record，保证屏幕上出现过的模型内容可持久化和恢复。

### 4. partial draft 失败语义：先提交 assistant partial，再追加 error

当 stream 失败或 incomplete 前已经生成文本，最终 transcript 应记录：

1. 一条 assistant record，文本为已生成 partial draft。
2. 一条 error record，文本说明响应未完整结束或流异常。

这样用户看到的内容、持久化 session 和后续 `/resume` 保持一致。相比只追加 error，这不会让用户已经看见的大段内容在恢复后消失；相比把 partial 伪装成成功完成，它保留了失败事实。

### 5. rows shrink 触发 destructive recovery

app 层应同时记录上一次成功渲染的 terminal columns 和 rows。columns 变化会改变所有投影的 wrap 结果，继续走 destructive recovery；rows 变小时，旧 footer/pending 可能已经被终端压入 scrollback，局部 footer clear 不再可靠，也应走 destructive recovery。仅 rows 变大时不主动清屏重放，只同步已记录尺寸，让 pending preview 在下一次正常 footer render 中按更大预算展开。

## Risks / Trade-offs

- [Risk] 服务端仍可能因为模型限制返回 incomplete。→ Mitigation: 不再人为加 512 上限，并把 incomplete 明确显示为服务端未完整结束；用户可继续追问“继续”。
- [Risk] streaming preview 折叠会让用户在生成过程中看不到头部内容。→ Mitigation: 折叠只影响进行中的 preview；完成后完整 assistant record 会一次性追加。
- [Risk] partial assistant record 进入下一轮上下文，可能让模型把不完整回复视作历史。→ Mitigation: 这是和用户可见内容一致的事实；紧随其后的 error record 本地可见但不会发送给 OpenAI input，后续可在更复杂 metadata 方案中优化。
- [Risk] footer 高度预算过小会让尾部预览太短，预算过大可能挤压可见 transcript。→ Mitigation: 预算由当前 terminal rows、输入区高度、divider 和安全边距计算，不设置额外硬最大上限；测试覆盖 rows 增大时可显示更多尾部行。
- [Risk] rows shrink 时 destructive recovery 会清 screen 和 scrollback，视觉代价较大。→ Mitigation: 只在 columns 变化或 rows 变小时触发；rows 变大不重放，减少无必要闪烁。

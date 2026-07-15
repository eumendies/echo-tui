## Context

现有 command runtime 已通过 `CommandHost` 隔离 handler 与 app 状态，`ModelContext`、`TranscriptContext`、AGENTS loader 和两类 memory store 分别持有 `/status` 所需的本地信息，但尚无统一只读快照。Codex OAuth 模块已经负责定位 `auth.json`、解析和刷新凭据；远端模型列表也已有携带 Bearer token 与 `ChatGPT-Account-ID` 的 GET 请求范式，但尚未查询或归一化配额用量。

`/context` 已负责最近一次 provider context token 占用，`/usage` 已负责本地 token 账本；本变更不能把这两类信息重复塞入 `/status`。Codex usage 查询是异步远端操作，而 slash command 的 `start` 路径目前为同步打开 surface，因此还需处理加载态、关闭后迟到回调和安全重绘。

## Goals / Non-Goals

**Goals:**

- 提供 `/status` 的运行状态聚合，并只暴露展示所需的非敏感字段。
- 复用 Codex OAuth 凭据刷新链路查询 5 小时和每周限额。
- 以自适应终端宽度的进度条展示两个限额窗口、百分比和重置时间。
- 隔离凭据、网络、响应解析及迟到异步结果，保证失败不污染 transcript 或其他 command session。
- 保持现有 command surface、ANSI 渲染和主题体系，不引入第三方 TUI 依赖。

**Non-Goals:**

- 不在 `/status` 中显示 context token 占用或分类 breakdown。
- 不替代 `/usage` 的本地每日 token 统计。
- 不持久化、后台轮询或跨进程缓存 Codex 配额。
- 不支持其他 provider 的账户配额查询，也不提供购买额度或切换订阅能力。
- 不把完整 memory 内容、AGENTS.md 内容或任何 OAuth 敏感字段展示在 status surface。

## Decisions

### 1. 为 Codex usage 建立独立查询与归一化边界

Codex OAuth 模块同时承载 usage 查询，使用 Codex CLI 当前采用的 `https://chatgpt.com/backend-api/wham/usage`，并注入 `fetch` 和 credential resolver 以便测试。查询复用 `resolveCodexOAuthCredential`，按现有模型列表请求方式添加 `Authorization` 与可选账号 header；对外仅返回规范化后的窗口类型、百分比和 reset 时间，错误统一脱敏。

选择放在 `codex-oauth.ts` 而不是 command handler，是为了让认证、HTTP 状态、响应 shape 校验和百分比 clamp 在同一个 OAuth 远端边界内完成。也不直接复用 OpenAI SDK，因为该 endpoint 不是 Responses/Models 标准资源，原生 `fetch` 更清晰且与现有 Codex model list 一致。

### 2. `/status` 通过最小 facade 取得统一非敏感快照

扩展 `CommandHost` 的 status 能力，集中返回 cwd、当前 model/provider、session id、AGENTS 来源标签、启用用户 memory 数量及有效 agent memory catalog 标签。session id 通过 `TranscriptContext` 只读 getter 提供；尚未落盘时保留 `null` 并由 surface 格式化为“未创建”。

AGENTS 与 memory 在打开命令时按当前 cwd 重新读取，以匹配下一次 provider request 的加载规则。展示层只接收来源标签、scope 和计数，不接收文件正文、memory 正文、API key、headers 或 OAuth credential。相比让 handler 直接访问多个 store，这能保持 command handler 的受控 facade 边界，也便于在 controller 测试中组合真实能力。

### 3. 同步打开 loading surface，后台完成单次查询

`StatusCommandHandler.start` 先同步读取本地快照并打开带唯一 request id 的 `status` session；仅当 provider 类型为 `codex` 时启动一次异步查询。完成后，handler 必须确认当前 active session 仍是同一 status handler 且 request id 匹配，才更新 surface 并触发 footer redraw。

该方案不把整个 command runtime 的 `startFromText` 改成异步，避免扩大所有 slash command 的提交语义和响应锁范围。替代方案是等待请求完成后才打开 surface，但网络延迟会让命令看似无响应；另一个方案是让 runtime 全面支持 async start，收益不足以覆盖架构影响。

### 4. 专用 status surface 负责自适应进度条布局

新增 `StatusCommandSurface`，包含本地快照及 `loading | available | unavailable | not_applicable` 的 Codex usage 状态。renderer 使用现有 `safeRenderWidth`、可见宽度计算、主题颜色和 footer 最大行数约束生成卡片；`not_applicable` 时完全隐藏 Codex 用量区域。

每个可用窗口使用 `█` 作为填充、`░` 作为轨道，填充格数由 clamp 后百分比和当前可用条宽计算；百分比作为独立文本显示，防止窄终端中仅凭图形无法读数。宽度或行数不足时优先裁剪长路径、AGENTS/memory 摘要和 reset 文案，保留窗口标签、进度条和百分比。关闭键沿用 `/usage` 的 Esc、Enter、`q`。

### 5. 远端失败只形成 surface 状态

凭据缺失、刷新失败、fetch 异常、非 2xx 或响应 shape 不兼容都转换为脱敏的 unavailable 结果，不追加 transcript error。非 Codex provider 不调用远端，直接使用 `not_applicable`。原始响应只在函数局部解析，不持久化到 usage store、session 或 debug payload。

## Risks / Trade-offs

- [Codex usage endpoint 不是稳定公开协议，字段可能变化] → 将 endpoint、解析器和 fixture 测试集中在单一模块；未知 shape 明确降级，不猜测用量。
- [每次打开 `/status` 都产生远端请求] → 每次仅请求一次且不做后台轮询；当前交互频率低，优先保证数据新鲜和实现简单，后续有证据再增加短时内存缓存。
- [关闭 surface 后异步请求仍可能完成] → 用 command session request id 做提交前校验，禁止迟到结果重开或覆盖其他 surface。
- [AGENTS 和 memory 路径或名称过长] → renderer 按可见宽度裁剪，并在低行数时优先保留核心配额信息。
- [错误文本可能包含服务端回显的敏感内容] → 只输出稳定的分类摘要或经过现有 redaction 处理的错误，不展示完整 HTTP body。

## Migration Plan

1. 在 Codex OAuth 模块内增加纯解析/查询能力和类型，不改变现有模型请求路径。
2. 增加 status facade、handler 注册和 surface renderer。
3. 通过单元测试覆盖成功、OAuth 刷新、非 Codex、错误降级、迟到结果和窄终端布局。
4. 发布后若 endpoint 不兼容，可回滚 command 注册与查询模块；该变更不修改持久化 schema，无数据迁移和清理步骤。

## Open Questions

无阻塞问题。实现时以 Codex usage endpoint 当前的 `rate_limit.primary_window` 和 `rate_limit.secondary_window` 响应为 fixture 基线，并把响应 shape 校验限制在 Codex OAuth 模块内。

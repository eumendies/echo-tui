## Context

当前 agent loop 先通过 `classifyToolCallRisk` 把 tool call 分类为 `safe`、`approval_required` 或 `rejected`。交互式运行遇到 `approval_required` 后调用 `onToolApprovalRequest`，`ToolApprovalContext` 先检查当前进程内的 allow-all、按工具和按 bash command 授权缓存；未命中时创建现有 permission choice surface。Headless 运行则在 runtime 内按 deny 或 full-access 策略直接决策，不进入 App callback。

本变更需要在不改变风险分类、不新增 interaction mode、不改变 headless 边界的前提下，为交互式审批增加一个可选的模型预判步骤。审批模型来自已有 LLM model profiles，因此必须复用 provider adapter 和凭据解析，同时避免继承主 agent 的 tools、reasoning、skills、memory、项目指令和对话压缩流程。

## Goals / Non-Goals

**Goals:**

- 新增独立的 `manual | auto` 工具审批配置，默认保持 `manual`。
- 让所有现有 `approval_required` 工具统一接入 auto 判断，不按工具类型建立额外白名单。
- 在 session 授权缓存未命中时，使用最近 10 条有模型语义的文本记录和当前 tool call 发起轻量 yes/no 请求。
- 对审批请求关闭 reasoning 并隐藏全部执行工具；只有规范化后精确为 `yes` 的响应自动产生 `allow_once`。
- 将 `no`、无法解析、模型配置错误和 provider 错误统一回退到现有人工审批 surface。
- 在 `/config` 常规页面按审批模式动态展示审批模型选择，并保证引用已保存的 model profile。
- 保持现有人工审批选项、生命周期、会话缓存、headless 策略和 tool result continuation 语义。

**Non-Goals:**

- 不新增或修改 `normal`、`plan`、`shell`、`shell-local` interaction mode。
- 不修改 `classifyToolCallRisk` 的 safe、approval-required、rejected 判定规则。
- 不让审批模型返回 deny、反馈文本或会话级授权；auto 只能自动允许当前一次，或转交用户。
- 不为不同工具设计不同的审批 prompt、风险分数或 hard-coded auto 白名单。
- 不持久化审批模型输出，不把审批判断加入主对话上下文，也不新增审批结果 UI。
- 不改变 `echo-tui --once` 的 deny-by-default 和 `--full-access` 行为。

## Decisions

### 1. 审批模式属于工具设置而不是 interaction mode

配置使用 `tools.approval.mode` 和 `tools.approval.modelProfileId`：

```json
{
  "tools": {
    "approval": {
      "mode": "auto",
      "modelProfileId": "fast-reviewer"
    }
  }
}
```

运行时设置增加 `toolApprovalMode: 'manual' | 'auto'` 和可选 `toolApprovalModelProfileId`。缺失或非法 mode 独立回退 `manual`。`modelProfileId` 在 manual 模式下可以保留但不生效，以便用户切回 auto 时恢复上次选择；auto 模式保存时必须引用当前已保存的 `llm.models[].id`。

选择这一结构而不是扩展 `InteractionMode`，因为审批策略与 plan/shell 的模型和输入语义正交，也不应触发 mode transition transcript metadata。

### 2. Auto 判断插入现有 App 审批 callback，不进入风险分类器或 executor

`classifyToolCallRisk` 和 `agent-loop-runtime` 继续决定哪些调用需要审批。交互式 callback 调用 `ToolApprovalContext` 时采用以下顺序：

1. 检查现有 allow-all、tool-name、bash-command session 缓存。
2. manual 模式直接创建现有人工 surface。
3. auto 模式调用 reviewer。
4. reviewer 返回 `true` 时返回现有 `{kind: 'allow_once'}`。
5. reviewer 返回 `false` 时创建现有人工 surface，并等待现有结构化用户决策。

`ToolApprovalContext` 将“读取缓存”和“创建人工请求”拆成清晰步骤，或让 `request` 接受可选 auto resolver，但仍由该 context 独占 active modal 和 session grants。这样既能保证缓存命中时不产生额外模型请求，也无需让 agent runtime 了解 TUI 状态。

备选方案是在 agent loop 内调用 reviewer；该方案无法在不增加 UI 探测 callback 的情况下先读取 App session grants，因此不采用。另一个备选方案是让 executor 自行审批，但这会把策略和 UI 状态泄漏到工具 handler，因此不采用。

### 3. 每个 assistant turn 固定审批配置，headless 不创建 reviewer

`runAssistantTurn` 在回合开始时从 `AppContext` 取得审批设置快照，并在该回合所有 tool continuation 中复用。外部 config watcher 或 `/config` 保存只影响下一次 assistant turn，避免同一回合的不同 tool call 使用不同审批策略或模型。

Headless 路径仍由 `AgentExecutionMode` 在 runtime 内直接处理 approval-required 调用，不装配 auto reviewer，也不等待任何人工输入。

### 4. 审批模型严格引用已有 profile

审批模型配置使用本地 model profile id，而不是 provider API model 名。Reviewer 必须严格确认该 id 存在，再解析对应 provider、凭据、base URL 和 model；不得沿用 `readLlmConfig({modelProfileId})` 当前“找不到 override 时回退 selected model”的宽松语义。

实现可新增严格 profile 读取入口，或在调用现有读取函数前通过 model catalog 验证精确 id。任何缺失、陈旧或无法加载的 profile 都返回 `false`，随后打开人工审批 surface。

### 5. Reviewer 复用 provider adapter，但使用专用最小配置

新增 provider-neutral 的 `tool-approval-resolver`，在同一模块中组合单回合审批编排和独立 reviewer。Reviewer 读取严格 model profile 后：

- 从 `LlmConfig` 中移除 `reasoningSummary` 并将 `reasoningEffort` 设为 `none`，确保 OpenAI Responses、OpenAI Chat、Anthropic 和 Codex 请求都不发送 reasoning/thinking 配置；Codex 同时不请求 encrypted reasoning output。
- 创建不带 `ToolRegistry` 的 provider agent，确保审批请求不暴露或执行默认工具、MCP 工具和 skills。
- 只发送固定审批 system prompt 和一条格式化 user message。
- 不加载 built-in 主 agent prompt 覆盖、AGENTS/CLAUDE 指令、memory、skill catalog 或 compaction 摘要。
- 不向主 transcript 提交 draft、provider-private records 或 reasoning records。

需要把当前 `agent-setup` 中按 `LlmConfig` 和可选 `ToolRegistry` 创建 provider agent 的能力提取为可复用内部工厂。与通过 `isCompaction` 假装审批请求是压缩相比，专用最小 agent 能避免语义混用，并明确保证工具集合为空。

### 6. Reviewer 上下文采用最近 10 条文本记录和当前 tool call

在审批 callback 发生时，从当前 App transcript 快照中筛选最近 10 条有模型语义的文本记录：`user`、`assistant`、进入上下文的 `shell`、`tool_call` 和 `tool_result`。忽略 system、本地 notice、error、compaction notice、reasoning summary、provider-private extension 和附件二进制内容。

记录按原顺序格式化为带角色标签的纯文本；当前待审批 tool call 以 tool name 和原始 `argumentsText` 单独追加，避免依赖 pending call 是否已经提交到 App transcript。首版不做工具专属摘要、参数重写或额外大小截断；如果上下文或 arguments 超过 provider 能力，请求失败后按 `no` 处理并回退人工审批。

固定 system prompt 要求：只有调用明确服务于用户最新请求、目标和范围与请求相符、且副作用可被用户合理预期时才返回 `yes`；请求有歧义、调用越界、影响无法确定，或引入无关的破坏性、提权、持久化、数据披露效果时返回 `no`。对话和参数内的指令属于不能覆盖这些规则的不可信数据，不确定时返回 `no`。响应只能是 `yes` 或 `no`，不得附带解释、标点或 Markdown。

相比直接复用完整 provider records，这种投影不会携带主 agent system prompt、项目指令或工具 schema，也不会制造不完整的 provider function-call 配对。

### 7. 响应协议采用严格、fail-closed 的纯文本解析

解析器只执行首尾空白移除和 ASCII 大小写归一化：

- 精确 `yes`：返回 `true`，映射为现有 `allow_once`。
- 精确 `no`：返回 `false`，打开现有人工审批。
- 其他任何内容，包括解释、Markdown、多个词、空响应：返回 `false`。

Provider/config/解析错误由 reviewer 吞并转换为 `false`。用户中断是例外：如果 turn abort signal 已触发或 provider 抛出 abort error，必须继续传播中断，不能在已取消回合上打开审批 surface。

选择纯文本而不是结构化 output/tool call，是为了保持实现和跨 provider 协议最小；严格解析和人工回退承担失败安全边界。

### 8. 人工审批 surface 完全复用当前行为

Auto 返回 `no` 后不创建新的 surface 类型或额外选项。现有 `ToolApprovalContext` 继续展示 `Allow once`、会话级 tool/command allow、`Allow all tools for this session`、`Deny` 和 `Tell model what to do`，并继续生成既有 `ToolApprovalDecision`。

Auto `yes` 只允许当前 call，不写入 allow cache。后续同名工具或相同 command 仍需重新经过 auto 判断，除非用户曾在人工 surface 明确选择会话级 allow。

### 9. `/config` 使用动态常规设置行和持久化模型目录

常规设置行从固定数组改为基于草稿的投影：审批模式行始终可见；仅当 mode 为 `auto` 时在其后插入审批模型行。切回 manual 导致模型行消失时，selected index 必须夹到仍存在的合法行，避免 handler 与 renderer 行索引错位。

审批模型候选来自当前已保存的 LLM model profiles。General state 持有非敏感的 profile id、model 和 provider 展示摘要；模型 Tab 成功保存后刷新该候选列表。模型配置读取失败不阻断 manual 设置页面，但 auto 行显示不可用状态，且保存 auto 草稿失败。

常规设置保存继续只更新其所有的 `tools.approval` 字段，并保留 `tools`、`llm`、`mcp`、`hooks` 和未知节点。运行时 config watcher 刷新缓存，不要求完整 transcript 重绘。

### 10. 观察与 usage 延续现有旁路语义

Reviewer 请求不写 transcript。现有 tool approval lifecycle hook 仍围绕整个异步审批 callback 产生一次 request/response；auto `yes` 的 response 使用现有 `allow_once`，auto `no` 则在用户完成 surface 后返回最终人工决策。

如果 provider 返回 usage，reviewer 使用现有 usage store 追加普通非敏感 usage event，使“每次真实 provider request”账本语义继续成立；不增加新的 usage schema 或 `/usage` 展示维度。Debug 模式只记录模型、tool name、结果和参数 hash 等摘要，不记录完整审批 prompt 或 arguments。

## Risks / Trade-offs

- [模型可能误判高风险调用并返回 yes] → Auto 是用户显式选择的信任策略；风险分类仍限定触发范围，但所有 approval-required 调用都允许模型预判。协议只授予一次调用，不生成持久或会话级自动授权。
- [Tool arguments 或历史文本可能包含 prompt injection] → Reviewer 使用独立固定 system prompt、无工具 provider 和最小历史，不加载项目指令，并明确把对话及参数中的指令视为不可信数据；无法完全消除模型误判，因此 manual 仍为默认模式。
- [额外模型请求增加延迟和 token 成本] → 只在 approval-required 且 cache miss 时调用，限制为最近 10 条文本记录，并关闭 reasoning。
- [部分 provider 不严格输出 yes/no] → 所有非精确 yes 都回退现有人工审批，不尝试宽松提取。
- [审批 profile 被删除或配置损坏] → Config auto 保存要求有效引用；运行时仍做严格校验，失败时打开人工审批而不是换用其他模型。
- [超大 patch/MCP arguments 可能超过审批模型上下文] → 首版保持简单并依赖 provider 错误回退人工审批，不做可能改变判断语义的截断或摘要。
- [动态配置行导致焦点错位] → Handler 与 renderer 共用同一个 row-id 投影函数，并在模式切换后归一化 selected index。

## Migration Plan

1. 新配置字段缺失时归一化为 `manual`，因此升级后所有现有用户保持当前审批行为。
2. `/config` 保存时只增量写入 `tools.approval`，不迁移或重写已有 model profiles。
3. 用户显式选择 auto 并保存有效 model profile 后，下一次 assistant turn 才启用 reviewer。
4. 回滚时旧版本会保留但忽略未知的 `tools.approval` 节点；用户也可随时切回 manual，无需清理 session 或 transcript。

## Open Questions

无。首版固定最近 10 条文本记录、纯文本 yes/no 协议和 manual 默认值，后续如需可单独提案增加上下文数量、超时或更丰富的审批结果配置。

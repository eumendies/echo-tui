## Context

工具结果以 `ToolExecutionResult.text` 写入 transcript，随后由 OpenAI Responses、OpenAI Chat 和 Anthropic converter 原样放入 provider 请求。当前没有统一的最终裁剪层，各 handler 的边界也不一致：`grep`/`glob` 只有条数限制，`run_subagent`/`use_skill` 没有结果字节限制，Bash 分别保留 stdout 和 stderr，`read_files` 允许 256,000 字节，而 Web/MCP 的部分失败路径绕过成功结果的限制。

单条超大结果不能依赖 compaction 修复，因为它要么仍留在主请求中，要么完整进入摘要请求。本设计因此把边界放在各工具生产结果的位置，并保留现有的分页、收窄查询和 tool-result artifact 机制。本次明确不增加统一的 `boundToolResult` 后处理层。

## Goals / Non-Goals

**Goals:**

- 所有内置工具和 MCP 工具的 provider-visible 文本在成功、失败和异常路径上都有可测试的 UTF-8 字节上限。
- 条目型和流式工具在生产阶段停止收集，避免先构造巨大结果再裁剪。
- 截断后的文本、结构化展示数据和图片附件不保留同一份无界内容。
- 能安全 offload 的结果保留有界预览和 artifact 路径；不能安全截断的指令型内容明确拒绝。
- 截断提示本身计入最终预算，并告诉模型如何继续获取信息。

**Non-Goals:**

- 不修改 compaction 的触发、摘要或最近记录保留策略。
- 不增加覆盖全部工具的统一结果后处理器，也不把正确性依赖于 transcript 写入阶段的二次裁剪。
- 不保证 artifact 保存无限内容；继续沿用现有 8 MiB artifact 上限。
- 不统一限制 provider 不可见的 UI metadata；这类数据继续由工具输入边界和专属 renderer 约束。

## Decisions

### 1. 各 handler 显式承担结果边界

新增共享默认值 `DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES = 65_536` 和 UTF-8 预算辅助函数，但每个 handler 必须在自己的成功、失败、异常格式化路径中显式使用。共享函数只提供安全截头、截尾、预留 marker 和字节计数能力，不接受或改写通用 `ToolExecutionResult`，因此不构成 `boundToolResult`。

选择 handler 级边界而不是最终盲裁剪，原因是不同结果需要不同语义：Bash 应优先保留尾部，JSON 必须保持可解析，skill 指令不能返回残片，条目型工具还需要同步限制 display metadata 和尽早终止子进程。

所有上限均按 `Buffer.byteLength(text, 'utf8')` 计算；header、状态、artifact marker 和截断说明都计入最终上限。默认 64 KiB 是绝对防爆边界，不代表单次调用应主动占满预算。

### 2. 工具类别及默认预算

| 工具 | 默认 provider-visible 文本上限 | 主要策略 |
|---|---:|---|
| `grep` | 65,536 bytes | 100 matches 与总字节双上限；按最终格式化匹配行计费，达到上限终止 rg |
| `glob` | 65,536 bytes | 200 paths 与总字节双上限；只保存预算内路径，达到上限终止 rg |
| `run_bash_command` | 65,536 bytes | stdout、stderr、状态和 marker 共享最终预算；预览保留尾部，完整合并输出继续 offload |
| `read_files` | 65,536 bytes | 将当前 256,000 bytes 总文本上限收紧；文本/PDF 使用头部预览和 artifact，继续支持 offset/limit |
| `web_fetch` | 65,536 bytes | 成功、HTTP 失败、校验失败和异常统一计入预算；保留现有 offload |
| `web_search` | 65,536 bytes | 成功和所有 provider 失败摘要统一计入预算 |
| MCP tools | 20,000 bytes | 保留现有较低预算，但 marker 和失败文本也必须计入该预算 |
| `run_subagent` | 65,536 bytes | 父 Agent 只接收有界头部预览和 artifact 路径；失败 handoff 同样受限 |
| `use_skill` | 65,536 bytes | 完整 envelope 超限时拒绝单次加载，失败结果给出 source path 并指引 `read_files` 分页读取源文件；绝不返回截断指令 |
| `ask_user_questions` | 65,536 bytes | 限制问题/选项/自定义回答字段，结果保持合法 JSON |
| Todo tools | 65,536 bytes | 限制单项和聚合文本，结果保持合法 JSON并避免无界重复字段 |
| `apply_patch` / `edit_file` | 65,536 bytes | 成功摘要、路径、失败 reason/hint 和文件系统异常均受限 |

各 handler 的测试选项可以覆盖默认预算，以便用小输入稳定验证边界。MCP 保留 20,000 bytes 是为了兼容现有行为；其余工具采用同一默认硬上限，减少配置分叉。本次不新增用户配置项，避免把安全边界变成可误设为无限的运行选项。

### 3. 条目型工具在收集阶段实施预算

`grep` 按 `${path}:${line}:${column}: ${text}` 的最终 UTF-8 字节数累计。若第一条匹配正文自身超过剩余预算，保留能够放入预算的 UTF-8 安全前缀，并把该匹配及整体结果标记为 truncated；之后立即终止 rg。`details.display.matches` 只保存相同的有界正文。

`glob` 按最终输出中的路径和换行累计；放不下的路径不进入结果或 display，并立即终止 rg。两者都返回 `has_more: true`，并区分命中条数上限和字节上限，提示模型收窄 pattern、paths 或 glob。

stderr 采用独立的小型捕获预算，错误格式化后的完整文本仍不得超过该工具最终预算。JSON/NUL 流解析器也要限制 pending buffer，防止缺少分隔符的异常子进程输出造成无界内存增长。

### 4. 流式及可 offload 工具预留最终 marker 空间

调整 `createOffloadedTextPreview` 或增加同级辅助能力，使调用方提供的是最终总预算，而不是“预览预算”。helper 必须先计算 artifact marker 和分隔符字节，再决定预览可用空间，从而保证返回值连同 marker 不超过上限。

Bash 继续流式写 artifact，但 stdout/stderr 不再各自获得完整 64 KiB。格式化器先为退出码、timeout、错误和 marker 预留空间，再在剩余预算中按到达或流标签语义保留输出尾部。`read_files` 和 `web_fetch` 使用头部预览；`run_subagent` 使用头部预览，因为子 Agent 最终答复应把结论放在开头。

无法写入 artifact 时仍返回同样有界的预览和固定截断提示。artifact 自身是否达到 8 MiB 上限不改变 provider-visible 文本预算。

### 5. 指令型与结构化结果不做盲截断

`use_skill` 在加载后、返回前检查包含 name、source、arguments、完整 `SKILL.md` 和资源列表的最终 envelope。若超过 65,536 bytes，则返回简短失败，给出 source path 并指引 Agent 通过 `read_files` 的 offset/limit 分页读取该文件获取完整指令；不返回部分 skill 内容。`arguments` 也设置独立的小上限，避免 envelope 被调用上下文占满。

Todo 和 `ask_user_questions` 在输入归一化阶段限制单字段与聚合字节数。用户自定义回答在交互控制器中设置上限；成功和取消结果通过结构化 payload 生成并在序列化前保证其预算，因此输出始终是完整合法 JSON，不对序列化字符串直接截断；失败结果则返回有界纯文本（UTF-8 安全头部裁剪），不包装 JSON envelope，便于模型与终端直接阅读。

文件编辑工具通常只返回摘要，但路径、解析 hint 和系统错误仍可能很长。其格式化器按字段裁剪并保留固定错误结构，不 offload 编辑错误。输入 patch、原文件和变更数量继续使用现有独立上限。

### 6. 图片附件使用独立聚合边界

文本字节上限不能约束 `read_files` 的 Base64 图片附件。保留当前单图 5,000,000 bytes、源图 50,000,000 bytes 和解码像素防护，并新增单次调用附件总字节上限 10,000,000 bytes。读取顺序中超过剩余附件预算的图片不进入 attachments，结果文本记录该图片被跳过并标记 truncated。

这是传输大小防护，不替代已有自动缩放和解码像素限制。附件汇总逻辑不得先构造超过聚合预算的 Base64 集合。

### 7. 工具定义公开继续获取结果的方式

`grep`/`glob` 描述声明条目上限并提示结果可能截断，字节上限细节由运行时截断通知承担；`read_files`/Web 保留分页、分批说明；Bash 的截断通知在 artifact 存在时包含 artifact 路径并提示通过 `read_files` 定向读取；skill 超限错误返回 source path 并指引通过 `read_files` 分页读取源文件。模型不需要知道内部 helper 或预算数字，但必须能区分“没有更多结果”和“结果因预算被截断”，并知道如何继续获取。

## Risks / Trade-offs

- [64 KiB 对少数大型源码观察过小] → `read_files`、Web 支持分页，grep/glob 支持收窄查询，offload 工具可定向读取 artifact。
- [每个 handler 显式接入可能遗漏新工具] → 为默认 registry 和 MCP registry 建立逐工具测试清单；新增工具的评审模板要求声明结果预算，但本次不添加中央运行时兜底。
- [Bash 合并预算后可见输出少于当前行为] → 保留尾部和完整 artifact，确保错误结论通常仍可见。
- [超大 skill 无法单次注入上下文] → 错误给出 source path 并指引通过 `read_files` 分页读取完整指令；不以残缺指令换取表面可用性。
- [图片总预算可能跳过批量请求中的后续图片] → 保持调用顺序并逐项报告，模型可分批调用 `read_files`。
- [UTF-8 字节上限不能精确等价于不同模型 token] → 字节上限作为防止病态大结果的稳定硬边界，正常历史增长仍由现有 token 估算和 compaction 处理。

## Migration Plan

1. 先完善共享 UTF-8/offload 预算辅助函数及测试，但不接入通用结果对象。
2. 按条目型、流式/offload、结构化、指令型和附件型分组迁移 handler，并为每组增加边界测试。
3. 更新工具描述和现有测试中依赖旧 256,000 bytes 或 Bash 双流行为的断言。
4. 运行完整验证并手动确认截断结果可通过分页、收窄查询或 artifact 继续获取。

回滚只需恢复各 handler 的旧默认值和格式化逻辑，不涉及持久化 schema 或数据迁移。

## Open Questions

- 64 KiB 是否应在后续变更中按模型 context window 动态收紧；本次先采用稳定的绝对上限。
- `ask_user_questions` 的超长自定义回答后续是否也应 offload；本次优先采用输入上限和有界 JSON。

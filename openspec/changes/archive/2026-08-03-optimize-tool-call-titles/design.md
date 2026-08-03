## Context

Tool call 的可见标题由通用 renderer 和多个专属 renderer 分别生成。当前专属投影已经使用 `Bash · complete`、`Web search · query` 等自然语言形式，但 `ask_user_questions`、`read_files`、`apply_patch`、`edit_file`、todo 工具和通用 fallback 仍直接显示 PascalCase、snake_case 或 `name(arguments)`。标题同时出现在 transcript 与 footer pending preview，因此格式化规则需要在共享渲染边界统一，而不能修改工具协议或 transcript 事实。

## Goals / Non-Goals

**Goals:**

- 所有 tool call 标题使用 sentence case 的用户可读名称。
- 标题、可信参数摘要和生命周期状态统一使用 ` · ` 分隔，不再使用函数调用小括号语法。
- 专属 renderer 继续隐藏敏感或冗长参数，只展示已有的有界摘要。
- 通用与 MCP fallback 保留工具身份和原始参数事实，并遵守现有宽度与换行约束。
- transcript 和 footer pending preview 对同一调用产生一致标题。

**Non-Goals:**

- 不重命名 provider-visible tool definitions 或 transcript 中的 `toolName`。
- 不改变 tool result 投影、工具执行、审批、持久化或 provider continuation。
- 不为未知工具推断参数语义，也不修改已有结果状态文案。

## Decisions

### 1. 在 render 共享层集中格式化可见工具名

增加无副作用的共享格式化函数，将 snake_case、camelCase 和 PascalCase 标识符转换为 sentence case。内置工具与 `MCP` 等需要稳定品牌或语义名称的标识使用显式映射，避免通用大小写转换产生 `Mcp`、拆错缩写或改变既有 `Bash`、`Grep`、`Glob` 文案。

相比逐个 renderer 手写字符串，共享格式化可以让专属投影、通用 fallback 和未来新增工具遵守同一规则；相比修改 tool definition 名称，该方案只作用于 TUI 可见投影，不影响协议兼容性。

### 2. 标题使用语义片段而不是函数调用语法

专属 renderer 将标题组织为 `Tool name · summary · status`。例如：

- `Ask user questions · 2 questions`
- `Read files · src/app.ts@0+20`
- `Apply patch · src/app.ts`
- `Edit file · src/app.ts · replace all`

无参数摘要的操作只显示工具名，例如 `Create todos`。已有 `Bash`、`Web search`、`Web fetch`、`Grep`、`Glob` 和 `Using skill` 投影保持其现有自然语言结构。

选择 middle dot 是因为当前多种专属 renderer 已使用该分隔方式，且它能明确区分工具身份、目标和状态；不继续使用小括号，是为了避免自然语言名称与代码调用语法混排。

### 3. 通用 fallback 将标题与原始参数分层

通用工具调用的首行只显示格式化后的工具名。非空 `argumentsText` 在后续低强调行中有界展示并沿用现有 safe render width、Tab 展开和物理行安全规则。这样既避免 `Generic tool({...})` 式标题，又不丢失未知工具调用的参数事实。

专属 renderer 参数解析失败时也走相同 fallback，不在标题中恢复或猜测参数摘要。

### 4. MCP 标题保留来源边界

对 `mcp__<server>__<tool>` 形式的名称，首行显示为 `MCP · <server> · <tool display name>`。server 身份保持可辨认，tool 部分使用 sentence case；arguments 与其他通用工具一样放在后续低强调行。无法识别标准 MCP 名称结构时按普通通用工具处理。

### 5. 同一格式化路径服务 transcript 与 pending preview

`renderToolCallPreviewLines` 继续构造临时 record 并调用正式 tool record renderer。标题格式化不在 footer 单独实现，避免 pending 与完成记录漂移。

## Risks / Trade-offs

- [通用 formatter 可能错误拆分品牌名或缩写] → 内置名称和 `MCP` 使用显式映射；未知名称只做保守的分隔符与大小写转换。
- [通用 arguments 移到下一行后增加少量垂直占用] → 继续使用现有 footer 行预算、换行与截断机制；专属高频工具仍使用单行有界摘要。
- [历史测试和用户截图中的标题发生变化] → 这是预期的纯视觉行为变更；更新 renderer 级测试，不迁移 transcript。
- [工具审批界面仍可能使用协议名] → 本变更只覆盖 tool message 与 pending preview；审批 surface 不纳入范围，避免把展示重构扩散到风险确认语义。

## Migration Plan

无需数据迁移。发布后，新旧 session 都从原始 `toolName` 和 `argumentsText` 重新生成新标题。若需要回滚，只需恢复 renderer 格式化逻辑，持久化数据不受影响。

## Open Questions

无。

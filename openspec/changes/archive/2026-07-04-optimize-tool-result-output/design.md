## Context

当前 provider continuation 对工具结果的注入路径很直接：各 handler 生成 `ToolExecutionResult.text`，app/runtime 把它保存为 `tool_result.text`，各 provider transcript converter 再把同一个 `record.text` 作为 function/tool output 发送给模型。`ok`、`exitCode`、`truncated`、`timedOut`、`durationMs`、`display` 等结构化字段主要服务本地状态、渲染和持久化；它们不是主要的上下文成本来源。

因此本次优化聚焦于内置工具的 provider-visible 文本格式，而不是删除执行结果类型字段或改变 provider adapter。MCP tool result 暂不纳入，以避免同时处理外部 server 的富内容兼容问题。

## Goals / Non-Goals

**Goals:**

- 降低常见工具结果进入模型上下文的 token 成本。
- 让成功结果优先呈现观察值，例如文件内容、匹配行、路径列表、网页正文和搜索结果。
- 仅在异常、分页、截断、timeout、低质量搜索、非零退出码等情况下输出诊断字段。
- 保持失败结果可修复，不能为了省 token 删除 reason、hint 或关键状态。
- 保持 `ToolExecutionResult` 结构化字段、本地 transcript schema 和 provider tool schema 稳定。
- 让 todo renderer 能兼容旧 JSON 和新紧凑 JSON。

**Non-Goals:**

- 不优化 MCP tool result。
- 不改变工具参数 schema。
- 不改变 tool approval、risk classifier、agent loop continuation 或 context compaction 的基本流程。
- 不引入新的第三方依赖或外部服务。
- 不移除本地 UI 渲染所需的 display/metadata 字段。

## Decisions

### 1. 只压缩 `tool_result.text`

工具执行结果仍保留结构化 metadata；只调整 formatter 生成的文本。这样可以在不改 provider adapter 和 transcript schema 的情况下直接减少上下文占用，也避免破坏本地渲染和历史记录。

替代方案是给 provider 单独增加 `modelText` 字段、本地 UI 使用 `displayText`。该方案长期更灵活，但需要修改 transcript schema、converter、持久化和兼容逻辑，当前收益不值得。

### 2. 采用条件 metadata 策略

默认不回显 tool call 已携带的入参，也不输出默认值或 false 状态。以下情况才输出额外状态：

- `ok: false`
- `has_more: true`
- `truncated: true` 或 body/content 被截断
- `timed_out: true`
- bash 非零 exit code
- web fetch 发生 redirect 或非 2xx
- web search 低质量、有缺失 query terms、公共搜索页 fallback 失败或被拦截

替代方案是所有工具统一返回 JSON。JSON 更机器友好，但对文件内容、终端输出和网页正文会增加转义成本，也降低人工阅读性。

### 3. 各工具保留面向任务的最小内容

- `read_files`: 文件路径、行号内容、目录项、图片附件摘要、PDF 提取文本，以及必要的 `has_more`/截断提示。
- `grep`: `path:line: text` 形式的命中列表，必要时显示 `has_more`。
- `glob`: 纯路径列表，空结果显示 `no files matched`。
- `web_fetch`: URL/status 和正文；final URL 只在 redirect 后有差异时突出。
- `web_search`: title、url、snippet；低质量时显示 warning 和 missing terms。
- `bash`: 成功时返回实际输出或无输出提示；失败/timeout/truncated 时显示状态。
- `apply_patch`: 保持成功 changed files summary 和失败 reason/hint。

### 4. todo result 不再承载权威 todo 状态

todo 的权威状态已经存在于 session `todoState`，并通过 transient runtime suffix 注入。tool result 只需要告诉模型本次变更是否生效，例如 created ids、completed ids、not found ids。完整 todo 列表继续由 suffix 提供，避免同一轮里重复出现两份 todo 状态。

### 5. `ask_user_questions` 使用答案索引

成功结果用问题索引和选择标签表达用户答案，不再重复完整问题文本和 option description。模型在同一 continuation 中已有前序 tool call，可以通过索引对应问题；自定义文本仍保留。

## Risks / Trade-offs

- [风险] 压缩后的文本可能少了调试信息，排查工具行为变难。→ 保留结构化字段和失败诊断，测试覆盖异常路径；必要时未来可增加 debug-only 本地日志。
- [风险] 旧 transcript 中 todo result 仍是旧 JSON，renderer 如果只识别新格式会退化。→ renderer 同时兼容旧 `items/openTodos` 与新紧凑结果。
- [风险] 模型偶尔需要 grep column 或 web search quality score。→ 默认省略，保留路径/行号/低质量 warning；后续如果有实际需求再扩展可选 detail mode。
- [风险] read_files 删除 absolute path 可能影响跨 cwd 判断。→ 工具调用参数和运行 cwd 已在系统上下文中，失败场景仍可返回必要路径信息。
- [风险] 过度压缩 bash 成功结果可能隐藏 stderr warning。→ 如果 stderr 非空，即使 exit code 为 0 也应在文本中保留 stderr。

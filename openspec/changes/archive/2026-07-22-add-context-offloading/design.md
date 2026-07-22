## Context

当前工具结果文本同时承担三种职责：作为 agent loop 的 continuation 输入、作为 transcript 持久化事实、作为 TUI 渲染来源。Bash runner 在内存 capture 达到 `maxOutputBytes` 后直接丢弃后续内容；MCP formatter 在 20,000 字符后保留开头；`web_fetch` 在响应读取和最终格式化输出两个阶段分别设置硬上限。上述截断发生在结果进入 transcript 之前，因此后续 context compaction 无法恢复被丢弃内容。

现有 `read_files` 和 `grep` 均允许读取 `.git` 之外的绝对路径，可以直接用于按需读取 offloading 文件。Agent 装配已经持有 cwd，但 `AgentSessionInput` 不携带持久化 session id，因此第一版采用 cwd 项目分区而不是 session 分区，避免为文件落盘扩大 agent session 协议。模型可见结果必须保持简洁，只允许原结果预览和一个统一路径标记。

## Goals / Non-Goals

**Goals:**

- 让 Bash、模型可见 shell ctx、Web Fetch、PDF 已提取文本和 MCP 的超大文本结果在离开工具边界前写入用户级本地文件；shell-local 完整保存在本地 transcript。
- 只把 bounded preview 和 `[tool result truncated: <absolute-path>]` 发送给模型并写入 transcript。
- 让 Bash 保留尾部，让 Web Fetch、PDF 已提取文本和 MCP 保留开头。
- 复用 `read_files` 和 `grep` 实现按需回读，不增加新的 provider tool。
- 保持现有超时、取消、安全上限、tool pairing 和结构化 `truncated` 语义。

**Non-Goals:**

- 不为模型可见结果增加 artifact metadata 字段或结构化索引对象。
- 不取消任何源响应、进程输出或单结果硬上限，也不承诺无限保存外部输出。
- 不改变 `read_files`、`grep`、`glob`、`web_search` 的分页或收窄查询策略。
- 不在第一版实现 artifact 列表工具、专用读取工具、压缩、内容去重、跨机器恢复或自动清理 UI。
- 不改变 context compaction 算法；compaction 自然只处理已经 bounded 的 transcript 文本。

## Decisions

### 1. 使用 cwd 项目分区中的独立 tool-results 目录

新增轻量 tool result store，默认根目录沿用 transcript store 的用户级根目录和 cwd SHA-1 项目 key：

```text
~/.echo/echo_tui/projects/<cwd-hash>/tool-results/<generated-name>.txt
```

文件名由本地生成的时间/随机值或哈希组成，不直接使用模型提供的 tool name、call id 或参数。目录使用仅当前用户可访问的权限；写入先落临时文件，完成后 rename 为最终路径。只有最终文件完成后，结果文本才可以引用该绝对路径。

选择项目分区而不是工作区 `.echo`，是为了避免污染仓库或被误提交。选择项目分区而不是 session 分区，是因为 tool registry 在执行期没有 session id，且模型只需要稳定可读路径。后续如需精确 GC，可以再为 store 增加 session 归属，而不改变 marker 格式。

### 2. Store 同时支持内存文本写入和 Bash 流式写入

Store 提供两类内部能力：

- Web Fetch、PDF 已提取文本、MCP：对已经存在于内存的格式化字符串执行有界文件写入。
- Bash：在输出流首次超过 preview 上限时创建 sink，先写入此前捕获内容，再持续追加后续 stdout/stderr 合并终端输出。

Bash 不会为了 offloading 在内存中保存完整输出。runner 分别维护 bounded stdout/stderr 尾部和 bounded 合并输出尾部，供 Bash tool result 与 shell transcript 使用；offloading 文件保存按 chunk 到达顺序合并的终端输出。单 artifact 仍设置独立硬写入上限；达到该上限后停止增加文件大小，但命令执行、尾部预览、取消和退出状态收集继续工作。

相比“每条命令都先写临时文件、未超限再删除”，延迟创建 sink 可以避免普通短命令产生不必要磁盘 I/O。相比“命令完成后一次性写文件”，流式 sink 不需要把大输出完整保存在内存。

### 3. Marker 位置直接表达预览方向

统一 marker 为：

```text
[tool result truncated: <absolute-path>]
```

不增加 `artifact_size`、`preview_strategy`、`encoding`、`complete` 或读取提示等模型可见字段。

- Head preview：`<result head>\n\n<marker>`。
- Tail preview：`<marker>\n\n<result tail>`。

文本裁剪按 UTF-8 bytes 执行，不拆断字符。Marker 本身不计入工具现有内容 preview budget，以免路径长度挤掉主要输出；最终结果只比现有上限多一个短 marker。`ToolExecutionResult.details.truncated` 和 shell record 的 `truncated` 继续作为渲染与 debug 的结构化事实，不新增 artifact 字段。

### 4. 各工具在自己的格式化边界应用策略

#### Bash tool 与 shell mode

共享 runner 负责流式文件写入和 tail capture。命令未超限时返回格式保持不变；超限且文件完成时：

- `run_bash_command` 保留 command、exit code、timeout/error 等既有必要状态。
- 输出区先放 marker，再放 stdout/stderr 的 bounded 尾部。
- shell ctx transcript 在命令行之后放 marker，再放合并终端输出尾部。
- shell-local 不进入 provider context，显式使用无界 capture，并把完整合并输出写入 transcript/session，不创建 offloading marker。

Marker 必须放在所保留输出之前，以明确前部内容已省略。Bash formatter 不再追加另一条冗余的 `Output was truncated.` 文案。

#### Web Fetch

网络响应读取硬上限保持不变。HTML 清洗、文本分页和响应 envelope 格式化完成后，如果格式化结果超过 `maxTotalOutputBytes`，先把该完整已格式化字符串写入文件，再保留 UTF-8 head，并在尾部放 marker。响应 body 本身已触发硬上限时，仍沿用现有 `body_truncated` / `truncated` 事实；offloading 不继续无限拉取网络响应。

#### MCP

MCP content blocks 或 legacy `toolResult` 先按现有规则格式化为文本。文本超过现有 MCP preview 上限时，先写入有界 artifact，再保留 head 并在尾部放 marker。结构化 result 仍以格式化后的可读文本保存，不额外保存 MCP transport envelope。

#### read_files PDF

PDF.js 继续在 `maxPdfBytes` 限制内读取源文件，并在 `maxFileContentBytes` 处停止累积已提取文本。单个 PDF 成功结果先保留路径、页数、含文本页数、提取硬上限状态和 `extracted_text`，批量 `read_files` 完成格式化后，仅当其中包含成功提取的 PDF 且最终文本超过独立的 `maxPdfOutputBytes` 时写入完整已格式化结果，再返回 UTF-8 安全 head 与尾部 marker。该阈值默认 65,536 bytes，并与 `maxTotalOutputBytes` 取较小值，避免用户把总输出上限调低后 PDF 绕过该边界。把 offloading 放在最终格式化边界可确保 marker 不会被批量总输出上限二次截断，并使 artifact 与原本将进入该边界的文本完全一致。

不包含成功 PDF 提取的 `read_files` 调用继续沿用既有 256,000-byte 默认总输出上限和截断文案。PDF offloading 失败时同样回退无路径 head 截断，不改变 PDF 读取成功状态，也不放宽源文件大小、提取文本、OCR 或页面渲染边界。

### 5. Offloading 失败不改变工具成功语义

目录创建、写入或 rename 失败时，工具退回现有 bounded 截断方式：Bash 返回可用尾部，Web Fetch/MCP 返回可用开头，但不输出路径 marker。Offloading 失败不把原本成功的命令、HTTP 请求或 MCP 调用改成 `ok: false`，也不抛出未捕获异常。临时文件尽力删除；失败只进入现有 debug 诊断边界，不进入 transcript 额外字段。

### 6. Transcript、provider 和 TUI 共享同一 bounded 文本

Offloading 在 `ToolExecutionResult` 或 shell record 创建之前完成，因此 runtime record region、app transcript、JSONL journal、provider adapter 和 compaction summary 输入看到的是同一份 bounded 文本。无需在 provider converter 或 renderer 中再次解析 artifact metadata。TUI 继续使用现有工具/消息渲染预算展示该文本，marker 作为普通可见行出现。

## Risks / Trade-offs

- **[项目分区文件会随长期使用增长]** → 第一版保留单 artifact 硬上限，并把自动 GC 留作后续独立变更；offloading 文件不进入工作区或 Git。
- **[绝对路径会暴露用户 home 路径给 provider]** → 当前 system prompt 已包含 cwd，且用户明确需要模型通过文件路径回读；文件名不包含工具参数或内容。
- **[Bash artifact 达到硬上限后不包含更晚输出]** → runner 仍保留最新 tail 给模型；marker 只声明结果被截断和存在文件，不声称文件无限完整。
- **[stdout/stderr 合并文件不保留每个字节的 stream 标签]** → 文件按终端到达顺序保存，模型可见 Bash preview 继续使用现有 stdout/stderr 语义；不引入自定义容器格式。
- **[Web Fetch body 在网络硬上限处仍不完整]** → 保持现有安全边界；offloading 只解决已获取、已格式化内容对上下文的占用，不承担无限下载。
- **[写文件可能拖慢工具完成]** → Bash 使用流式写入，Web/MCP 使用有界单文件写入；不执行内容索引、压缩或同步扫描。

## Migration Plan

1. 新增 tool result store 和 UTF-8 head/tail preview helper，不改变任何工具行为。
2. 将共享 Bash runner 接入可选 store，更新 Bash tool 和 shell mode 超限格式。
3. 将 Web Fetch、PDF 格式化结果和 MCP formatter 接入同一 store。
4. 更新工具、agent loop、shell transcript 和持久化恢复测试，验证 marker 路径实际可读。
5. 保留现有配置字段和默认 preview 上限，无需用户迁移配置或 session 数据。

回滚时可以停止向工具注入 store 并恢复现有截断 formatter；已有 tool-results 文件成为无引用本地文件，但旧 transcript 中的绝对路径仍保持可读。

## Open Questions

- 第一版单个 Bash artifact 的硬写入上限应采用固定内部默认值，还是在后续单独暴露用户配置；实现前优先选择固定安全默认值，避免扩大本次配置面。
- 自动 GC 需要结合 session 保留策略设计，本变更暂不删除仍可能被历史 transcript 引用的文件。

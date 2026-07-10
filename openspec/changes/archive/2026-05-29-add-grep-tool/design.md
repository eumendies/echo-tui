## Context

现有默认本地工具已经覆盖非交互 shell、受控文本编辑和已知路径文件读取。模型在源码检索时仍经常需要通过 `run_bash_command` 调用 `rg`，这会把常见搜索暴露给 shell quoting、命令拼接和不稳定输出格式。`grep` 应成为 `read_files` 的前置定位工具：先结构化搜索命中位置，再用 `read_files` 读取相关文件片段，最后用 `apply_patch` 编辑。

## Goals / Non-Goals

**Goals:**

- 提供默认注册的 `grep` 工具，用于本地文本搜索。
- 底层调用本机 `rg`，但使用 `spawn` 参数数组，不通过 shell 拼接命令。
- 输入保持简单：`pattern` 必填，`paths` / `glob` / `literal` / `case_sensitive` 可选。
- 第一版不暴露 `offset` / `limit`；只通过内部 `DEFAULT_MAX_MATCHES` 限制返回匹配数量。
- 输出结构化 match envelope，包含 path、line、column、line text、returned matches 和 has_more。
- 保持现有 `ToolExecutionResult`、transcript persistence 和 agent loop continuation schema 不变。

**Non-Goals:**

- 不实现目录 listing 工具，不替代 bash 的 `ls` / `find` 能力。
- 不暴露完整 ripgrep DSL，例如 recursive 开关、context lines、hidden、follow symlinks、type、before/after context 或复杂 include/exclude 列表。
- 不实现 JS fallback grep；如果本机没有 `rg`，工具返回明确失败。
- 不在 `grep` 中返回大段上下文；模型应使用 `read_files` 读取命中附近内容。

## Decisions

### 1. 工具名使用 `grep`，底层实现使用 ripgrep

工具名面向模型语义，选择更通用的 `grep`；实现层使用本机 `rg --json` 获取结构化事件。相比直接让模型调用 bash `rg`，工具可以统一参数校验、路径拒绝、无匹配语义和输出格式。

替代方案：命名为 `ripgrep` 或 `search_files`。`ripgrep` 暴露实现细节，`search_files` 容易被理解为文件名搜索；`grep` 更贴近“搜索文件内容”。

### 2. 不暴露 `offset` / `limit`，只保留 `DEFAULT_MAX_MATCHES`

搜索结果不是稳定分页对象：文件内容、ignore 规则和遍历顺序变化都可能改变第 N 个 match。模型通常不需要“下一页搜索结果”，而是应该在命中过多时收窄 pattern、paths 或 glob。因此第一版不提供 offset/limit，只返回前 `DEFAULT_MAX_MATCHES` 条，并用 `has_more: true` 提示继续收窄搜索。

替代方案：暴露 offset/limit。这样会增加调用和实现复杂度，而且鼓励模型翻页而不是改进搜索条件。

### 3. 默认固定字符串搜索，显式 `literal: false` 才使用 regex

模型常搜索代码片段、函数名或包含括号/点号的文本。默认 regex 容易因为未转义特殊字符导致搜索错误。第一版将 `literal: null` 解释为 fixed string；只有显式 `literal: false` 时才使用 ripgrep regex。

替代方案：完全遵循 grep/rg 默认 regex。它更符合 CLI 传统，但不如固定字符串适合 LLM 工具调用。

### 4. `paths` 和 `glob` 提供最小范围控制

`paths` 允许模型把搜索限定在 `src`、`test` 或少量已知目录/文件；`glob` 允许限定文件形态，例如 `*.ts` 或 `*.test.js`。不增加 include/exclude 数组，避免复制 ripgrep DSL。

路径规则与 `read_files` / `apply_patch` 对齐：相对路径按 cwd 解析，绝对路径和 `..` 允许，NUL 和 `.git` 内部路径拒绝。ripgrep 自身仍使用默认 ignore/hidden/symlink 行为。

### 5. 结果语义区分“无匹配”和“搜索错误”

`rg` exit code `1` 表示无匹配，应返回 `ok: true` 且 `returned_matches: 0`；exit code `2` 或 spawn error 才表示工具失败。这样模型不会把“没搜到”误判为本地工具异常。

## Risks / Trade-offs

- [Risk] 本机缺少 `rg` → 返回明确失败，提示需要安装 ripgrep 或临时使用 `run_bash_command` 替代。
- [Risk] 默认 fixed string 可能让用户期望的 regex 不生效 → schema 和 description 明确 `literal: false` 才启用 regex。
- [Risk] 只返回前 `DEFAULT_MAX_MATCHES` 条可能漏掉后续相关命中 → result 标记 `has_more: true`，提示收窄搜索范围或 pattern。
- [Risk] 不返回上下文可能需要额外 tool call → 这是有意边界，`read_files` 负责读取上下文，避免 grep 输出膨胀。

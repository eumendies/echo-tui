## Context

当前本地工具链已经覆盖了命令执行、文本搜索、已知路径读取和 patch 编辑，但缺少“按路径模式发现文件”的受限工具。模型经常需要先定位候选文件，再读取或搜索内容；没有 `glob` 时只能退回 `bash` 执行 `find`、`ls` 或 `rg --files`。

现有 `grep` 工具已有 `glob` 参数，但它是内容搜索的过滤条件，不适合表达“只列出匹配文件路径”。本次设计把 `glob` 定义成独立文件发现工具，让模型在文件定位阶段使用更小权限、更稳定输出的接口。

## Goals / Non-Goals

**Goals:**

- 提供默认注册的 `glob` function tool，用于按 glob pattern 返回文件路径。
- 输出结构保持稳定、简洁、受限，支持截断和无匹配成功语义。
- 复用现有工具安全边界：spawn 参数数组调用、cwd 相对解析、NUL 和 `.git` 路径拒绝。
- 默认支持发现 hidden 文件，例如 `.github/**`，同时不返回 `.git` 内部内容。
- 保持与后续 `read_files`、`grep(paths=...)` 的组合使用清晰。

**Non-Goals:**

- 不实现目录树浏览或 `list_dirs`。
- 不读取文件内容、不返回文件 metadata、不做分页 offset。
- 不新增运行时 npm 依赖或自研完整 glob 引擎。
- 不改变 `grep` 的内容搜索语义。

## Decisions

### 1. 使用独立 `glob` 工具，而不是扩展 `grep`

`grep.glob` 只在内容搜索时限制文件集合；当模型只知道文件名模式时，强迫它构造内容 pattern 会制造噪音和误用。独立 `glob` 让工具链形成明确路径：先发现路径，再读取或搜索。

备选方案是让模型继续用 `bash` 或扩展 `grep` 支持空 pattern。前者输出不可控且权限更宽；后者会污染 grep 的搜索契约，因此不采用。

### 2. 复用 `rg --files` 作为底层发现机制

项目已经依赖本机 ripgrep 作为 grep handler 的运行依赖，`rg --files` 能尊重 `.gitignore` 并高效列出文件。handler SHALL 使用 `spawn` 参数数组调用，不经 shell 拼接命令。

备选方案是新增 `fast-glob` 依赖或用 Node `fs` 递归实现。新增依赖与当前“无额外工具依赖”的方向不一致；自研递归需要额外处理 ignore、hidden、性能和路径边界，收益不明显。

### 3. 默认包含 hidden 文件，但过滤 `.git`

代码仓库中的 `.github`、`.aiden` 等 hidden 路径经常是有效目标；`glob` 默认应能发现它们。`.git` 内部路径不是应用级工作内容，且可能带来大量低价值结果，因此输入路径指向 `.git` 时拒绝，输出路径也再次过滤 `.git`。

底层参数可使用 `--hidden` 与 `.git` 排除 glob，但实现不能只依赖 ripgrep 的排除语义；handler 需要对返回路径复用 `isGitPath()` 做最终过滤。

### 4. 使用 strict schema 的 nullable 可选字段风格

schema 使用现有工具约定：所有 properties 都列入 `required`，可选语义通过 `null` 表示。`glob` 第一版只需要 `pattern` 和 `paths`，其中 `paths` 为 `string[] | null`，默认等价于 `['.']`。

备选方案是增加 `include_hidden`、`max_results`、`absolute` 等选项。第一版不加入这些开关，避免模型选择成本和内部 contract 复杂度；结果上限使用内置常量。

### 5. 输出按路径排序并限制数量

`glob` 输出 SHALL 按路径排序，保证测试、回放和模型上下文稳定。结果超过内置上限时，handler SHALL 返回前 N 条、标记 `has_more: true` 和 `truncated: true`，并提示收窄 pattern 或 paths。

备选方案是返回 provider 私有 JSON。现有工具结果都使用面向终端和模型的文本 envelope，继续沿用该格式更一致。

## Risks / Trade-offs

- [Risk] 本机缺少 `rg` 时 `glob` 不可用 → Mitigation: 与 grep 一样返回 `ok: false` 的明确工具失败结果，模型可决定是否退回 bash。
- [Risk] hidden 文件默认包含可能返回 `.env` 等敏感路径名 → Mitigation: 只返回路径不读取内容；敏感内容读取仍由 `read_files` 边界控制，且 `.git` 始终拒绝。
- [Risk] glob pattern 与用户熟悉的 shell glob 有差异 → Mitigation: 文档和 tool description 明确使用 ripgrep glob 语义，并通过测试覆盖常见 `*.ts`、`src/**/*.ts`、`.github/**`。
- [Risk] 结果过多占用上下文 → Mitigation: 使用内置结果上限和 `has_more` 提示，不提供模型可调的大上限。

## Migration Plan

新增工具默认注册后无需用户迁移。若实现出现问题，可以从默认 registry 和 system prompt 移除 `glob`，已有 transcript 中的历史 `tool_call` / `tool_result` 仍按通用记录类型显示和持久化。

## Open Questions

无。第一版按文件发现工具实现；如果后续确实需要目录树或 richer metadata，应另起 change 讨论，不在本次扩展。

## Context

当前工具系统已经有 provider-neutral 的 tool registry、tool executor 和 `run_bash_command` handler。真实 agent 可以通过 bash 读取文件、搜索代码、运行测试和查看 git 状态，但常规源码修改仍需要模型通过 bash 间接写文件，例如 heredoc、脚本或 shell 重定向。这类修改缺少专门的路径 sandbox、hunk 匹配校验和 all-or-nothing 语义，容易产生难以审计或难以恢复的编辑。

这次变更需要补齐本地 coding loop 中的“修改文件”能力，同时保持现有架构：agent loop runtime 继续只按工具名称执行 handler，OpenAI provider agent 继续只转换 tool definitions，不了解具体工具实现。

## Goals / Non-Goals

**Goals:**

- 新增默认本地工具 `apply_patch`，用于应用小型文本 patch。
- 工具输入采用 LLM 熟悉的 patch 格式，降低模型生成负担。
- 支持新增文本文件、更新已有文本文件、多文件 patch、多 hunk patch。
- 执行时保证基础路径校验、精确 hunk 匹配、失败不部分写入。
- 默认真实 agent 同时暴露 `run_bash_command` 和 `apply_patch`。
- 更新内置 system prompt，引导常规源码/测试修改优先使用 `apply_patch`。

**Non-Goals:**

- 不实现完整 `git diff` / `git apply` 语义。
- 不支持删除文件、重命名/移动文件、chmod/mode change、binary patch 或 symlink patch。
- 不新增第三方依赖，不 shell out 到 `git apply` 或系统 `patch`。
- 不新增用户配置开关或 per-tool enable/disable 管理。
- 不新增专属 TUI 渲染；第一版复用现有通用 tool call/result fallback。
- 不改变 app transcript contract、tool executor contract 或 provider agent contract。

## Decisions

### Decision 1: 输入支持 unified diff 子集和 Begin Patch 格式

选择：`apply_patch` 接收 `{ patch: string }`。第一种输入使用 unified diff 常见文本格式：支持标准 `--- a/path` / `+++ b/path` 文件头、`/dev/null` 新增文件、多 hunk、多文件；同时兼容 agent CLI 常见的非标准 update 格式：`diff --git a/path b/path` 后可以省略 `---` / `+++` 文件头并直接进入 `@@` hunk，由同路径 `diff --git` header 推断目标文件。第二种输入兼容 `*** Begin Patch` 格式，支持 `*** Add File: path` 和 `*** Update File: path`，并复用相同路径解析、hunk 精确匹配和 all-or-nothing 语义。`index` 等 header 可被解析或忽略，但不得引入额外语义。

理由：unified diff 是模型训练中常见的标准补丁格式；`*** Begin Patch` 也是 agent CLI 生态中常见的工具输入格式。支持两者可以降低模型第一次调用失败率，同时实现仍只解析新增/更新文本文件的小子集，安全边界保持可控。

替代方案：只支持 unified diff。该方案实现更小，但实际模型可能输出 agent CLI 常见的 `*** Begin Patch` 格式，导致不必要的首次失败。

替代方案：JSON search/replace。该方案结构化，但多行代码转义困难，不符合模型常见编辑习惯。

### Decision 2: 自己解析和应用，不调用 git apply

选择：在 TypeScript 中实现 unified diff 子集 parser 和应用逻辑，不依赖 git 或外部 `patch` 命令。

理由：工具的安全价值来自可控执行边界。自实现可以精确限制操作类型、文件大小和错误输出，并可以输出模型友好的失败原因。`git apply` 会引入完整 git patch 语义，禁用删除/rename/binary 和错误恢复都更难控。

替代方案：直接 shell out 到 `git apply`。该方案成熟且少代码，但与“可控、可审计的小型文本编辑工具”的目标不完全匹配。

### Decision 3: hunk 行号不作为唯一可信依据

选择：parser 读取 hunk header，但应用时主要使用 context lines 和 removed lines 构造 oldLines，在当前文件内容中做精确唯一匹配。匹配 0 次或多次都失败，并提示模型重新读取文件或增加上下文。

理由：LLM 容易写错 unified diff 行号。完全信任行号会提高失败率或误改风险；完全忽略上下文则不安全。精确唯一匹配能让失败可恢复，同时避免猜测式修改。

替代方案：严格按 hunk header 行号应用。该方案标准，但对 LLM 生成错误不友好。

替代方案：模糊匹配。该方案看似提升成功率，但会在不确定时猜测修改位置，风险过高。

### Decision 4: all-or-nothing 写入

选择：先解析并校验全部文件操作，在内存中应用全部 hunks；只有所有操作成功后才写入文件。任一失败不得写入任何文件。

理由：模型最难处理“部分成功、部分失败”的状态。事务式语义让失败恢复简单：读取当前文件，重新生成 patch。

替代方案：逐文件写入。该方案实现更简单，但失败恢复成本更高。

### Decision 5: 第一版不做专属渲染

选择：`apply_patch` 的 tool call/result 首版复用现有 generic tool renderer。工具结果文本返回简短 summary，例如 changed files 和失败原因。

理由：当前渲染层已有未知工具 fallback，足以支持功能验证。专属 UI 可在工具稳定后单独迭代。

## Risks / Trade-offs

- [Risk] 支持两种 patch 格式增加 parser 状态机复杂度 → Mitigation：两种格式只在 parser 入口分流，最终都转换成相同 `PatchOperation`，复用后续 sandbox、匹配和写入逻辑。
- [Risk] patch 子集过窄导致模型输出标准但未支持的 patch → Mitigation：失败信息明确列出不支持的操作，并在 tool description/system prompt 中写清支持范围。
- [Risk] hunk 匹配过严格导致 patch 失败率偏高 → Mitigation：失败时提示重新读取文件并增加上下文；不做模糊匹配以避免误改。
- [Risk] all-or-nothing 写入不是真正跨文件原子提交 → Mitigation：实现上保证失败前不写；写入阶段若发生 I/O 错误需返回明确错误。第一版接受本地文件系统写入阶段的极端故障风险。
- [Risk] 大 patch 或大文件造成内存/上下文压力 → Mitigation：内置 patch bytes、单文件 bytes、changed files 数量和 hunk 数量上限。
- [Risk] 模型继续用 bash 改文件 → Mitigation：更新内置 system prompt，建议常规源码/测试修改优先使用 `apply_patch`，但不硬禁 bash。
- [Risk] 允许 workspace 外路径会扩大写入范围 → Mitigation：当前按产品决策临时放开，后续由安全与权限模块补齐；本变更仍拒绝 NUL 和 `.git` 路径，并覆盖绝对路径与工作目录外相对路径测试。

## Migration Plan

1. 新增 `apply_patch` tool handler，定义工具 schema 和执行入口。
2. 实现 patch parser、基础路径校验、in-memory apply 和结果 summary。
3. 在默认 tool registry 注册 `apply_patch`，保持 bash tool 现有行为不变。
4. 更新内置 system prompt，建议常规文件修改优先使用 `apply_patch`。
5. 增加工具单测、registry 测试和 OpenAI request tool schema 测试。
6. 更新 docs 和主 specs。

## Open Questions

- 第一版写文件是否需要同目录临时文件 + rename 的 atomic-ish 写入，还是直接 `writeFileSync`；建议实现时优先选择简单可靠且测试可控的方案。

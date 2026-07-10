## Context

当前 agent loop runtime 在每次 provider turn 前调用 `buildProviderRecords()`，生成一条 transient `system` record。该 record 由 `createBuiltInSystemPrompt()` 拼接源码内置提示、当前 `cwd`、plan mode 约束和 skill catalog；它不写入 app transcript，也不由 OpenAI adapter 自行生成。

`AGENTS.md` 属于长期协作指令，更适合作为 provider system prompt 的附加 section，而不是让模型通过 `read_files` 自行读取。关键难点是项目根判定：如果没有稳定终点，从 `cwd` 向上递归读取可能误读用户 home 或更上层目录中的无关指令。由于全局配置已经使用 `~/.echo`，项目根判定还必须避免把用户 home 下的全局 `.echo` 误认为项目根。

## Goals / Non-Goals

**Goals:**

- 每次真实 agent run 自动加载全局 `~/.echo/AGENTS.md` 和项目内适用的 `AGENTS.md`。
- 使用 `.git` 和 `.echo` marker 判定项目根，并为没有 marker 的目录提供安全降级。
- 从项目根到当前 `cwd` 按路径顺序加载 scoped `AGENTS.md`，让更具体目录的指令自然后置。
- 保持 AGENTS 指令 transient，不进入 transcript、session persistence 或 OpenAI adapter 的 prompt 来源策略。
- 对缺失、不可读或过大的 AGENTS 文件安全降级，不阻断普通对话。

**Non-Goals:**

- 不实现用户配置字段来替换或关闭源码内置 system prompt。
- 不解析 AGENTS.md 的结构化语义，只按 Markdown 文本注入。
- 不引入第三方配置、glob 或 project-root detection 依赖。
- 不改变 skill catalog、tool registry 或 transcript compaction 的语义。
- 不在 TUI 中新增 AGENTS 管理界面。

## Decisions

### 1. 在 agent runtime 层加载 AGENTS 指令

AGENTS 加载放在 `agent-loop-runtime` 附近，而不是 OpenAI provider adapter 或工具层。runtime 已经拥有 `cwd`、interaction mode、skill catalog 和 transient provider records 的组装职责，能保证不同 provider 共享同一套 prompt 来源策略。

替代方案是让 OpenAI adapter 读取文件，缺点是会把 prompt policy 泄漏到 provider 边界，违背现有「OpenAI adapter 只转换传入 records」的设计。另一个替代方案是让模型调用 `read_files`，缺点是第一轮行动前无法获得约束，且读取结果会成为普通工具上下文而非 system-level 指令。

### 2. 项目根使用最近的 `.git` 或 `.echo` marker

从 `cwd` 向父目录查找项目根 marker，遇到第一个包含 `.git` 或项目 `.echo` 的目录即停止。`.git` 可为目录或文件，以兼容 worktree/submodule；`.echo` 作为项目 marker 时应忽略用户 home 下的全局 `~/.echo`，避免把 home 误判为项目根。

未找到 marker 时，项目根降级为当前 `cwd`，只尝试读取 `cwd/AGENTS.md`，不继续读取父目录 AGENTS。这个策略牺牲了部分非 git 项目从深层子目录启动时的自动发现能力，但避免无边界向上读取无关指令。

### 3. 全局与项目 AGENTS 分离加载

全局指令固定读取 `~/.echo/AGENTS.md`，不参与项目根判定。项目指令仅来自项目根到 `cwd` 的路径链路，例如：

```text
~/.echo/AGENTS.md                global
<project-root>/AGENTS.md         project root
<project-root>/src/AGENTS.md     scoped
<cwd>/AGENTS.md                  scoped, if different
```

system prompt 中按全局到具体路径的顺序呈现，并明确冲突时更具体项目路径优先，项目 AGENTS 优先于全局 AGENTS，但内置运行时约束和 plan mode 仍拥有最高优先级。

### 4. AGENTS 内容限制大小并保留来源标签

loader 应对单个文件和总注入内容设置上限，超出时截断并在 section 中标记 truncated。每个 section 带来源标签，例如 `Global AGENTS.md` 或相对项目路径 `src/AGENTS.md`，方便模型理解指令适用范围，同时避免在 OpenSpec 或测试中暴露绝对路径依赖。

大小限制是防止意外把超大文档塞入 prompt 的安全阀；它不需要成为用户可配置项，除非后续出现明确需求。

### 5. 失败降级为静默跳过

缺失、不可读、非普通文件或读取失败的 AGENTS 文件不应阻断 agent run。普通用户消息不应因为指令文件损坏而失败。测试可以通过注入 loader 或 fs seam 验证跳过行为；生产路径不需要向 transcript 追加错误。

## Risks / Trade-offs

- [Risk] 非 git 且未在上层放置 `.echo` marker 的项目，从深层目录启动时只读取当前目录 AGENTS。→ Mitigation: 文档和 spec 明确安全降级；用户可在项目根添加 `.echo` marker。
- [Risk] `~/.echo` 同时是全局配置目录，如果当作项目 marker 会误判 home。→ Mitigation: 项目根检测忽略 home 下的 `.echo` marker，全局 AGENTS 独立加载。
- [Risk] 多个 nested marker 可能导致只读取最近 marker 以内的 AGENTS，漏掉外层 monorepo 指令。→ Mitigation: 最近 marker 表示当前工作项目边界；需要跨 monorepo 的约定可放入全局 AGENTS 或当前项目根 AGENTS。
- [Risk] AGENTS 内容与内置安全约束冲突。→ Mitigation: prompt 明确内置运行时约束、tool 安全策略和 plan mode 优先级最高。
- [Risk] AGENTS 内容过大增加 token 成本。→ Mitigation: 单文件和总量上限，截断时保留可见提示。

## Migration Plan

这是纯新增运行时行为，无持久化 schema 或配置迁移。上线后已有项目如果没有 AGENTS 文件，请求形态保持不变；有 AGENTS 文件的项目会在下一次 agent run 自动生效。回滚只需移除 loader 调用和 prompt section 拼接，transcript 数据不受影响。

## Open Questions

- 初始实现的大小上限是否采用单文件 64 KiB、总量 128 KiB，还是需要更小以控制 token 成本？
- `.echo` marker 是否必须是目录，还是只要路径存在即可？建议第一版要求目录，减少误判。

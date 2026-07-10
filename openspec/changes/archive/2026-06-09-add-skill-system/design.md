## Context

echo_tui 当前已有 provider-neutral tool registry/executor、function tool continuation、slash command runtime、append-only transcript 和上下文压缩机制。现有能力可以把工具结果自然带入后续 provider 请求，并在上下文过长时通过 compaction 摘要早期记录。

skill 系统需要解决的是「按需加载任务工作流说明」：模型应知道有哪些 skill 可用，但不应在每轮请求里常驻所有 `SKILL.md` 全文。最终约定采用简单机制：skill catalog 常驻 system prompt，模型通过 `use_skill` 加载完整 skill 内容，完整内容作为普通 tool result 进入 transcript，并随现有 compaction 机制自然淡出。

## Goals / Non-Goals

**Goals:**

- 支持项目级 `.echo/skills/<name>/SKILL.md` 和用户级 `~/.echo/skills/<name>/SKILL.md` 的 skill 发现。
- 解析 `SKILL.md` frontmatter 中的 `name` 与 `description`，生成短 skill catalog。
- 在 provider system prompt 中注入短 catalog，引导模型在需要时调用 `use_skill`。
- 注册 `use_skill` 本地工具，按名称返回完整 skill 内容。
- 基于 transcript 中的 `use_skill` tool_call/tool_result 识别 skill 使用记录。
- 复用现有 tool result、transcript 和 compaction 行为，不新增独立生命周期状态。

**Non-Goals:**

- 不实现 active skill lease、session-scoped/manual-scoped 状态或手动逐出。
- 不实现 `/skill` slash command；带参数 slash command 的解析、suggestion、执行和 UI 行为后续单独 change 设计。
- 不把 slash 调用 skill 表达为伪造的 tool_call/tool_result；未来若支持 slash 调用，加载出的 skill 内容应以 user message 形式进入上下文。
- 不实现 skill supporting resource 读取工具、脚本执行、动态 shell 注入或 `allowedTools`/`disallowedTools`。
- 不兼容 Claude/Windsurf/Cursor 的全部配置格式；第一版只支持 echo_tui 自有目录和 `SKILL.md` 基础 frontmatter。
- 不引入第三方 YAML/parser 依赖；frontmatter 解析保持小而明确。

## Decisions

### Decision 1: catalog 常驻，skill body 通过普通工具结果进入上下文

系统 SHALL 只把 `{ name, description }` catalog 拼入 system prompt。完整 `SKILL.md` 由 `use_skill` tool 返回，并作为普通 `tool_result` 追加到 transcript。

理由：这与现有 `read_files` 等工具语义一致，模型按需取回缺失上下文；同时复用现有 continuation 与 compaction，不需要 host 判断 skill 是否仍被使用。

替代方案：维护 `ActiveSkillContext` 并在每轮 provider records 中额外注入 skill body。该方案会引入生命周期、恢复、逐出和 compaction 重挂策略，复杂度超过第一版需求。

### Decision 2: `use_skill` 是普通本地工具

`use_skill` SHALL 注册到默认 tool registry。它接收 `{ "name": string, "arguments"?: string | null }`，读取匹配 skill，返回包含 skill 来源、参数和正文的文本结果。

理由：普通工具路径已经具备 provider schema 暴露、JSON 参数解析、tool_call/tool_result 记录、错误结果和 continuation 处理。

替代方案：把 skill 加载作为 agent loop 内部特殊 tool。该方案会绕开现有 registry/executor 抽象，增加特殊分支。

### Decision 3: 第一版不实现 slash skill 调用

第一版 SHALL 不新增 `/skill` command，也 SHALL 不改造现有 slash command parser 来支持带参数命令。skill 使用记录只来自模型真实调用 `use_skill` 后产生的 tool_call/tool_result。

理由：现有 slash command 主要是无参数或受 command session 管理的交互命令；带参数 skill 调用会影响 parser、suggestion、history 和上下文注入语义，应该单独设计。

替代方案：在本 change 中顺手实现 `/skill <name>` 并伪造 `use_skill` tool_call/tool_result。该方案会把用户显式输入伪装成模型工具调用，语义不准确。未来 slash 调用 skill 时，应把加载出的 skill 内容作为 user message 注入上下文。

### Decision 4: skill 发现优先级保持明确且可测试

第一版扫描项目级和用户级目录。若同名 skill 同时存在，项目级 skill SHALL 覆盖用户级 skill；catalog 按名称稳定排序。无效 `SKILL.md` SHALL 被跳过或在加载时返回明确失败，不应阻止聊天主流程启动。

理由：项目级目录适合团队共享，用户级目录适合个人偏好；项目约束更靠近当前工作区，优先级更高。

替代方案：合并同名 skill 或要求用户选择。该方案增加交互复杂度，第一版收益不大。

## Risks / Trade-offs

- [Risk] 完整 skill body 作为 tool result 进入 transcript，可能增大上下文。→ Mitigation：catalog 只放短描述；skill body 仅按需加载；现有 compaction 会处理过长历史。
- [Risk] frontmatter 解析过于简单，无法支持复杂 YAML。→ Mitigation：第一版只声明支持简单 string 字段；复杂字段作为未来扩展。
- [Risk] 第一版没有 slash 手动调用入口，用户无法直接 `/skill xxx` 加载。→ Mitigation：保留模型自动 `use_skill` 闭环；slash skill 另开 change，按 user message 注入语义设计。
- [Risk] 项目 skill 是可被仓库修改的提示内容，可能影响模型行为。→ Mitigation：第一版只读取文本不执行脚本；未来如支持脚本或外部资源再引入信任策略。

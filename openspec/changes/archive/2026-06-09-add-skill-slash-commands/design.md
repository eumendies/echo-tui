## Context

`echo_tui` 当前已经有两条 skill 基础路径：一是默认 registry 扫描项目级 `.echo/skills/<name>/SKILL.md` 与用户级 `~/.echo/skills/<name>/SKILL.md`，二是模型可通过 `use_skill` tool 按名称加载完整内容。此前刻意没有实现 slash skill command，但已经明确未来 slash 调用 skill 时应以 `user` message 语义注入上下文，而不是伪造模型 tool call。

现有 slash command runtime 的语义是：命中 command 后由 handler 消费输入并停止普通提交流程。这适合 `/model`、`/clear`、`/compact`，但不适合 direct skill invocation，因为 `/<skill-name> args` 需要转换成一条 user message 后继续触发普通 agent turn。与此同时，用户希望通过 `/skills list` 查看 skill，通过 `/skills manage` 在 checkbox surface 中批量启用/禁用 skill，并要求 disabled 状态影响 provider catalog、`use_skill`、direct slash invocation 和 slash suggestion。

## Goals / Non-Goals

**Goals:**

- 支持 `/<skill-name> [arguments...]` 直接调用 enabled skill，加载完整 `SKILL.md` 内容并作为 user message 进入 transcript 与 provider 上下文。
- 支持 `/skills list` 与 `/skills manage`；manage 使用 checkbox surface，Space 切换、Enter 保存、Esc 放弃。
- 使用 skill 存储目录内的 JSON 状态文件持久化 disabled skill 名称，默认所有 discovered skills enabled。
- disabled 状态统一影响：system prompt catalog、`use_skill` tool、direct slash invocation、slash suggestion；但 `/skills list/manage` 仍展示 disabled skill 以便恢复。
- 尽量复用现有 command host、agent turn、transcript append、footer rendering 和 tests 结构。

**Non-Goals:**

- 不新增 `/skill` 单数命令。
- 不引入 YAML parser 或第三方依赖；第一版只支持 JSON 状态文件。
- 不实现 `/skills create/edit/delete`、skill marketplace、参数 schema、subcommand autocomplete 或 project-level committed config 之外的复杂策略。
- 不让 command handler 直接驱动 agent streaming；skill slash invocation 只把输入转换成 user message，后续仍走现有普通提交路径。

## Decisions

### 1. 使用 SkillManager 组合 registry 与启用状态

保留现有 `SkillRegistry` 的职责：扫描、解析、按名称加载原始 skill。新增一层 `SkillManager` 或等价模块组合 registry 与 state store，提供 enabled-aware API：

- `listSkills()`：返回所有有效 discovered skills，包含 enabled/disabled/source/sourcePath/description。
- `listEnabledCatalog()`：只返回 enabled skills，用于 provider catalog 和 slash suggestion。
- `loadEnabledSkill(name)`：只允许加载 enabled skill；disabled 时返回明确失败。
- `saveSkillStates(items)`：按当前 effective skill 的 source root 写入 disabled 列表。

这样可以避免把持久化策略塞进 registry，同时让 provider、tool 和 slash commands 共享同一套 enabled 语义。

### 2. 状态文件放在 skill root 内，格式固定为 JSON

每个 skill root 使用独立状态文件：

```text
.echo/skills/skills.json
~/.echo/skills/skills.json
```

格式：

```json
{
  "schemaVersion": 1,
  "disabled": ["code-review"]
}
```

默认无文件、文件不可读或 JSON 无效时不阻断启动，按全 enabled 处理；`/skills manage` 保存时写回规范 JSON。状态跟当前 effective skill 的 source root 绑定：project skill 写项目级 state，user skill 写用户级 state；项目级覆盖用户级时只展示和管理项目级那一条。

选择 JSON 而不是 YAML，是为了复用 Node 内建 JSON 能力，不新增依赖，也避免和当前轻量 frontmatter parser 的设计方向冲突。

### 3. CommandRuntime 增加“继续提交 user message”的返回语义

现有 `startFromText(text): boolean` 只能表达“命令是否消费输入”。需要扩展为结果对象，例如：

```ts
type CommandStartRuntimeResult =
  | {kind: 'not_matched'}
  | {kind: 'handled'}
  | {kind: 'submit_user_message'; text: string; historyText: string; metadata?: Record<string, unknown>};
```

旧命令返回 `void` 仍映射为 `handled`。direct skill invocation handler 返回 `submit_user_message`，由 `main.submitComposer()` 继续走原有 user turn、spinner、agent callbacks、tool continuation 和 error handling。这样 command handler 不需要接触 agent，也不会复制 streaming 流程。

### 4. Slash skill 注入使用 user record metadata 记录来源

Direct slash skill invocation 生成一条 `role: 'user'` 的 transcript record。`text` 包含 skill 名称、来源、arguments 和完整正文；扩展 metadata 记录：

```ts
skillInvocation: {
  source: 'slash',
  skillName: string,
  argumentsText?: string,
  sourceKind: 'project' | 'user',
  sourcePath: string
}
```

usage helper 后续可以同时识别 `use_skill` tool call 和 slash-injected user record。输入历史应记录原始 slash 文本，而不是完整 skill 正文，避免 Up/Down 历史出现大块内容。

### 5. 新增 checkbox command surface

新增 `CheckboxCommandSurface`，渲染风格接近现有 select surface，而不是 choice 的高优先级边框弹窗。每项显示 `[x]` 或 `[ ]`，当前项用 `›` 和高亮表示。`/skills manage` 使用该 surface 的 data 保存草稿 enabled 状态：Space 只改内存草稿，Enter 批量保存，Esc 放弃。

### 6. Slash suggestion 使用动态 descriptor provider

当前 slash suggestion 初始化时接收固定 descriptors。启用状态引入后，suggestion 必须动态计算：built-in commands 加上当前 enabled skills。`/skills manage` 保存后无需重启，下一次 footer 渲染应立刻反映：disabled skill 不再出现在 suggestion；但 `/skills list/manage` 仍可看到它。

## Risks / Trade-offs

- [Risk] `/<skill-name>` 与内置 slash command 同名产生冲突 → Mitigation：内置命令优先，direct skill handler 最后匹配；冲突 skill 不作为 direct suggestion 展示。
- [Risk] disabled 状态在 catalog、tool、slash suggestion 中不一致 → Mitigation：通过统一 SkillManager API 提供 enabled catalog 和 enabled load，避免各路径自行过滤。
- [Risk] 状态文件损坏导致 skill 不可用 → Mitigation：读取失败时按全 enabled 降级，保存 manage 状态时重写有效 JSON。
- [Risk] slash 注入完整 skill 正文污染输入历史 → Mitigation：transcript/provider 使用注入内容，composer history 使用原始 slash 文本。
- [Risk] 新 command runtime 返回语义扩大改动面 → Mitigation：保持旧 handler 返回 `void` 兼容，新增结果只由 direct skill invocation 使用。

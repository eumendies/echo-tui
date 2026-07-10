## Context

当前 `/skills` 相关行为由 `SkillsCommandHandler` 承载：`/skills` 和 `/skills list` 打开只读 `info` surface，`/skills manage` 打开通用 `checkbox` surface。skill 状态由 `skill-manager` 统一读取和保存，保存后同一个 enabled catalog 会影响 provider catalog、slash suggestion、direct skill invocation 和 `use_skill`。

目标 UI 参考外部 demo `terminal_skills_manager.py`：一个 cyan card 风格的 skills manager，展示 enabled 计数、每行 on/off pill、当前行 accent 和高亮背景。demo 中的搜索框、`a` 全选、`n` 全不选、`j/k`、home/end 不纳入本次行为范围，避免扩大输入协议和测试面。

## Goals / Non-Goals

**Goals:**

- 让纯 `/skills` 成为唯一的本地 skill 管理入口。
- 删除 `/skills list` 和 `/skills manage` 的本地命令逻辑，不保留兼容分支。
- 用专用 skills command surface 渲染新的 card-style manager UI。
- 保留现有语义：展示所有有效 discovered skills，disabled skill 仍可见且可重新启用；Enter 保存，Esc 取消。
- 保存后立即影响 enabled catalog 和 slash suggestion。

**Non-Goals:**

- 不实现搜索框或过滤交互。
- 不引入第三方 TUI 库、alternate screen 或新的 raw key parser。
- 不改变 skill discovery、frontmatter 解析、状态文件格式或 `use_skill` tool 协议。
- 不新增 `/skill` 命令，也不改变 direct skill invocation 的消息注入语义。

## Decisions

### 使用专用 `skills` command surface

新增 `SkillsCommandSurface`，由 `renderCommandSurface()` 按 `kind: 'skills'` 分发到独立 renderer。surface 数据包含标题、skills、selectedIndex、enabledCount 或可由 renderer 计算的 enabled 状态，以及 dismissHint。

理由：新的 UI 有 enabled 计数、on/off pill、active row accent、滚动提示和更强的视觉语义，已经超出通用 `checkbox` surface 的职责。继续复用 checkbox 会让通用 renderer 被 skills 专属视觉污染，也会影响未来其他 checkbox 场景。

替代方案：直接增强 `checkbox` renderer。优点是改动较少；缺点是所有 checkbox 都获得 skills manager 的视觉和语义，抽象边界变差。

### 只匹配纯 `/skills`

`SkillsCommandHandler.match()` 收紧为只匹配 trim 后等于 `/skills`。`/skills list`、`/skills manage` 和其他带参数文本不再命中该本地命令。

理由：当前没有封版兼容要求，用户明确希望直接删除旧逻辑。收紧匹配比保留 usage surface 或别名更简单，也符合现有多数 slash command 的“精确命中才作为本地命令”模式。

替代方案：旧子命令打开新 UI 或显示迁移提示。优点是兼容；缺点是增加不需要的分支和测试，延续旧 mental model。

### 复用现有 command runtime key handling

会话内继续消费现有 `InputEvent`：`MOVE_UP`、`MOVE_DOWN`、`TEXT` 中的空格、`SUBMIT`、`ESCAPE`。不新增 `a`、`n`、`/`、`j/k` 或 home/end 行为。

理由：该 TUI 已经把平台 escape sequence 解析集中在输入层，命令 handler 应只使用现有语义事件。先保持最小可验证交互，避免为了 demo 的完整功能扩展输入协议。

### 状态保存仍走 skill manager

`/skills` surface 编辑的是一份草稿 skills 数组。Space 只更新 session data；Enter 才调用 `host.skills.saveSkillStates()`；Esc 关闭 session 并丢弃草稿。

理由：这延续现有 `/skills manage` 的事务语义，避免用户误操作立即持久化。保存后 `skillManager` 更新内存缓存，后续 slash suggestion 和 provider catalog 继续通过现有路径读取最新 enabled view。

## Risks / Trade-offs

- 旧输入 `/skills list` 和 `/skills manage` 不再打开本地管理 UI → 文档、spec 和测试必须同步更新；未封版阶段接受该破坏性变化。
- 专用 surface 增加一个 renderer 分支 → 通过 footer renderer 单元测试约束 card 宽度、截断、选中态和 hint，避免写满终端最后一列。
- demo 使用 Unicode 符号和 RGB 颜色 → 沿用项目已有 ANSI helper 和 footer safe width 约束；必要时用现有 `ansi.rgb`、`padVisibleText`、`clampPlainText` 保持布局稳定。
- skills 数量超过可见区域时需要滚动提示 → renderer 或 handler 应根据 selectedIndex 计算窗口，测试覆盖顶部/底部 more 行和 selectedIndex 投影。

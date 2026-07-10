## Context

当前 TUI 已有统一 slash command runtime：用户提交纯 `/help`、`/model`、`/clear` 或 `/resume` 后，runtime 打开对应 command session，并由 footer renderer 渲染 `info` / `select` / `confirm` command surface。这个机制适合“已经提交并进入命令会话”的交互。

slash 命令提示发生在 composer 编辑期间：用户只是输入了 `/` 或 `/m`，composer 仍需要可编辑、光标仍需要显示，Up/Down/Tab 应该临时作用于补全列表而不是打开 command session。因此该能力应该建模为 composer 的临时 suggestion overlay，而不是复用 active command session。

## Goals / Non-Goals

**Goals:**

- 在普通 composer 输入态下，根据当前 slash 前缀展示可用命令和描述。
- 为默认 slash command handler 提供用户可见 description，并复用同一份命令注册表派生提示项。
- 在 suggestion 可见时，Up/Down 循环移动候选项，Tab 将当前候选命令补全到 composer。
- 保持 composer 光标、文本编辑、footer 高度预算和现有 slash command session 语义稳定。
- 确保提示交互不写 transcript、不进入输入历史、不启动 agent、不绕过 response lock。

**Non-Goals:**

- 不支持 fuzzy search，只做简单 prefix 过滤。
- 不支持命令参数提示、参数补全或多级菜单。
- 不让 Enter 接受补全；Enter 继续提交当前 composer 文本。
- 不改变现有 slash 命令只匹配纯命令的规则。
- 不新增第三方 TUI、readline 或 autocomplete 依赖。

## Decisions

### 1. 使用 composer suggestion overlay，而不是 command session

提示列表将作为 `RenderState` 的普通输入态附加信息传给 footer renderer，例如 `slashSuggestions`，在 `commandSurface` 为 `null` 时显示在 composer 下方。active command session 优先级保持最高；一旦 `/model`、`/resume` 等命令真正启动，就不再显示 suggestion overlay。

替代方案是把提示也建模为 `select` command surface，但这会隐藏 composer 光标，并且让“编辑中补全”变成“命令会话”，与现有 command runtime 的提交后语义冲突。

### 2. 命令元数据由 handler 暴露

默认 slash handler 增加 `description` 字段，`name` 继续使用不带 slash 的稳定命令名。提示项展示时统一拼成 `/${name} — ${description}`；提交匹配仍通过现有 `match(text)` 完成。

这样可以避免维护第二份命令清单。新增命令时，只要注册 handler 并填写 description，就自动出现在提示列表中。

### 3. 简单 prefix 触发与过滤

slash suggestion 只在以下条件同时满足时显示：

- 当前没有 active command session；
- assistant 不处于 thinking 或 streaming；
- composer 文本是单行；
- composer 文本以 `/` 开头；
- composer 文本不包含空格；
- 至少有一个命令名以当前前缀匹配。

`/` 显示全部命令，`/m` 只显示 `/model`。`hello /`、`/model more`、多行输入都不显示提示，继续按普通 composer 行为处理。

### 4. Up/Down/Tab 的事件优先级

事件分发保持这个优先级：

```text
active command session
  └─ 交给 command runtime
slash suggestions visible
  ├─ Up/Down: 循环移动 suggestion selection
  ├─ Tab: 补全当前命令到 composer
  └─ Esc: 可关闭本轮 suggestion 视图，保留 composer 文本
普通 composer
  └─ 历史浏览、多行移动、编辑、提交
```

补全结果不自动追加空格，例如 `/m` + Tab 变成 `/model`。这是为了保持现有“纯 `/model` 才进入命令”的匹配规则。

### 5. 独立 suggestion 状态

实现上新增小型 `SlashSuggestionContext`，持有 `selectedIndex` 和可选的 dismissed prefix。候选项每次根据 composer 文本和 handler metadata 派生，不需要持久化。它是 `AppContext` 组合的子 context；`main.ts` 只通过 `AppContext` 门面配置命令描述、读取 render state 和分发 suggestion 事件。

也可以把逻辑放入 `ComposerContext`，但 slash suggestion 依赖 command registry，不完全属于文本编辑本身；作为 `AppContext` 下的独立子 context 边界更清楚。

## Risks / Trade-offs

- [Risk] Up/Down 与输入历史浏览冲突 → 仅在 slash suggestion 可见时抢占 Up/Down；否则保留现有历史浏览和多行移动逻辑。
- [Risk] Tab 补全后命令无法提交 → 补全不追加空格，保证 `/model` 仍是纯命令。
- [Risk] footer 变高挤压 streaming pending preview → suggestion 进入 `RenderState` 后由现有 footer 行数预算自然扣减 pending 可用高度。
- [Risk] suggestion 与 active command session 同时显示 → `commandSurface` 非空时不渲染 suggestion，事件也优先交给 command runtime。
- [Risk] response 期间显示可选但不可执行的命令 → response lock 活跃时不显示 suggestion。

## Context

status line 不是独立组件，而是 composer surface 内部拼出的一行文本：

- `src/render/footer/composer-surface.ts` 的 `renderStatusLineText()` 先分别构造左侧与右侧 segment 数组，再按 `left + 填充 + right` 对齐；右侧放不下时整体丢弃，左侧再放不下时按 `clampPlainText` 截断。
- 左侧由 `createLeftStatusSegments()` 生成：`model`（含 `(SKILL override)` 后缀）→ `effort` → `sessionTitle` → `TOOLS all` → `dir <项目名>`。
- 右侧由 `createRightStatusSegments()` 生成：tuning 保存错误 → `ctx <used>/<window>` → mode segment（含 echo spinner、`PLAN`、`SHELL ctx|local`、MCP 初始化、subagent 视图标识）→ `keyHint`。
- 同一份单行文本同时服务普通 composer surface 和 `renderSubagentViewSurface()`（subagent 会话窗口的 run 索引块下方）。

配置链路已经存在且是本次的复用对象：

`AppSettings`（`src/config/app-settings-config.ts`）→ `AppRenderPreferences`（当前 `Pick` 三个字段）→ `AppContext.createRenderState()` 手工组装 `renderPreferences` → `RenderState.renderPreferences` → `renderFooterLayout()` → `renderComposerSurface()`。`AppContext.applyAppSettingsSnapshot()` 计算变化标志，`src/app/main.ts` 据此在"普通 footer 重绘"和"destructive replay"之间选择。

配置面板侧的结构约束：

- `ConfigCommandSurface` 是按 `view` 分支的联合类型，`ConfigCommandData` 按 Tab 存放独立 slot。
- 常规 Tab 的行集合由 `getGeneralConfigRowIds()` 单点投影，handler 与 renderer 共用；dirty 由 `createGeneralDraftFingerprint()` 对整份 `AppSettings` 草稿做 `JSON.stringify` 判定。
- `systemPrompt` 子视图已经给出"常规 Tab 一行入口 → `ConfigCommandData` 上的独立 slot → `createConfigSurface()` 优先返回该 view → handler 优先分发"的完整范式，并且明确演示了 Esc 先退回常规 Tab、Tab 才切页的层级。
- `config surface` 不注册 hit region，`ConfigCommandHandler` 没有 `handlePointer`，所以子面板只能是"可聚焦行 + Enter"。

## Goals / Non-Goals

**Goals:**

- 让用户按自己的信息偏好裁剪 status line，6 个可选 segment 各自独立开关。
- 配置读、写、归一化、校验全部落在既有 `AppSettings` 管线里，不引入第二份配置来源。
- 配置面板入口尽量轻，不新增独立 slash command，也不破坏既有 Tab / dirty / 放弃确认语义。
- 渲染期过滤保持纯函数，不改变 footer 单行高度、裁剪顺序和 safe render width 约束。
- 保存和外部 watcher 变化都即时反映到可见 status line，代价仅是一次 footer 重绘。

**Non-Goals:**

- 不支持自定义 segment 顺序或任意自定义文本段。
- 不让 `mode` 和 `keyHint` 可配。它们是运行状态与中断提示的核心反馈，隐藏后会直接影响可操作性。
- 不实现 `ui.statusLine` 的逐段样式（颜色、前缀符号）配置。
- 不把 status line 拆成多行或在 `maxLines` 内换行布局。
- 不改动 `/status` 命令的只读卡片（那是独立 command surface，不是普通输入态 status line）。
- 不为 headless `--once` 增加渲染行为（它不渲染 footer）。

## Decisions

### 决策 1：用 `ui.statusLine` 布尔对象，不用黑名单数组或预设档位

```json
{"ui": {"statusLine": {"approval": true, "contextUsage": true, "dir": true, "effort": true, "model": true, "title": true}}}
```

字段按字母序排列，与 `AppSettings` 现有字段风格一致。默认全部 `true`，缺失、非布尔值或 `ui.statusLine` 不是对象时逐字段回退默认值。

备选 A：`ui.statusLine.hidden` 黑名单数组，与 `tools.mainAgent.disabledTools` 同构，加段不必改 schema。放弃原因：语义是"隐藏了什么"，配置面板要反向渲染成"已隐藏集合"，用户读配置文件时也需要做一次心算；而用户真正想表达的是"我要看到哪些"。

备选 B：预设档位（完整 / 精简 / 极简）。放弃原因：需求是细粒度可配，档位无法覆盖"只要 model + ctx"或"只要 dir + mode"这类组合。

### 决策 2：入口放在常规 Tab 的一行，展开为 `view: 'statusLine'` 子面板

常规 Tab 在 `reasoningSummary` 之后插入 `'statusLine'` 行，值为 `6 项全开` / `N 项开启` / `全部隐藏` 的摘要；Enter 进入 `ConfigCommandSurface` 的新变体 `{view: 'statusLine'}`。

备选 A：常规 Tab 内联 6 行开关。放弃原因：常规 Tab 已有 15 行，再加 6 行会把高频项（压缩阈值、审批模式）推出首屏，且 6 个同构开关在视觉上会淹没其他设置。

备选 B：挂到外观 Tab。放弃原因：外观 Tab 当前语义是"选择即保存"，没有脏跟踪和保存行；把需要显式保存的开关放进去会破坏"外观选择立即持久化"的既有要求，或额外引入一套保存语义。

### 决策 3：子面板不持有独立草稿，直接读写常规 Tab 的 `draft.statusLineSegments`

`ConfigCommandData` 新增 `statusLine?: ConfigSlot<StatusLineConfigState>`，其中 `StatusLineConfigState` 只保存 `selectedIndex`（以及 `error` / `feedback` 展示槽）。开关值一律取自 `data.general.state.draft.statusLineSegments`。

这样 dirty 判定、显式保存、`discardConfirm` 保护全部沿用既有实现：`createGeneralDraftFingerprint()` 对整份 `AppSettings` 做 `JSON.stringify`，新增对象字段自动纳入。

备选：像 `systemPrompt` 那样持有独立 state 并在子面板内维护副本。放弃原因：`systemPrompt` 独立是因为它管理磁盘文件而非常规草稿；status line 段是标准常规设置，独立副本会与常规页形成两个真值来源。

### 决策 4：过滤发生在 `composer-surface.ts` 的 segment 构造函数内部

`createLeftStatusSegments()` / `createRightStatusSegments()` 各增加一个 `segments` 参数，按开关决定是否 push。

备选 A：在 `app` 层构造 `StatusLineState` 时就把关掉的字段设为 `undefined`。放弃原因：`StatusLineState` 目前省略 `sessionTitle` 表示"没有标题"、省略 `contextUsage` 表示"还没有真实 usage"，用同一种 `undefined` 表达"用户不想看"会混淆"事实缺失"和"显示偏好"，并让 `/status` 之外的未来消费者无法区分。

备选 B：新建独立 status line 组件。放弃原因：`renderStatusLineText()` 已有对齐、降级和裁剪逻辑，拆组件会同时改动 `renderComposerSurface` 和 `renderSubagentViewSurface` 的行数假设，收益不成立。

### 决策 5：`renderPreferences` 整体下传，替换 `slashSuggestionMaxVisible` 位置参数

`renderComposerSurface()` 目前已经接受 9 个位置参数，其中 `slashSuggestionMaxVisible` 是唯一从偏好里挑出来的标量。本次改为传整个 `renderPreferences`，`renderSubagentViewSurface()` 也增加同一参数。参数总数不增，且新增偏好不需要再改签名。

### 决策 6：tuning 强制显示，mode 与 keyHint 不可配

- `model.kind === 'tuning'` 时 `model` 和 `effort` 段无条件输出。否则 `Ctrl+T` 调节期间用户看不到 `‹model›` 焦点和暂存值，`composer-model-tuning` 的既有反馈要求会被破坏。
- `mode` segment 无条件保留：它是"当前是 ready / PLAN / SHELL / MCP 初始化 / subagent 视图"的唯一反馈，也是全关配置下的兜底，保证 status line 永不退化为空行。
- `keyHint` 无条件保留：`Esc 中断` 和 `Esc 移除待发送` 是操作性提示，隐藏会让用户无从得知可以中断。

### 决策 7：变化即时生效，但只走普通 footer 重绘

`applyAppSettingsSnapshot()` 增加 `statusLineSegmentsChanged`，`main.ts` 把它并入已有的"只需 `renderCoordinator.render()`"分支。

依据：段显隐不改变 transcript 投影，与 `slashSuggestionLimitChanged` 同类；`historyRenderLineLimitChanged` 和 `reasoningVisibilityChanged` 才需要 destructive replay。

## Risks / Trade-offs

- **配置面板层级变深，Esc 语义需要精确。** 子面板 Esc 只退回常规 Tab，再次 Esc 才走 `requestClose()` 的脏检查与放弃确认 → 沿用 `systemPrompt` 子视图已经验证过的层级，并在 handler 里保持"子视图先清空 slot"的顺序；Tab 在子面板内仍然切页，行为与 `systemPrompt` 的 menu 态一致。
- **6 个开关分散在两处渲染路径（普通 composer 与 subagent 视图）可能漂移。** → 两条路径共用同一个 `renderStatusLineText()` 和同一份 `statusLineSegments`，偏好只从 `renderPreferences` 单点读取。
- **默认值必须与旧行为逐字节等价。** → 默认全 `true`，且 `DEFAULT_RENDER_PREFERENCES` 同步；测试用默认 preferences 断言既有 status line 输出不变。
- **全关配置下用户可能失去"我在哪个目录/哪个模型"的感知。** → 保留 mode 段作为最低限度反馈；配置面板入口行始终显示 `全部隐藏` 摘要，让用户知道是自己关掉的。
- **既有测试直接构造不完整的 `renderPreferences` 对象。** → 按项目约定让测试适配运行时类型，补齐字段，而不是在生产代码里加只为兼容测试的兜底分支。
- **配置面板新增 view 分支可能漏掉 dirty 与 Tab strip 状态。** → 子面板不参与 `createConfigTabs()` 的 dirty 计算，dirty 继续由 `general` 承担，与 `systemPrompt` 的处理一致。

## Migration Plan

不需要数据迁移。`ui.statusLine` 缺失时按默认全开读取，等价于当前行为；保存常规设置时只写入本 Tab 拥有的字段，`ui` 下的其他已知与未知键继续保留。回退到旧版本时该节点作为未识别数据保留，旧版本忽略它并显示完整 status line。

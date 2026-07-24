## Context

当前 `/model` 和 `/effort` 分别通过 command surface 修改用户级 LLM 配置，启动命令时会重置 composer，且两个选择通过独立写入完成。普通 composer 的 status line 已经展示当前 model 与显式 effort，输入分发也已经为 tool approval、user question、file picker、command session、slash suggestion 和 interaction mode 建立优先级。

本变更需要跨越 raw key parsing、app 瞬时状态、配置持久化和 footer rendering，同时保持当前终端、ANSI redraw、safe width、响应锁及 append-only transcript 约束。调节模式只服务交互式 TUI，不进入 provider 请求或 `--once` 路径。

## Goals / Non-Goals

**Goals:**

- 使用稳定的 `Ctrl+T` 控制字符进入 composer model/effort 调节模式。
- 保留用户草稿和逻辑光标，以暂存方式浏览 model 与 effort，并在确认时一次性持久化。
- 复用普通 composer box 和 status line，不增加独立 command surface 或下方操作提示行。
- 对配置错误、终端窄宽度、响应锁和其他活跃交互 surface 给出确定行为。

**Non-Goals:**

- 不提供仅下一次 assistant turn 生效的 model/effort override。
- 不替代或移除 `/model`、`/effort` 和 `/config`。
- 不修改 provider 支持的 effort 枚举，也不探测 provider 远端能力。
- 不允许在 shell/shell-local、active response、MCP 初始化或其他 modal flow 中调节模型。
- 不改变 composer 文本、transcript、session journal 或 input history 格式。

## Decisions

### 1. 使用 `Ctrl+T` 的独立语义输入事件

key parser 将 ASCII `0x14` 映射为独立的 model tuning toggle 事件。`Ctrl+T` 当前未被 Echo TUI 使用，跨常见终端传输稳定，也不会像 `Alt+M` 一样依赖可能跨 stdin chunk 拆分的 Escape 前缀。

备选方案包括 `Alt+M`、`Ctrl+R`、`Ctrl+Tab` 和功能键；它们分别存在 Escape 歧义、readline 历史搜索预期、终端编码不一致或多个序列变体，因此不采用。

### 2. 使用专属瞬时调节状态，而不是 command session

AppContext 持有实例级 model tuning 子状态或等价职责边界。状态至少包含活动字段、model 候选、当前候选 model、该 model 的暂存 effort、脱敏错误和进入前的选择快照。状态不写 transcript、session 或配置，直到用户按 Enter。

不复用 command session，因为 command surface 会替换 composer/status line，并且现有 `/model`、`/effort` handler 会重置 composer。独立瞬时状态可以直接参与普通 render state 派生，并保持草稿不变。

### 3. 调节模式作为 modal composer 子模式分发输入

进入调节模式后，`Tab` 与 `Shift+Tab` 切换 model/effort 活动字段，左右键循环候选，Enter 确认，Esc 或再次按 `Ctrl+T` 取消。调节状态应在全局 `Shift+Tab` 工具授权、slash suggestion 和普通 composer 编辑之前消费这些事件；`Ctrl+C`、`Ctrl+D` 仍保留退出应用语义。

当高优先级 user question、tool approval、file picker 或 command session 活跃时，事件继续由对应 surface 消费。active response、MCP 初始化和 shell/shell-local 模式下不会创建调节状态。普通或 plan composer 中已有 slash suggestion 时可以进入调节模式；调节期间隐藏 suggestion，退出后根据未改变的草稿重新派生。

### 4. model 切换加载目标 profile 自己的 effort

调节状态从 ModelContext 的缓存/配置快照创建 model 候选。切换 model 时，暂存 effort 改为目标 profile 当前显式 effort；未配置 effort 时使用与 `/effort` 一致的 `medium` 起点。effort 候选只包含既有 `REASONING_EFFORTS`，左右移动采用首尾循环，避免把前一个 model 的 effort 无意应用到新 model。

如果用户先调整 effort 再切换 model，先前暂存的 effort 不迁移到新 model；这是 model 与其 profile 配置绑定的结果。该设计比为所有候选维护未提交 effort map 更简单，也避免一次确认修改多个非选中 profile。

### 5. model 与 effort 使用单次配置事务应用

ModelContext 提供组合保存操作，在一次 `JsonConfigFile.update` 中校验目标 model id、更新 `llm.selectedModel`，并只更新目标 profile 的 `reasoning.effort`，同时保留 reasoning summary 等其他字段。配置写入成功后刷新 ModelContext 缓存；model 确实变化时清空旧 context usage。

不顺序调用现有 `selectModel()` 与 `selectEffort()`，因为两次写入可能留下半完成状态，且第二次操作依赖第一次已经改变 selected model。写入失败时不更新缓存，调节模式保持打开并在 status line 展示脱敏错误，用户可以重试或取消。

### 6. 通过 composer placeholder 和 status line 表达模式

调节模式不增加 footer 行。composer 为空时，原始 mode placeholder 临时替换为 `Tab 切换字段 · ←/→ 调整 · Enter 应用 · Esc 取消`；composer 非空时只展示原始用户文本，不插入 hint。退出后恢复 normal 或 plan 的原始 placeholder。

普通与 plan 空 composer placeholder 均展示 `Ctrl+T 模型` 快捷提示；普通 placeholder 同时压缩既有 mode 和授权文案，确保常见 80 列终端仍能完整显示。status line 使用暂存 model/effort 而非已持久化缓存投影，并用 `‹...›`、accentStrong 或等价样式突出活动字段。模型渲染状态统一收敛到 `statusLine.model` 可辨识联合类型：普通态保存 label、可选 effort 与 skill override，调节态保存暂存 label、明确 effort、活动字段与错误，避免同一语义分散在 `modelLabel` 和 `modelTuning` 中。普通与调节态 effort segment 均不显示圆点前缀，以减少宽度占用。即使 composer 有文本，也能从 status line 判断当前活动字段。调节期间隐藏 composer 光标；所有行继续遵守 safe render width，placeholder 放不下时沿用现有仅显示 prompt 的降级行为。

## Risks / Trade-offs

- [用户在有草稿时看不到按键 hint] → status line 始终高亮活动字段，并在 `/help` 和普通快捷键说明中记录 `Ctrl+T`。
- [外部进程在调节期间修改配置] → 确认时基于最新配置执行事务并重新校验 model id；失败则保留调节状态并展示脱敏错误。
- [Tab 和 Shift+Tab 与现有 mode/tool 操作冲突] → 调节状态优先消费这些按键，退出调节模式后恢复原有语义。
- [窄终端无法完整显示 model、effort 和提示] → 优先保留左侧活动 model/effort，按现有 safe width 规则省略 placeholder 或右侧状态。
- [未配置 effort 的 profile 进入调节后会采用明确档位] → 与 `/effort` 保持一致，以 `medium` 作为起点，并在确认时写入目标 profile。

## Migration Plan

该变更只新增交互路径和瞬时状态，不需要迁移现有配置或 session。发布后现有 `/model`、`/effort` 行为保持可用；回滚时移除快捷事件和调节状态即可，已保存的配置仍是兼容的标准 LLM 配置。

## Open Questions

无。

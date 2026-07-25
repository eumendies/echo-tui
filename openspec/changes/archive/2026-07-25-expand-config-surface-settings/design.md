## Context

当前 `/config` 的 command session data、状态转移和 renderer 都围绕 `LlmConfigDraft` 设计，provider 列表是顶层页面，provider/header/model 详情是其子页面。`/themes` 则使用独立 `select` surface，并把 base theme 保存到独立的 `~/.echo/theme.json`。两者已经具备受控 command host 端口、原子 JSON 写入和即时运行时刷新能力，但没有统一导航层。

自动上下文压缩当前直接使用固定 `COMPACTION_THRESHOLD_RATIO = 0.8`；slash suggestion renderer 只根据终端高度决定可见窗口；`reasoning_summary` 作为可见且持久化的 transcript 事实由 append、destructive replay 和 final render 无条件投影。`~/.echo/config.json` watcher 当前只刷新 model cache。

本变更跨越 command 状态、两个用户配置文件、agent run 参数、app 配置缓存和 transcript 渲染。它必须继续遵守 ANSI footer redraw、safe width、不使用 alternate screen、append-only transcript、配置敏感信息保护和 headless/runtime 共用 agent loop 等约束。

## Goals / Non-Goals

**Goals:**

- 把 `/config` 建成可扩展的 Tab 配置中心，同时复用现有 provider/model 编辑能力。
- 提供可校验、可持久化且可即时刷新 UI 的常规设置。
- 让自动压缩阈值对 TUI 和 `--once` 共用的 assistant run 生效，并保持单次 run 内配置稳定。
- 只限制 slash suggestion 同时可见行数，不损失候选导航和补全能力。
- 将 reasoning summary 的事实保存与可见投影解耦，允许隐藏和恢复历史摘要。
- 在不迁移 theme token override 的前提下，将主题选择入口整合进配置中心。

**Non-Goals:**

- 不把 `/mcp`、`/hooks`、`/skills` 或其他复杂管理器纳入本次配置中心。
- 不编辑自定义 theme token，只选择已有内置 base theme。
- 不显示 provider 私有、加密或未提供的完整 chain-of-thought；开关只控制 `reasoning_summary` record。
- 不提供关闭自动压缩的选项，也不改变保留最近记录数、边界吸附或摘要生成算法。
- 不删除 `/model` 或 `/effort` 快捷命令。
- 不改变 transcript/session journal schema、reasoning provider request 配置或模型 profile 的隐藏 reasoning round-trip 规则。

## Decisions

### 1. 增加配置中心根状态，现有 LLM 状态成为子控制器

`ConfigCommandData` 或等价根状态持有 `activeTab`，并分别保存常规、模型和外观 Tab 的状态。command surface 使用可辨识联合类型只投影当前 Tab 内容；renderer 不读取配置文件，也不执行保存副作用。现有 `ConfigCommandState` 和 `ConfigPanelController` 保留 provider/header/model 子页面语义，但改为“模型与 Provider”Tab 的子状态。

Tab 固定为“常规”“模型与 Provider”“外观”。纯 `/config` 默认打开“常规”，用户通过 Tab 进入“外观”。Tab 在三个 Tab 间单向循环，并保留离开 Tab 前的草稿、选择索引、子页面和文本编辑 buffer；Tab strip 在模型详情等子页面中仍然可见。

备选方案是继续向 `ConfigCommandState` 增加大量 optional 字段，或让每个 Tab 启动独立 command session。前者会把互不相关的状态模式组合成难以校验的巨型状态，后者无法自然保留跨 Tab 草稿，因此不采用。

### 2. 按 Tab 延迟初始化并隔离读取错误

配置中心只在首次激活某个 Tab 时读取该域配置并创建状态。常规和模型 Tab 的无效 `config.json` 错误只投影到对应 Tab；外观 Tab 独立读取 `theme.json`，因此即使 `config.json` 损坏，切到外观 Tab 仍能查看和选择主题。

每个 surface 快照携带三个 Tab 的可用、错误和 dirty 摘要状态，以便 tab strip 表达问题，但详细错误只在当前 Tab 展示。这样保持 theme 配置与 LLM/runtime 配置的既有故障隔离。

### 3. 常规设置使用独立配置领域模块和明确节点

新增常规设置配置模块，管理以下 `~/.echo/config.json` 节点：

```json
{
  "compaction": {
    "thresholdRatio": 0.8
  },
  "ui": {
    "slashSuggestionMaxVisible": 8,
    "showReasoningSummary": true
  }
}
```

默认值分别为 0.8、8 和 true。压缩阈值允许 0.5 至 0.95，并以 0.05 为 UI 调整步长；slash suggestion 上限允许 1 至 20，并以 1 为调整步长。运行时读取对缺失、类型错误、非有限值或越界字段回退默认值；配置中心保存前执行严格校验。

保存使用 `JsonConfigFile.update` 重新读取最新根对象，只更新 `compaction.thresholdRatio`、`ui.slashSuggestionMaxVisible` 和 `ui.showReasoningSummary`，保留 `llm`、`tools`、`mcp`、`hooks` 及未知节点。模型保存也继续在写入前读取最新根对象，因此两个 Tab 先后保存不会用打开面板时的旧 root 覆盖对方。

备选方案是把这些字段放入 `llm` 或 `theme.json`。压缩阈值并非 model profile 字段，slash/reasoning 可见性也不是颜色 theme，混入这些节点会扩大错误影响面，因此使用独立 `compaction` 和 `ui` 根节点。

### 4. 每个配置域独立提交，根状态统一保护未保存草稿

“常规”和“模型与 Provider”各自保留显式保存动作。保存成功后只重置该 Tab 的初始 fingerprint，并在当前面板显示短反馈，不关闭整个配置中心。“外观”选择主题后立即写入 `theme.json` 并更新当前进程 theme，因此不形成未保存主题草稿。

在任意 Tab 的顶层关闭配置中心时，根控制器检查所有已初始化的可保存 Tab；只要常规或模型存在 dirty 草稿，就显示统一放弃确认并列出受影响 Tab。模型的 provider/header/model 子页面 Esc 仍先返回上一级，不触发全局关闭。

不采用跨 `config.json` 与 `theme.json` 的统一 Save，因为两个文件无法提供真实原子事务，失败时可能制造部分提交。分域提交与现有配置所有权一致，也让主题继续即时预览。

### 5. 主题选择复用配置中心外观 Tab，保留独立 theme 文件

外观 Tab 通过现有 theme command port 列举主题、读取当前 base id、保存选择和触发 destructive replay。选择成功后 command session 保持打开、更新选中 marker，并显示保存反馈，便于连续比较主题；Esc 关闭配置中心。保存失败时保留原 theme 和当前进程 theme，并在外观 Tab 内显示错误。

删除 `/themes` handler 和 slash descriptor；主题选择只由 `/config` 的“外观”Tab 承载。

主题 base 和 token override 继续存放在 `~/.echo/theme.json`；选择操作仍只更新根字段 `theme`。不迁移到 `config.json`，避免破坏 theme 错误隔离及已有自定义 override。

### 6. 自动压缩阈值按 assistant run 快照传入压缩核心

agent loop 初始化每次 assistant run 时读取归一化常规设置，并将 `compaction.thresholdRatio` 保存到 run state。每次自动 `runCompaction` 调用显式传入该比例；共享压缩核心不自行读取文件。一次 run 内的 tool continuation 和多次 provider 请求保持同一阈值，下一次 run 才观察配置变化。

`runCompaction` 和阈值判定纯函数接收可选比例，缺省仍使用 0.8，便于现有调用方和单元测试保持兼容。`force: true` 继续跳过阈值判定，所以 `/compact` 行为不变。`--once` 复用同一 agent loop，自动获得相同配置语义。

备选方案是在每次 provider request 前重读文件；这会给热路径增加 I/O，并可能让同一 tool continuation 中途改变压缩策略，因此不采用。

### 7. Slash 上限只参与渲染窗口预算

slash suggestion context 继续返回全部匹配候选和当前完整集合索引。`RenderState` 增加归一化 render preferences，composer surface 将 suggestion 行预算计算为候选数量、`slashSuggestionMaxVisible` 和终端剩余高度三者的最小值，再复用 selected-window 逻辑展示当前选中项附近窗口。

不在匹配阶段 `slice(0, N)`，否则隐藏候选无法通过 Up/Down 到达，Tab 补全结果也会因纯展示设置发生变化。

### 8. Reasoning 开关只过滤可见投影

`showReasoningSummary` 作为 render preference 传给 transcript append、destructive replay 和 final render。关闭时 renderer 跳过 `reasoning_summary` block；agent callback、`TranscriptContext`、session journal 和完整 records 数组仍照常追加该 record。重新开启后 destructive replay 可从持久化 records 恢复历史摘要。

配置保存或外部 watcher 检测到该开关变化时触发 destructive replay；仅 slash 上限变化只需要 footer redraw。reasoning summary 原有的非 provider-facing、非压缩输入语义保持不变。

不在 `onReasoningSummary` callback 处丢弃记录，因为那会让显示偏好改变事实持久化，并使重新开启后无法恢复历史内容。

### 9. 使用实例级设置缓存和带影响分类的刷新

AppContext 增加实例级常规设置缓存，普通 render 热路径只读取内存。启动时读取一次，`config.json` watcher 和常规 Tab 保存成功后刷新缓存。刷新结果区分：

- reasoning 可见性变化：destructive replay；
- slash suggestion 上限变化：footer redraw；
- 只有压缩阈值变化：无需立即重绘，下一 assistant run 生效；
- model 配置变化：继续刷新 ModelContext 和 context usage。

watcher 继续按目录事件防抖，并由组合根统一执行所需的最强重绘，避免同一次原子 rename 触发重复绘制。

## Risks / Trade-offs

- [配置中心状态比现有单面板更复杂] → 根控制器只负责 Tab、dirty 聚合和 effect 分发，各子控制器继续保持纯状态转移。
- [切换 Tab 时文本编辑状态被隐藏] → 完整保留 edit target 和 buffer，返回原 Tab 后继续编辑；Tab strip 和提示明确 Tab 是配置中心导航。
- [主题 destructive replay 与 command session 更新顺序产生旧 marker] → 先更新 session 中的选中状态，再应用 theme/replay，随后统一 footer render。
- [隐藏 reasoning 后 append 空 block 仍触发 footer 清理] → renderer 允许空 block 集合并只执行必要 footer 重绘，不改变 transcript 追加。
- [较低压缩阈值增加摘要请求次数] → 限制最小值 50%，UI 展示百分比，并保留 80% 默认值。
- [外部配置编辑与面板草稿并发] → 保存时重读最新 root 且仅更新本 Tab 所有字段；同一字段的外部并发修改遵循最后一次显式保存胜出。
- [窄终端 Tab 和内容争夺高度] → Tab strip 使用单行紧凑标签，所有内容继续使用现有窗口化和 safe render width 约束。

## Migration Plan

无需迁移已有文件。缺失 `compaction` 或 `ui` 节点时使用当前兼容默认值；首次保存常规设置时创建对应节点。已有 `llm`、`tools`、`mcp`、`hooks` 和未知节点保持不变，已有 `theme.json` base 与 token override 原样保留。

发布后 `/config` 默认入口改变为“常规”Tab，但“模型与 Provider”Tab提供全部原能力，“外观”Tab 提供主题选择。回滚时新增配置节点会被旧版本忽略，theme 和 LLM 配置仍可继续读取。

## Open Questions

无。

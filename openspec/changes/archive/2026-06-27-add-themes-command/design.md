## Context

当前主题系统已经统一覆盖 footer、transcript block、Markdown、syntax highlight 和 tool chrome。`src/config/theme-config.ts` 负责读取 `~/.echo/theme.json` 并归一化为完整 `TuiTheme`，`AppContext` 在启动时持有一次读取结果，后续渲染通过 `RenderState.theme` 传递。

缺口是用户无法在运行中切换内置 theme。已有 `default`、`amber`、`violet` 内置 theme 和 `listBuiltinThemes()` / `readBuiltinTheme()` API，但用户级 `theme.json` 目前只表达 token override，尚未表达“以哪个内置 theme 为 base”。`/themes` 需要把 base 切换写入配置，同时保留用户已有 override。

## Goals / Non-Goals

**Goals:**

- 提供纯 `/themes` 命令，打开内置 theme 选择 surface。
- `theme.json` 使用根字段 `theme` 表达内置 base id；缺失时等价于 `default`。
- 切换只 patch 根字段 `theme`，保留 `footer`、`blocks`、`markdown`、`syntax` 等用户自定义 override。
- 切换后当前进程立即使用新的归一化 `TuiTheme`，并执行完整重绘。
- 保持 command runtime 的受控 facade 模型，不让 handler 直接读取 `AppContext`、renderer 或 terminal。

**Non-Goals:**

- 不新增在线下载、导入、编辑或校验自定义 theme 的 UI。
- 不引入旧配置兼容层、`schemaVersion` 或 legacy 字段迁移。
- 不把 `apply_patch` added/removed 固定事实语义色改成可配置项。
- 不持久化运行时 theme 到 transcript 或 session record。

## Decisions

### 1. `theme` 根字段作为内置 base id

`readTuiTheme()` 读取用户配置后先解析 `raw.theme`。当该字段是有效且存在的内置 theme id 时，以 `readBuiltinTheme(raw.theme)` 作为 base；缺失时使用代码内 `DEFAULT_TUI_THEME`；无效或不可读取时回退到 default base。随后将同一个 raw config 里的 `footer`、`blocks`、`markdown`、`syntax` 作为 override 合并到 base。

这样可以让现有自定义 theme 文件自然变成“default base + overrides”，而用户从 `/themes` surface 选择 `amber` 后变成“amber base + 同一批 overrides”。如果 override 覆盖了大部分 token，切换后的可见差异变小，这是保留自定义配置的直接结果。

备选方案是 `/themes` 写入完整 theme JSON。这个方案会覆盖用户自定义 override，且导致内置 theme 后续调整无法自然生效，因此不采用。

### 2. 配置模块提供 patch 保存 API

在 `theme-config.ts` 中新增保存辅助函数，例如 `selectBuiltinTheme(themeId)` 或等价 API。该函数负责：

- 验证 theme id 是否可读取为内置 theme。
- 读取现有 `~/.echo/theme.json`；文件缺失时以空对象开始。
- 现有文件是 JSON object 时只更新根字段 `theme`。
- 现有文件不是有效 JSON object 时返回失败，避免无声覆盖不可恢复的用户内容。
- 使用临时文件加 rename 原子写入。

命令 handler 不直接写文件，避免把配置格式、容错和原子写入细节散落到 command 层。

### 3. CommandHost 暴露 theme 领域能力

新增 `CommandHost.theme` 受控能力，至少包含：

- `listThemes()`：返回可展示的内置 theme metadata，并标记当前选中的 base id。
- `selectTheme(themeId)`：保存根字段 `theme`，重新读取归一化 theme，更新 app runtime theme，并触发 destructive resize recovery。

`ThemesCommandHandler` 只使用该 facade。`CommandRuntime` 不新增业务 effect 分支，`main.ts` 不直接处理 `/themes` 的业务保存逻辑。

### 4. AppContext 提供运行时 theme 替换

`AppContext.setTheme(theme)` 同步更新 `appContext.theme` 和 `renderContext.theme`。切换成功后由 host 调用 `renderResizeRecovery()`，保证 banner、transcript projection、pending preview、footer 和 command surface 全部按新 theme 重新投影。该更新不追加 transcript record，不清空 session，也不改变 provider context usage。

### 5. `/themes` 只匹配纯命令并使用已有 select/info surface

`/themes` 精确匹配时打开 select surface，列出内置 theme label、id 和 description，并把当前 base 作为选中项。Up/Down 移动，Enter 确认，Esc 取消。`/themes default`、`/themes amber`、`/themes violet` 或其他带参数输入不由该 handler 匹配，继续按普通用户消息提交给大模型。列表为空或保存失败时打开 info surface，展示中文错误摘要。

备选方案是新增专用 theme surface。当前需求只是单选列表，现有 select/info surface 已满足交互和视觉语言要求，不需要新增 surface 类型。

## Risks / Trade-offs

- [Risk] 用户 override 覆盖大量 token 后，切换内置 base 的可见变化可能很小。→ 在 `/themes` 描述和文档中明确这是“base + overrides”语义，不覆盖自定义配置。
- [Risk] 现有 `theme.json` 语法损坏时无法安全保留 override。→ 保存 API 返回失败并展示可理解错误，不静默覆盖损坏文件。
- [Risk] 内置 theme 文件损坏可能影响列表或切换。→ `default` 由代码常量兜底；坏的非 default theme 从列表跳过，选择时返回失败。
- [Risk] 运行时切换 theme 需要刷新所有可见区域。→ 使用现有 destructive resize recovery 路径完整重绘，避免局部 footer redraw 留下旧颜色。

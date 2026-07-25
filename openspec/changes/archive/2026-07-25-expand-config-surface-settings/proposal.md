## Why

当前 `/config` 只管理 LLM provider 和 model，自动压缩阈值、slash suggestion 可见数量、reasoning summary 展示和主题选择则分别硬编码或散落在其他入口中。将这些用户级选项收敛到带 Tab 的配置中心，可以提升可发现性，同时保持各配置域现有的持久化和运行时边界。

## What Changes

- 将 `/config` 扩展为包含“常规”“模型与 Provider”“外观”的 Tab 配置中心，并在切换 Tab 时保留各自的选择位置和未保存草稿。
- 在“常规”Tab 增加自动压缩阈值、slash suggestion 最大同时可见条目数和 reasoning summary 显示开关；保存时只更新 `~/.echo/config.json` 中对应配置节点并保留其他节点。
- 让自动压缩在每次 assistant run 初始化时读取用户阈值，非法或缺失值回退当前 80% 默认值；手动 `/compact` 继续绕过阈值。
- 让 slash suggestion 的渲染窗口同时受用户上限和终端高度预算约束，但候选匹配、方向键浏览和 Tab 补全仍覆盖完整候选集合。
- 将 reasoning summary 开关限定为显示策略：关闭时隐藏已保存及新增的 `reasoning_summary`，但不删除 transcript/session 事实，也不改变 provider 请求或上下文压缩语义。
- 将内置主题选择整合到“外观”Tab；继续使用独立 `~/.echo/theme.json` 保存 base theme 并保留 token override。
- 删除独立 `/themes` 入口，主题选择只通过 `/config` 的“外观”Tab 承载，避免维护第二套主题选择 surface。
- “常规”和“模型与 Provider”分别显式保存；主题选择成功后立即持久化并重绘。关闭配置中心时统一保护所有未保存草稿。

## Capabilities

### New Capabilities

- `config-surface-settings`: 定义带 Tab 的配置中心、常规 UI/运行时设置、分域保存、未保存草稿保护及 reasoning summary 显示策略。

### Modified Capabilities

- `interactive-llm-config-command`: `/config` 从单一 provider/model 面板扩展为配置中心，现有 LLM 编辑器成为“模型与 Provider”Tab，并参与跨 Tab 草稿保护。
- `context-compression`: 自动压缩阈值从固定安全比例改为具有默认值和有效范围的用户级配置，并在单次 assistant run 内保持快照。
- `theme-selection-command`: 内置主题选择并入配置中心“外观”Tab，取消独立 `/themes` slash command。

## Impact

- 影响 `/config` command handler、command session data、config surface 类型和 footer renderer，需要把现有模型面板状态收敛为配置中心的一个子状态。
- 新增用户级常规设置的读取、校验和原子更新逻辑，并扩展 app 配置缓存及 `config.json` watcher 的刷新范围。
- 影响 agent loop 的自动压缩参数传递、slash suggestion 渲染预算和 transcript append/destructive/final render 的可见性过滤。
- 影响默认 slash command handler 列表与 command host 的主题入口，但不迁移 `theme.json`，不改变主题 token override 格式。
- 需要补充配置状态机、持久化、压缩阈值、slash suggestion 窗口、reasoning summary 显隐、主题入口和终端布局测试。
- 不新增第三方依赖，不改变 transcript/session 文件格式，不删除 `/model` 或 `/effort` 命令。

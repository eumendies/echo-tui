## Why

当前 footer 交互列表一旦启用鼠标 hover 或点击，终端的 SGR 鼠标报告会接管滚轮事件，部分终端、tmux 或滚动配置下无法再使用原生 scrollback。鼠标交互是便利能力，不应强制替代用户既有的终端滚动体验；用户需要能明确选择是否启用 UI 鼠标交互。

## What Changes

- 在用户配置的 `ui` 节点新增 boolean `mouseInteractionEnabled`，在产品和 `/config` 中统一命名为“UI 鼠标交互”，不使用 footer 专属命名。
- 在 `/config` 的“常规”Tab 展示、编辑并显式保存“UI 鼠标交互”开关。
- **BREAKING**：缺失、非法或无法读取该可选配置时默认关闭 UI 鼠标交互；支持鼠标的 surface 仍完整保留，但仅在用户开启后才启用终端鼠标报告、生成可执行 hit region 或响应 hover/点击。
- 配置中心保存和 `config.json` watcher 更新该设置后，在当前 TUI 实例立即启用或停用鼠标报告；停用时清理当前鼠标 frame/CPR 状态并恢复终端的常规鼠标行为。
- 不尝试截获或模拟终端 scrollback；headless 与非 TTY 路径继续不启用鼠标报告。

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `config-surface-settings`: 常规设置增加“UI 鼠标交互”的字段归一化、配置中心编辑保存与运行时刷新行为。
- `terminal-mouse-list-interaction`: 鼠标报告、命中区域与 pointer 路由改为受用户设置明确门控，默认保持原生终端滚动体验。

## Impact

- 配置：`src/config/app-settings-config.ts`、用户配置 snapshot 与 `~/.echo/config.json` 的 `ui.mouseInteractionEnabled`。
- 配置界面：`src/commands/config/` 的常规设置草稿、行投影、调整和保存反馈。
- TUI 运行时：`src/app/main.ts`、`AppContext`、`FooterPointerController`、footer render state/hit region 投影与配置 watcher。
- 测试和文档：配置归一化、`/config` 保存、运行时热切换、鼠标报告/CPR 清理、非 TTY 与 headless 边界。

## Why

当前 TUI 已支持统一 render theme，但用户只能手动编辑 `~/.echo/theme.json`，无法在运行中的 TUI 内快速切换内置主题。需要提供 `/themes` 命令，让用户在默认内置主题之间切换，同时保留现有自定义 token override。

## What Changes

- 新增 `/themes` slash command，用于展示并切换内置 render theme。
- `/themes` 使用现有 command runtime 和 select surface；打开、切换、取消都不写入 transcript，也不启动 agent turn。
- 成功切换时只更新 `~/.echo/theme.json` 根字段 `theme`，不覆盖用户已有 `footer`、`blocks`、`markdown`、`syntax` 自定义 override。
- `readTuiTheme()` 支持以 `theme` 根字段选择内置 base，再把同一文件中的自定义 token override 合并到该 base 上。
- 切换成功后当前进程立即应用新的归一化 render theme，并触发完整重绘。

## Capabilities

### New Capabilities
- `theme-selection-command`: 定义纯 `/themes` 命令的用户可见行为、选择 surface、取消和错误处理。

### Modified Capabilities
- `footer-theme-config`: 定义 `theme.json` 根字段 `theme` 作为内置 base id，并要求切换内置 theme 时保留用户自定义 override。

## Impact

- 影响 `src/config/theme-config.ts` 的 theme 读取、内置 theme metadata 列表和 `theme.json` patch 保存逻辑。
- 影响 `src/app/state/app-context.ts`、`src/app/state/render-context.ts` 和 command host 装配，以支持运行时更新当前 render theme。
- 新增 `src/commands/themes-command-handler.ts` 并在默认 slash command handlers 中注册 `/themes`。
- 需要补充配置合并、命令 handler、host facade 和运行时重绘相关测试。

## 1. InteractionMode 四态化

- [x] 1.1 将 `InteractionMode` 扩展为 `normal`、`plan`、`shell`、`shell-local` 四态。
- [x] 1.2 移除独立 `ShellContextPolicy` 状态，改由 `InteractionMode` 表达 shell 上下文行为。
- [x] 1.3 保持 Tab 循环切换 normal → plan → shell → shell-local → normal 的现有行为不变。
- [x] 1.4 更新 shell mode 判断点，使 `shell` 和 `shell-local` 都进入 shell 命令执行路径。
- [x] 1.5 更新 CommandHost mode facade，使 command handler 通过四态 `InteractionMode` getter/setter 操作模式。

## 2. /mode 命令实现

- [x] 2.1 新增 `ModeCommandHandler`，匹配 `/mode` 及 `/mode <mode>`，并拒绝无关前缀例如 `/model`。
- [x] 2.2 实现 `/mode` 无参数选择 surface，展示四种模式、说明、当前选中项和键盘提示。
- [x] 2.3 实现 Up/Down/Enter/Esc 事件处理，支持选择、确认和关闭 surface。
- [x] 2.4 实现 `/mode normal`、`/mode plan`、`/mode shell`、`/mode shell-local` 直接切换。
- [x] 2.5 实现非法参数 usage surface，展示支持的 `/mode` 用法。

## 3. 删除 /plan 入口

- [x] 3.1 从默认 slash command handlers 中移除 `PlanCommandHandler`，注册 `ModeCommandHandler`。
- [x] 3.2 删除或停止导出 `/plan` handler 相关代码，确保 slash suggestions 不再包含 `/plan`。
- [x] 3.3 更新 plan mode system prompt，将退出指引从 `/plan off` 改为 `/mode normal`。

## 4. 测试覆盖

- [x] 4.1 更新 slash command 单元测试，覆盖 `/mode` 匹配、直接切换、选择 surface、非法参数和 `/plan` 不再命中。
- [x] 4.2 更新 app 流程测试，覆盖 `/mode plan` 传递 plan mode 给 agent、`/mode normal` 退出 plan、`/mode shell` 和 `/mode shell-local` 的 shell 行为。
- [x] 4.3 更新 slash suggestions、help/prompt、footer/status line 相关测试中对 `/plan` 的旧预期。
- [x] 4.4 补充 AppContext 四态 `InteractionMode` 测试，验证 Tab 循环、shell-local 本地上下文和状态栏输入主题。

## 5. 验证

- [x] 5.1 运行 `npm run typecheck`。
- [x] 5.2 运行相关 targeted tests：commands、app、render、agent/system prompt 相关测试。
- [x] 5.3 运行 `npm test`。
- [x] 5.4 运行 `find bin src test -name '*.js' -exec node --check {} \;`。

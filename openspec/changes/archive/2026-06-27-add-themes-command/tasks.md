## 1. Theme 配置能力

- [x] 1.1 扩展 `src/config/theme-config.ts`，让 `readTuiTheme()` 支持根字段 `theme` 选择内置 base，并将同文件 token override 合并到该 base。
- [x] 1.2 调整内置 theme metadata 列表，确保 `/themes` 可列出 `default`，且坏的非 default theme 不阻断启动或列表展示。
- [x] 1.3 新增保存辅助 API，只 patch `~/.echo/theme.json` 根字段 `theme`，保留已有 override，并使用临时文件加 rename 原子写入。
- [x] 1.4 为 base 解析、无效 base 回退、override 保留、default 不读取内置 JSON 和保存失败路径补充 `test/config/theme-config.test.js` 覆盖。

## 2. 运行时 Theme 更新

- [x] 2.1 在 `AppContext` 增加 `setTheme(theme)`，同步更新 `appContext.theme` 与 `renderContext.theme`。
- [x] 2.2 在 `CommandHost` 增加受控 `theme` 领域能力，提供 theme 列表、当前 base id 和选择保存能力。
- [x] 2.3 切换成功后重新读取归一化 theme、更新当前进程 theme，并触发 `renderResizeRecovery()` 完整重绘。
- [x] 2.4 补充 app/host 相关测试，验证运行时 theme 更新进入后续 `createRenderState()`，且切换失败不改变当前 theme。

## 3. `/themes` Command

- [x] 3.1 新增 `ThemesCommandHandler`，支持 `/themes` 打开 select surface、Up/Down 移动、Enter 确认和 Esc 取消。
- [x] 3.2 将 handler 匹配范围限制为精确 `/themes`，确保 `/themes <任意参数>` 不命中本地命令并继续按普通用户消息提交。
- [x] 3.3 在默认 slash command handlers 中注册 `/themes`，确保 slash suggestion 展示中文说明，并保持 direct skill fallback 顺序不被破坏。
- [x] 3.4 补充 command handler 和 resolver 测试，覆盖纯 `/themes`、带参数不命中、列表为空、保存失败和取消流程。

## 4. 文档与验证

- [x] 4.1 更新 `docs/README.md` 和 `docs/tui-architecture.md`，说明 `theme.json` 的 `theme` base 字段、override 合并语义和 `/themes` 用法。
- [x] 4.2 运行 `npm run typecheck`。
- [x] 4.3 运行 `npm test`。
- [x] 4.4 运行 `find bin src test -name '*.js' -exec node --check {} \\;`。
- [x] 4.5 手动验证 `/themes` 选择、带参数输入进入普通消息路径、Esc 取消、自定义 override 保留和切换后完整重绘。

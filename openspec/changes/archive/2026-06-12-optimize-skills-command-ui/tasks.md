## 1. Command 行为

- [x] 1.1 收紧 `SkillsCommandHandler.match()`，只匹配 trim 后精确等于 `/skills` 的输入。
- [x] 1.2 删除 `/skills list`、`/skills manage` 和未知子命令 usage surface 的分支。
- [x] 1.3 让 `/skills` 直接创建 skills 管理 session，保留草稿状态、Up/Down 移动、Space 切换、Enter 保存、Esc 取消语义。
- [x] 1.4 处理无 discovered skills 的空状态，展示项目级和用户级 skill 目录提示且不触发 agent。

## 2. Skills Surface 与渲染

- [x] 2.1 在 command surface 类型中新增专用 `skills` surface，包含 skills、selectedIndex、title 和 dismissHint 所需字段。
- [x] 2.2 新增 footer skills surface renderer，仿 demo 渲染 cyan card、enabled 计数、on/off pill、当前行 accent、高亮背景和底部快捷键提示。
- [x] 2.3 实现 skills surface 的安全宽度截断、显示宽度补齐和超过可见行数时的窗口/剩余数量提示。
- [x] 2.4 接入 `renderCommandSurface()` 的 `kind: 'skills'` 分发，并确保 command surface 活跃时隐藏可编辑光标。
- [x] 2.5 明确不渲染搜索框，也不暴露 `/`、`a`、`n`、`j/k`、home/end 相关提示。

## 3. Skill 状态与提示

- [x] 3.1 保持 skill 状态保存仍通过 `host.skills.saveSkillStates()` 和 `skillManager.saveSkillStates()` 完成。
- [x] 3.2 将 disabled skill 的用户提示从 `/skills manage` 更新为 `/skills`。
- [x] 3.3 确认保存后 enabled catalog、slash suggestion、direct skill invocation 和 provider skill catalog 使用最新状态。

## 4. 文档与测试

- [x] 4.1 更新 `docs/README.md`、`docs/tui-architecture.md` 中 `/skills list`、`/skills manage` 的描述和手动验证清单。
- [x] 4.2 更新 command handler 测试，覆盖纯 `/skills` 打开新 surface、旧子命令不命中、Space/Enter/Esc 行为。
- [x] 4.3 更新 footer renderer 测试，覆盖 skills card、enabled 计数、on/off pill、选中态、滚动提示和无搜索框。
- [x] 4.4 更新 app integration 测试，覆盖 `/skills` 不写 transcript、不触发 agent、保存后 slash suggestion 立即刷新。
- [x] 4.5 更新 tool/agent 相关测试中 disabled skill 提示和 provider catalog 状态刷新入口。

## 5. 验证

- [x] 5.1 运行 `npm run typecheck`。
- [x] 5.2 运行 `npm test`。
- [x] 5.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 5.4 手动验证 `/skills` 打开新 UI、移动、切换、保存、取消、空状态和 disabled skill 重新启用流程。

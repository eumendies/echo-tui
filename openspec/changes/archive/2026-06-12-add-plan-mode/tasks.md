## 1. App 状态和命令

- [x] 1.1 新增 interaction mode 状态，支持 `normal` 和 `plan`，并保持为当前进程内状态。
- [x] 1.2 扩展 `CommandHost`，向 slash handler 暴露读取和设置 interaction mode 的受控能力。
- [x] 1.3 新增 `PlanCommandHandler`，支持 `/plan` toggle、`/plan on`、`/plan off` 和非法子命令用法提示。
- [x] 1.4 将 `/plan` 加入默认 slash handler 和 slash suggestions，确保命中本地命令时不进入 transcript、输入历史或 agent lifecycle。

## 2. Status Line

- [x] 2.1 扩展 render/status line 类型，使普通输入态可以显示 `plan` mode。
- [x] 2.2 在 plan mode 且无 pending、slash suggestion 或 command surface 时显示 `plan`。
- [x] 2.3 保持 thinking、streaming 和 tool pending 对 status line mode 的优先级，避免响应中丢失 transient 状态。
- [x] 2.4 确认 status line 不显示 `/plan off` 退出提示。

## 3. Agent Plan Mode 边界

- [x] 3.1 扩展 `AgentSessionInput`，让 app 在调用 agent 时传入当前 interaction mode。
- [x] 3.2 在 provider input 中注入 plan-mode system prompt，说明只读规划语义和 `/plan off` 退出方式。
- [x] 3.3 新增只读 tool registry 或 registry 过滤能力，只暴露 `glob`、`grep`、`read_files`、`web_fetch`、`web_search` 和 `use_skill`。
- [x] 3.4 在 plan mode agent run 中使用只读工具集合，normal mode 继续使用完整默认工具集合。
- [x] 3.5 确保 plan mode 下未知或未暴露写入 tool call 不会执行文件修改、命令执行或配置写入。

## 4. 测试

- [x] 4.1 添加 `/plan` command handler 单元测试，覆盖 toggle、on、off、非法子命令和 Esc/关闭行为。
- [x] 4.2 添加 app 集成测试，覆盖 `/plan` 不写 transcript、不启动 agent、不进入输入历史，并更新 status line。
- [x] 4.3 添加 status line 测试，覆盖 plan mode、pending 优先级和不显示 `/plan off`。
- [x] 4.4 添加 agent runtime 或 OpenAI adapter 测试，覆盖 plan-mode system prompt 注入和只读工具定义。
- [x] 4.5 添加 tool registry 测试，覆盖 plan allowlist 与 normal mode 完整工具集合。

## 5. 文档和规格

- [x] 5.1 更新 `docs/README.md`，说明 `/plan`、`/plan on`、`/plan off`、只读工具和退出方式。
- [x] 5.2 更新 `docs/tui-architecture.md`，说明 interaction mode、status line 和 agent/tool registry 边界。
- [x] 5.3 确认 OpenSpec delta 与实现保持一致。

## 6. 验证

- [x] 6.1 运行 `npm run typecheck`。
- [x] 6.2 运行 `npm test`。
- [x] 6.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 6.4 手动验证 `/plan`：进入、退出、status line 显示 plan、plan mode 下只读探索、要求执行时模型提示 `/plan off`。

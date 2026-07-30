# Agent Memory Skill 手动验证

以下交互验证由用户在真实 TUI 中执行：

1. 启动 TUI，确认普通请求的工具列表不再包含 `read_memory`、`add_memory`、`update_memory`、`remove_memory`。
2. 明确要求“记住”一个项目级稳定事实，确认模型先加载 `agent-memory` skill，再通过 bash rail 执行包内 `scripts/memory.js`，且不出现专属审批 surface。
3. 依次验证脚本 `read`、`add`、`update-item`、`update-catalog`、`remove-item`、`remove-catalog` 和 `validate`；确认失败参数返回非零状态且不会改写 JSON。
4. 使用 `/memory` 查看脚本新增的 catalog/item，执行编辑、Space 启停和删除；再确认脚本能读取 `/memory` 创建或编辑的数据。
5. 分别创建 project 与 global catalog，确认当前项目覆盖同名 global，停用 project 后读取回退到 global。
6. 使用 `/skills` 停用并重新启用 built-in `agent-memory`，确认状态写入用户级 skill state，npm 安装目录不产生 `skills.json`。
7. 在 plan mode 请求读取或修改 memory，确认 Node 脚本按现有 bash allowlist 被拒绝；切回 normal 后可执行。
8. 使用 `echo-tui --once` 请求记录稳定 memory，确认无需 `--full-access` 即可执行未命中通用高风险规则的脚本。

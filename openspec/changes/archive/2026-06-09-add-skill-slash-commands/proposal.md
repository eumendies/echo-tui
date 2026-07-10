## Why

当前 skill 系统已经支持 catalog 常驻 system prompt 和模型通过 `use_skill` 按需加载，但用户还不能用 slash 显式调用某个 skill，也不能在 TUI 内查看和管理 skill 启用状态。需要补齐用户主动调用 skill 的路径，并让禁用状态统一影响 catalog、tool、slash suggestion 和 slash invocation。

## What Changes

- 新增 `/skills list` 与 `/skills manage`：`list` 只读展示 discovered skills，`manage` 打开可勾选列表，使用 Space 切换启用状态、Enter 保存、Esc 放弃。
- 新增 direct slash skill invocation：用户输入 `/<skill-name> [arguments...]` 时，系统读取对应 skill 内容并以 `user` message 形式注入 transcript，然后沿用普通用户提交路径触发 agent。
- 新增 skill 启用状态持久化：在项目级或用户级 skill 存储目录内使用 JSON 文件保存 disabled skill 名称；默认 discovered skills 为 enabled。
- 统一 disabled 语义：disabled skill 不进入 provider skill catalog、不能被 `use_skill` 成功加载、不能通过 direct slash invocation 执行，也不会出现在 slash suggestion 中；但仍会在 `/skills list` 和 `/skills manage` 中显示以便重新启用。
- 新增 checkbox command surface，用于 `/skills manage` 的多项启用状态编辑。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `skill-system`: 增加 skill 启用状态、slash 调用 skill、`/skills list/manage` 和使用记录语义。
- `command-host-runtime`: 增加 slash handler 可返回“转换为 user message 后继续提交”的运行时语义，以及 checkbox command surface 的事件承载。
- `terminal-tui-prototype`: 增加 checkbox command surface 的终端渲染与键盘交互要求。
- `local-tool-execution`: `use_skill` 需要尊重 disabled 状态并返回明确失败。
- `streaming-llm-service-adapter`: provider skill catalog 只包含 enabled skills，slash 注入的 skill user message 参与普通 provider 输入。

## Impact

- 影响 skill registry/manager、`use_skill` tool handler、agent loop registry 创建路径、slash command runtime、slash suggestion、command host、footer surface rendering、transcript record metadata 和相关测试。
- 新增本地 JSON 状态文件：`.echo/skills/skills.json` 与 `~/.echo/skills/skills.json`。
- 不引入 YAML parser 或第三方依赖，不新增 `/skill` 单数命令。

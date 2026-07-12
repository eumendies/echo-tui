## Why

Echo TUI 当前只能通过当次会话记录、AGENTS.md 和 skills 保存上下文；用户无法在会话之间维护自己的长期偏好或事实。第一版需要提供由用户显式维护、每次真实模型请求都会携带的全局 memory，让用户可以在 TUI 中安全地管理持久上下文。

## What Changes

- 新增用户级 JSON memory 存储，支持读取、校验和原子写入用户显式创建的 memory 条目。
- 在每次真实 provider 请求中以不写入 transcript 的 transient context 注入全部 memory，并保持其低于内置 system 指令与当前用户请求的优先级。
- 新增 `/memory` 本地命令及专用交互 surface，支持浏览、新增、编辑和确认删除 memory；编辑支持多行内容。
- 在 `/context` 的分类 breakdown 中将 memory 从普通 system prompt 中拆分展示。

## Capabilities

### New Capabilities
- `user-memory`: 用户级显式 memory 的 JSON 存储、provider 上下文注入和 `/memory` 管理体验。

### Modified Capabilities
- `command-host-runtime`: 为 memory 命令提供受控的读取与持久化 facade，并注册默认 slash command。
- `context-usage-command`: 在 provider context usage 估算和详情 surface 中单独展示 memory 占用。

## Impact

- 新增 memory 领域模块、`/memory` handler 和 footer renderer，并扩展 command/surface/agent 类型。
- 修改 agent loop 与 system prompt 的 transient provider context 组装，以及 context usage 分类与 `/context` renderer。
- 用户目录新增 `~/.echo/memories.json`；不改变现有 transcript、session 或 LLM 配置格式。
- 需要新增覆盖 JSON 读写、上下文注入、命令交互状态机和 usage 分类的 Node 内置测试。

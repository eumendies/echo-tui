## Why

当前缺少一个集中展示运行环境与 Codex 订阅配额的 `/status` 入口，用户需要离开 TUI 或依赖外部工具才能判断当前会话配置及 5 小时、每周用量。新增该命令可以在不重复 `/context` 上下文占用信息的前提下，快速提供运行状态和 Codex 配额进度。

## What Changes

- 新增只读 `/status` slash command，展示当前目录、生效的 AGENTS.md、有效 memory、当前 model/provider 和 session id。
- `/status` 不展示 context token 占用，相关详情继续由现有 `/context` 命令负责。
- 新增基于现有 Codex OAuth 凭据解析与刷新能力的远端用量查询，读取 5 小时和每周限额窗口的利用率与重置时间。
- 新增 status footer surface，以终端安全的进度条展示 Codex 用量；非 Codex provider 隐藏该区域，Codex 无凭据、网络错误或响应不兼容时显示明确的不可用状态。
- `/status` 保持本地命令语义，不提交 agent 请求、不追加 transcript record，也不把凭据或远端响应中的敏感信息写入 transcript。

## Capabilities

### New Capabilities
- `status-command`: 定义 `/status` 的运行状态聚合、Codex OAuth 用量查询、进度条 surface、关闭交互和失败降级行为。

### Modified Capabilities

无。

## Impact

- 影响 slash command 注册、command host facade、命令类型和 command runtime surface。
- 影响 Codex OAuth 配置模块，新增只读 usage endpoint 请求与响应归一化，但复用现有 token 刷新和账号 header 逻辑。
- 影响 footer 渲染与主题颜色使用，新增 status 专用进度条布局。
- 需要为 OAuth usage 解析、命令行为、错误降级和窄终端渲染补充测试；不新增第三方依赖，不改变 `/context` 或 `/usage` 的现有行为。

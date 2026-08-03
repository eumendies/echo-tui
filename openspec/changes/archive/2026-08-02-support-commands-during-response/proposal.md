## Why

当前 active assistant turn 期间会隐藏全部 slash suggestions，并把所有 Enter 提交统一放入 pending message 单槽，导致用户无法发现或立即打开 `/help`、`/status` 以及未来的 `/btw` 等可安全并行使用的命令。需要先建立响应期命令能力，使部分命令能在不中断流式输出的前提下被发现、启动和交互。

## What Changes

- 为 slash command handler/descriptor 增加显式的“允许在 active assistant turn 期间启动”能力，默认保持不允许。
- active assistant turn 期间继续展示 slash suggestions，但只列出明确允许的命令；skill invocation 和其他命令仍保持原有延后处理语义。
- 提交层在把普通输入加入 pending message 前，优先立即执行命中的响应期命令，并允许该命令打开、更新和关闭 command surface。
- command surface 交互期间 assistant thinking、streaming、tool continuation 和 transcript 提交继续运行；surface 关闭后恢复当前最新 footer 状态。
- 保持 command session 单实例约束，防止自动处理 queued command 或其他入口静默覆盖已打开的 command surface。
- 首批仅开放只读且不改变当前 turn/session 语义的命令，并为后续 `/btw` 提供同一声明式接入点。

## Capabilities

### New Capabilities
- `response-time-commands`: 定义 active assistant turn 期间 slash command 的可用性声明、suggestion 过滤、立即路由、surface 交互和渲染稳定性。

### Modified Capabilities
- `pending-message`: active assistant turn 期间提交的输入不再无条件进入 pending 单槽；明确允许响应期启动的 slash command 将优先立即执行，其余输入继续保持既有排队和正常路由语义。

## Impact

- 影响 slash command handler/descriptor 类型、默认命令注册元数据和 command runtime 的启动约束。
- 影响 `SlashSuggestionContext`、`AppContext` 的 suggestion 投影以及 `main.ts` 的 composer 提交顺序。
- 影响 footer 在 streaming pending 与 command surface 并存时的局部重绘验证，但不改变 transcript 持久化格式、provider 协议或 agent loop。
- 需要更新 command runtime、app context、footer renderer 和 pending message 的自动化测试；不引入第三方依赖。

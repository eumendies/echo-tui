## Why

当前 TUI 允许用户在 assistant 输出期间继续编辑 composer，但 response lock 会拒绝 Enter 提交，用户必须等待当前回答结束后再次手动发送。增加单条 pending 消息可以保留用户当下的后续意图，同时必须继续满足 footer 高度有界和 scrollback 可清理的不变量。

## What Changes

- assistant turn 活跃期间，允许用户将当前非空 composer 草稿排入一个单槽待发送队列。
- 待发送消息作为独立 transient 状态显示在 composer 上方；它不会提前写入 transcript 或进入当前 provider request。
- 当前 assistant turn 结束后，系统自动通过正常用户消息提交流程发送该消息，并保持用户后来输入的新 composer 草稿不变。
- 已有待发送消息时拒绝覆盖第二条消息；用户可先移除已有消息后重新排队。
- 待发送卡片使用固定、有界的单行预览，并纳入 footer 的统一 `rows - 2` 高度预算；它不得在 footer layout 之外额外追加。
- 明确待发送消息与 Esc 中断、会话切换、清空 transcript、退出和迟到 turn 回调的交互语义。

## Capabilities

### New Capabilities
- `pending-message`: 定义 assistant 响应期间单条用户消息排队、自动发送、composer 草稿隔离、瞬时生命周期和有界卡片展示行为。

### Modified Capabilities
- `response-interruption`: 明确存在待发送消息时 Esc 的输入优先级，以及移除待发送消息后再次 Esc 才中断 active assistant turn。
- `terminal-tui-prototype`: 将待发送消息卡片纳入 footer 高度预算、普通局部重绘和 destructive resize recovery 的完整快照。
- `command-host-runtime`: composer 消费统一移到提交层，command handler 不再持有或重复调用 composer reset。

## Impact

- 影响 `src/app/main.ts` 的提交路由、active turn 收尾和输入事件优先级。
- 增加 app-level transient pending-message state，并调整 composer/turn 的提交副作用边界，避免自动发送时清除后续草稿。
- 移除 command host 的 composer reset 端口和 handler 中的重复 reset，由 `submitComposer()` 对每次被接受的输入统一记录历史并清空 composer。
- 扩展 `RenderState`、composer surface 和 footer layout，但不改变 transcript journal schema、provider 协议或 `--once` 路径。
- 不新增第三方依赖，不切换 alternate screen；现有 ANSI footer-only redraw 和 destructive recovery 架构保持不变。

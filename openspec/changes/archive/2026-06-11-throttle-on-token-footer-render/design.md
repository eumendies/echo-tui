## Context

当前 app 编排层在 agent `onToken` callback 中每次收到 token 都会更新 streaming pending draft，并立即调用 `renderFooter()`。footer renderer 的一次重绘会清理旧 footer，再重写 pending preview、working 行、divider、composer/status line 或 surface。模型服务在短时间内输出大量 token 时，这条路径会造成高频 clear/write，部分终端中表现为闪烁。

项目已有 `TurnContext` 管理 assistant turn 生命周期、pending preview、spinner timer、active turn 和 abort signal。`main.ts` 负责 agent callbacks 与渲染编排，但不适合继续堆放 token render 节流相关 timer 变量。

## Goals / Non-Goals

**Goals:**

- 仅降低 `onToken` 引发的 footer 实际重绘频率，缓解高频 streaming 时的闪烁。
- 每次 `onToken` 仍更新最新完整 draft，确保下一次 render 使用最新文本。
- 首个 streaming token 尽快可见，后续 burst token 按短时间窗口合并展示。
- 非 token 的结构性状态变化保持即时：tool call pending、tool result、complete、error、interrupt、resize、exit、用户输入和 command/approval/user-question surface 不等待 token 节流窗口。
- 将节流 timer、上次渲染时间等状态收敛到 `TurnContext`，通过 `AppContext` 暴露最小 facade，避免 `main.ts` 直接持有调度细节。

**Non-Goals:**

- 不改变 OpenAI adapter、agent callbacks contract 或 provider 请求格式。
- 不改变最终 assistant transcript 内容、tool records 或 session 持久化语义。
- 不引入用户可配置的刷新率选项。
- 不优化单次 Markdown/table projection 的计算成本；本变更只处理 repaint 频率。
- 不对普通输入、slash suggestion、spinner tick 或 command surface 做全局节流。

## Decisions

### 1. 只节流 `onToken` 路径

`onToken` 是当前高频 repaint 的主要来源。普通输入和 command/user interaction 是用户直接操作反馈，tool/complete/error/interrupt/resize 是结构性状态变化，都应保持即时渲染。

备选方案是创建全局 footer render scheduler，把所有 `renderFooter()` 都合并。该方案边界更大，会改变更多交互路径的时序，也更容易影响现有测试和用户输入反馈，因此本次不采用。

### 2. 节流状态放在 `TurnContext`

`TurnContext` 已经负责 assistant turn 的 pending、spinner timer 和 active turn 生命周期。streaming token render scheduler 只服务 assistant streaming turn，放在这里比放在 `main.ts` 更符合职责边界。

实现上 `TurnContext` 只持有 timer、last render 时间和 `onRender` callback，不依赖 renderer 或 render state。`AppContext` 暴露：

- `configureStreamingRenderTimer({onRender})`
- `scheduleStreamingRender()`
- `cancelStreamingRender()`

必要时可以暴露 `flushStreamingRender()`，但本设计优先使用 cancel，因为结构性事件通常马上会走自己的即时 render 或 transcript append。

### 3. 首帧立即显示，后续 trailing 合并

推荐使用约 50ms 的最小渲染间隔。第一个 token 或距离上次 token render 超过间隔时立即调用 `onRender()`；窗口内后续 token 只更新 draft，并确保存在一个 trailing timer 在窗口结束时渲染最新 draft。

这样可以兼顾两点：

- 首字响应不会被固定延迟。
- 高频 token burst 期间最多约 20 FPS 刷新 footer，降低清屏/重写压力。

### 4. 结构性事件取消待执行 token render

当发生 tool call、complete、error、abort/interrupt、resize recovery 或 exit 时，系统应取消尚未执行的 token render timer，再继续原有即时路径。原因是这些路径会改变 pending 类型、追加 transcript 或重绘完整快照，旧的延迟 token render 不应在之后再次运行。

例如：

```text
onToken(draft) -> schedule trailing render
onToolCall     -> cancel trailing render -> set tool pending -> renderFooter now
```

## Risks / Trade-offs

- [Risk] 真实终端中 50ms 仍可能过于频繁或过慢 → Mitigation: 先作为内部常量实现，测试覆盖行为语义；后续基于实际体验继续微调，但不暴露配置。
- [Risk] 延迟 timer 在 turn 结束后运行，覆盖完成态或工具态 → Mitigation: 所有非 token 结构性事件进入前取消 pending streaming render；turn 完成/失败/取消也清理 timer。
- [Risk] 测试依赖 `onToken` 后立即看到最新 draft → Mitigation: 首个 token 保持立即 render；新增测试覆盖第二个及后续高频 token 被合并，并通过可控 timer/真实短等待验证 trailing render。
- [Risk] 将 UI 调度放入 `TurnContext` 可能扩大其职责 → Mitigation: `TurnContext` 只管理 assistant turn 内的 streaming render 节流状态，并通过 callback 与 renderer 解耦，不创建通用 render scheduler。

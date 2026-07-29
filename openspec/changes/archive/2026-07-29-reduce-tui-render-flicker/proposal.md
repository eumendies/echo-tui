## Why

当前 assistant token 和 shell 输出流在更新 pending preview 时使用 50ms streaming timer，同时响应中的 spinner 又以 100ms 周期重绘同一 footer；两套时钟叠加后会频繁执行整块 footer 清除与重画，在输出密集时产生明显频闪并增加终端写入压力。需要统一高频状态的刷新节奏，并缩短旧帧清除与新帧写入之间的可见空窗。

## What Changes

- 将 assistant token 和 shell output chunk 改为只更新最新 pending 状态，由响应期间的统一 100ms 渲染时钟批量投影到 footer。
- 保留 tool call、approval、user question、assistant segment、完成、失败、中断和 resize 等结构性状态变化的即时刷新，避免交互反馈被不必要地延迟。
- 将普通 footer redraw 的“清理旧 footer”和“绘制新 footer”组合成一次 `output.write()`，降低终端观察到中间空白帧的概率。
- 保证流式完成、失败或中断时同步提交并绘制最新 draft，不因取消周期刷新而丢失尾部内容。
- 增加渲染调度和 footer 输出边界测试，验证刷新合并、单次写入、光标恢复及新旧 footer 高度变化。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `terminal-tui-prototype`: 增加高频 pending 更新的统一节流刷新、结构性事件即时刷新，以及 footer 单帧单次写入的终端渲染稳定性要求。

## Impact

- 主要影响 `src/app/state/turn-context.ts`、`src/app/assistant-turn-runner.ts`、`src/app/main.ts` 与 `src/render/footer.ts`。
- 需要更新 app state/controller 与 renderer 测试，覆盖 assistant streaming、shell streaming、最终内容收尾和 footer stdout 写入次数。
- 不改变 provider callback 契约、transcript 持久化格式、Markdown 投影规则或公共 CLI 参数。
- 不引入第三方 TUI 库、alternate screen 或新的运行时依赖。

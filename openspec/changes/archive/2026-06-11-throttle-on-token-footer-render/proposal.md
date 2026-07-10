## Why

当前 assistant streaming 期间每次 `onToken` 都会立即触发 footer 重绘。高频 token 输出会造成终端反复清理并重写 footer，部分终端中会出现可见闪烁，影响流式阅读体验。

## What Changes

- 对 `onToken` 引发的 streaming footer render 做节流/合并，降低高频 token 下的实际 footer 重绘次数。
- 保留每次 token 对最新 streaming draft 状态的更新，确保最终显示内容不丢失、不改变 transcript 事实模型。
- 首个 token 或可见状态变化仍应及时显示，后续高频 token 合并为按帧展示最新 draft。
- 非 token 的结构性 UI 变化（tool call、完成、错误、中断、resize、用户输入、command surface 等）继续走即时渲染或取消待执行的 streaming render，避免旧的延迟 render 覆盖新状态。
- 不引入新的用户配置项、不改变 provider adapter 协议、不改变最终 assistant transcript 内容。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `terminal-tui-prototype`: 调整 assistant streaming pending preview 的 footer 重绘频率要求，要求高频 token 输出时合并 footer repaint，同时保持最新 draft、完成态、工具态和中断态显示正确。

## Impact

- 影响 `src/app/main.ts` 中 agent callback 对 footer render 的调度方式。
- 影响 `src/app/turn-context.ts` / `src/app/app-context.ts` 中 assistant turn 相关状态管理，建议把 streaming render 节流状态收敛到 turn context，通过 app context 暴露 facade。
- 需要更新 app/turn 相关测试，覆盖高频 token 合并、结构性事件取消延迟 render、最终 pending/assistant record 正确性。
- 不新增运行时依赖，不改变命令行 API、配置文件格式或 OpenAI provider 请求格式。

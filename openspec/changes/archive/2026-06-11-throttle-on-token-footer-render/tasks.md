## 1. TurnContext 调度能力

- [x] 1.1 在 `TurnContext` 中增加 streaming token footer render 的节流状态、配置方法和取消方法，状态仅持有 timer、上次 render 时间和 render callback。
- [x] 1.2 实现首个 token 立即 render、窗口内 token 合并、窗口结束后 trailing render 最新 draft 的调度逻辑。
- [x] 1.3 在 assistant turn 完成、失败、取消或被替换时清理待执行 streaming render timer，避免迟到 render 覆盖新状态。
- [x] 1.4 通过 `AppContext` 暴露 `configureStreamingRenderTimer`、`scheduleStreamingRender`、`cancelStreamingRender` 等 facade，保持 `main.ts` 不直接管理调度变量。

## 2. Agent callback 接入

- [x] 2.1 在 `createApp()` 初始化时配置 streaming render callback，使调度器触发时仍复用现有 `renderFooter()` 路径。
- [x] 2.2 将 `onToken` 从立即 `renderFooter()` 改为更新 streaming pending draft 后调用 `scheduleStreamingRender()`。
- [x] 2.3 在 `onToolCall`、`onComplete`、异常/中断处理、resize recovery 和 exit 前取消待执行 streaming token render，再走原有即时渲染或 transcript append 路径。
- [x] 2.4 确认普通输入、slash suggestion、command surface、tool approval、user question、tool result 和 spinner tick 的即时反馈不被本次节流影响。

## 3. 测试与验证

- [x] 3.1 增加或更新单元测试，覆盖首个 token 立即显示、高频 token 合并 render、trailing render 使用最新 draft。
- [x] 3.2 增加或更新测试，覆盖 tool call、complete、error/interrupt、resize 或 exit 会取消待执行 token render，且不会被旧 timer 覆盖。
- [x] 3.3 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \;`。

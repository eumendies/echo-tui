## Why

当前工具调用会在 `tool_call` 到达时立即写入 transcript 区域，随后 `tool_result` 再作为另一条消息显示；这让执行中的工具状态难以在临时区域更新，也无法根据最终结果为可见 prefix 做一致的成功/失败反馈。

同时，模型首字响应之后到本轮结束之间缺少稳定的工作状态提示。长时间 streaming、工具执行或 continuation 等待时，用户需要看到本轮仍在进行以及已耗时多久。

## What Changes

- 将工具调用执行中的可见状态从 transcript 区域延后到 footer pending 区域：`tool_call` 到达时先显示临时 tool call preview，不立即追加 transcript record。
- `tool_result` 到达后，再按既有 transcript 语义追加 `tool_call` 与 `tool_result` 两条记录，保持历史和 provider-facing record 结构稳定。
- 在工具消息渲染中根据相邻 `tool_result.ok` 为 `tool_call` 行的 `◆` prefix 应用成功/失败颜色；旧记录或缺少状态的记录安全降级为既有样式。
- 添加 working spinner：从本轮首个 assistant token 到达到本轮完成或失败结束之间显示，并展示本轮已耗时。
- working spinner 显示在 footer 中，位置固定为 pending preview 下方、divider 上方，并紧贴 divider。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `streaming-llm-service-adapter`: 调整 app agent callback 到 transcript 可见记录的工具消息生命周期，支持 tool call 延迟进入 transcript，同时保持 runtime continuation record 行为稳定。
- `markdown-terminal-rendering`: 扩展 footer pending/working 区域的终端可见投影，支持 tool call pending preview、working spinner 和基于工具结果状态的 prefix 着色。

## Impact

- 影响 app turn 生命周期与 render state：`src/app/main.ts`、`src/app/turn-context.ts`、`src/app/render-context.ts`、`src/types/render.ts`。
- 影响 footer 和 tool 消息渲染：`src/render/footer.ts`、`src/render/blocks.ts`、`src/render/tool-message-renderer.ts`、`src/render/app-renderer.ts`。
- 影响 app/render 测试中关于 tool callback、pending/footer 布局和 transcript append 的断言。
- 不改变 provider agent、tool executor、tool handler 或 OpenAI continuation record 的核心契约。

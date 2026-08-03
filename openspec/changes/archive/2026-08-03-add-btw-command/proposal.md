## Why

用户在主 assistant turn 运行期间经常需要追问实现细节或核实背景，但现有单槽 pending message 和只读信息面板无法提供一个不干扰主任务的多轮 agent 对话。新增 `/btw` 可以让用户暂时进入独立的只读旁路会话，同时保留主 turn 的后台运行和 prompt cache 的稳定前缀。

## What Changes

- 新增 `/btw [问题]` 命令，可在空闲时或 active assistant turn 期间进入多轮临时旁路会话；命令参数可作为首条问题立即提交。
- BTW 打开时冻结主会话 provider 上下文作为参考，但使用独立的临时 records、composer、todo、compaction、turn identity 和取消信号；BTW 内容不写入主 transcript 或 session journal。
- 使用 provider-facing user message 边界明确声明 BTW 语义，禁止模型继续主任务、未完成计划、todo 或预期工具调用；built-in system prompt 和 provider-visible tool definitions 保持不变，以维持现有 prompt cache key。
- 为 BTW agent run 增加显式的 per-run readonly policy：允许受支持的只读本地/网页/skill 工具，拒绝写工具、非只读 bash、MCP、用户提问和未知工具，且不打开授权 surface。
- BTW 通过 destructive repaint 临时替换主 transcript 投影；BTW 内部继续复用稳定 record append 和 footer redraw，主 records 在后台更新但不输出到 BTW 视图，退出后完整重放最新主会话。
- Esc 中断当前 BTW turn、使迟到 callback 失效、丢弃全部临时状态并返回主会话；主 turn 的 approval 或 user question 等高优先级 surface 仍可暂时覆盖 BTW。
- 在 slash suggestions、帮助和状态展示中注册 `/btw`，并展示 BTW readonly 状态及后台 MAIN activity。

## Capabilities

### New Capabilities
- `btw-side-conversation`: 定义临时旁路会话的上下文隔离、多轮输入、只读 agent 执行、视图切换、后台主 turn 共存、退出清理和缓存稳定性。

### Modified Capabilities
- `response-time-commands`: 将 `/btw` 加入响应期允许命令，并规定 BTW 全视图投影与后台 assistant turn、高优先级 surface 和输入路由的并存语义。
- `local-tool-execution`: 增加独立于 plan mode 的 per-run readonly tool policy，在保持 provider-visible tool schema 稳定的同时拒绝 BTW 不允许的调用。

## Impact

- 影响 slash command 注册、suggestion/help 元数据、command host facade 和 command session 生命周期。
- 需要 app 层 BTW conversation controller、独立 turn runner/context，以及 main/BTW 可见 transcript 投影路由。
- 影响 agent run options、工具调用策略分类和 tool result 拒绝语义，但不改变 built-in system prompt、provider-visible tool definitions 或默认主会话行为。
- 影响 transcript/footer/banner 渲染、destructive resize recovery、Esc 路由和后台 pending 状态展示。
- 需要为上下文边界、缓存 key 稳定、临时状态不持久化、readonly fail-closed、callback 隔离和主视图恢复增加自动化测试；交互式终端切换与 resize 需要人工验证。

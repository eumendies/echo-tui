## Why

主 Agent 已支持同一 provider turn 内连续只读工具的并行执行，但 `run_subagent` 委派始终独占执行，explorer 类并行调查的加速能力没有释放。同时现有单 slot 状态（footer 子 Agent 活动、人工审批 surface、子 Agent 过程渲染分组）只按"同一时刻至多一个运行"设计：直接放开并行会造成稳定记录被丢弃、并行审批互相抢占 deny、渲染轨道交错不可辨识。需要先把多运行状态与渲染边界固化，再放开并行执行能力。

## What Changes

- 主循环把同一并行只读段内的多个 readonly `run_subagent` 调用并发执行；general（worker）委派保持独占；不设并发上限。
- 工具调用并发分类支持按目标 subagent 定义的 executionPolicy 判定 `run_subagent` 是否可并行；参数解析失败或未知名称一律独占（fail-closed）。
- 并行分组通过 `ToolExecutionOptions` 向委派端口传递 groupSize，端口把 `parallelSize` 写入子 Agent start record，作为 live 投影、快照重绘与会话重放一致的渲染事实。
- `SubagentRunContext` 从单 slot 改为按 runId 的多运行注册表：交错稳定记录全部落盘，footer 活动按 run 隔离，迟到 runId 仍被拒绝。
- 主窗口渲染分叉：单 run 委派保持现有 rail 流式；并行 run 的内部过程不进入主 rail，执行中以紧凑多行 pending 块展示，完成后外层 tool pair 展开显示最终报告。
- 人工授权 surface 增加 FIFO 排队：并行子 Agent 同时请求审批时逐个处理，不再抢占式 deny 现有请求；父 turn abort 时活跃与排队请求全部以 interrupted 决策收尾。
- 新增 Ctrl+O subagent 会话窗口：以 destructive repaint 全屏接管查看任一 run 的完整 loop 内容，↑/↓ 在 run 间切换，Esc 返回主会话且不中断父 turn；run 结束后可随时回看。

## Capabilities

### New Capabilities

- `subagent-session-view`: Ctrl+O 打开的 subagent 全屏会话窗口：按 runId 过滤的完整 loop 投影、运行间切换、Esc 返回不中断父 turn、resize 恢复与完成后回看。

### Modified Capabilities

- `readonly-subagent-delegation`: 新增并行只读委派要求（并行判定、并发执行与取消语义、parallelSize 渲染事实）；移除已与代码不一致的每父 run 四次委派预算要求。
- `local-tool-execution`: 扩展"工具调用并发分类"：`run_subagent` 依据目标定义执行策略进入 `parallel_read`，解析失败保持独占。
- `subagent-transcript-rendering`: 子 Agent 过程渲染按 parallelSize 分叉（并行 run 不进主 rail、plural 紧凑 footer 块、外层 pair 报告展开），单 run 行为保持不变。
- `tool-approval`: 人工授权请求改为 FIFO 排队处理，abort 时活跃与排队请求统一以 interrupted 决策收尾。

## Impact

- 类型层：`src/types/agent.ts`（SubagentDescriptor 增加 executionPolicy）、`src/types/tool.ts`（ToolExecutionOptions 增加 subagentGroupSize）、`src/types/transcript.ts`（start event 增加 parallelSize）、`src/types/render.ts`（PendingState 增加 subagents 形态）。
- 执行层：`src/agent/loop-runtime/agent-loop-runtime.ts`、`src/tools/tool-concurrency-classifier.ts`、`src/tools/run-subagent-tool-handler.ts`、`src/agent/subagent/runtime.ts`。
- 状态层：`src/app/state/subagent-run-context.ts`、`src/app/state/tool-approval-context.ts`、`src/app/assistant-turn-runner.ts`。
- 渲染层：`src/render/app-renderer.ts`、`src/render/blocks.ts`、`src/render/footer.ts`、`src/render/subagent-renderer.ts`、新增 `src/render/tool-message-renderers/run-subagent.ts`。
- 交互层：`src/input/event-types.ts`、`src/input/key-parser.ts`、新增 `src/app/subagent-view-controller.ts`、`src/app/main.ts`。
- 测试与文档：`test/agent`、`test/app`、`test/render`、`test/tools` 对应更新；`docs/tui-architecture.md` 同步。

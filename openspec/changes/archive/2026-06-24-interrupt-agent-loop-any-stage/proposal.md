## Why

当前 Esc 中断能力已经覆盖 assistant thinking / streaming 的主要路径，但 agent loop 进入工具调用、工具结果 continuation、自动压缩、等待下一轮 provider 请求或 surface 关闭后的中间态时，用户再次按 Esc 可能无法中断整轮响应。用户需要一个稳定的心智模型：只要 assistant turn 仍在占用 response lock，且当前没有更高优先级 surface，Esc 就能请求停止这一轮 agent loop。

## What Changes

- 将 assistant turn 的中断判定从 `pendingKind` 绑定改为 active turn 绑定：只要 response lock 仍由当前 assistant turn 占用，Esc 就 SHALL 请求取消该 turn。
- 保持现有 surface 优先级：`ask_user_questions`、tool approval、file picker、command/help/model 等 surface 活跃时，第一次 Esc SHALL 只关闭或取消该 surface；surface 关闭后再次按 Esc 才 SHALL 中断 agent loop。
- agent loop SHALL 在 provider 请求、自动压缩、工具授权、用户问题、工具执行和 continuation 的所有可观察 await 边界检查取消信号，取消后不再推进后续 tool/provider loop。
- provider 请求和自动压缩摘要请求 SHALL 复用同一个 turn 级 `AbortSignal`，确保用户取消可传播到所有 provider turn。
- 工具执行层 SHALL 支持可选取消信号；优先让 bash tool、web fetch/search 等长耗时工具响应 Esc。对无法真正取消的工具，runtime SHALL 至少在工具返回后停止 continuation 并忽略迟到结果。
- 中断收尾继续沿用既有语义：保留已生成 partial assistant，追加本地中断提示，释放 response lock，且不把本地提示发给 provider。

## Capabilities

### New Capabilities
- `agent-loop-interruption`: 描述 assistant turn 在 agent loop 任意阶段的 Esc 中断语义、surface 优先级、取消传播和中断后的 continuation 边界。

### Modified Capabilities
- `response-interruption`: 扩展已有 response 中断能力，从 thinking / streaming 阶段中断升级为 active assistant turn 任意 loop 阶段中断。
- `streaming-llm-service-adapter`: 扩展 agent/provider/compaction/tool runtime 对 turn 级取消信号的传播和边界检查要求。
- `terminal-tui-prototype`: 明确 TUI Esc 分发优先级：活跃 surface 首次消费 Esc，无 surface 时 Esc 中断当前 assistant turn。
- `ask-user-questions-tool`: 明确 `ask_user_questions` surface 的 Esc 只取消问题请求并返回 cancelled tool result，不直接中断整轮 agent loop。
- `shell-mode`: 明确本变更不改变 shell mode 本地命令的 Esc 中断语义，shell 命令仍优先按 shell command interruption 处理。

## Impact

- 影响 `src/app/main.ts` 的 Esc 输入分发和 active assistant turn 中断入口，但不改变 modal/command 优先消费顺序。
- 影响 `src/app/state/turn-context.ts` / `src/app/state/app-context.ts` 的 `interruptActiveAssistantTurn()` 判定、pending 清理和 partial draft 收尾。
- 影响 `src/agent/agent-loop-runtime.ts` 的 abort 检查点、provider turn 前后状态回调、tool/user-question/approval/continuation 边界。
- 影响 `src/agent/context/context-compaction.ts`，需要让自动压缩摘要请求接收并传递 turn 级取消信号。
- 影响 `src/types/tool.ts`、`src/tools/tool-executor.ts` 和部分 tool handlers，使工具执行可接收可选取消信号。
- 需要更新 app、agent loop、compaction、tool executor、bash/web 工具和相关 provider adapter 的自动化测试，并补充手动 TUI 验证。

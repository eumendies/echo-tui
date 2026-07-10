## Why

当前 assistant 正在 thinking 或 streaming 时，Esc 不会中断正在进行的模型请求；用户只能等待模型完成或失败，无法主动停止长回答。支持中途按 Esc 中断可以提升交互可控性，并让 fake agent 测试 UI 时更接近真实使用体验。

## What Changes

- 在 assistant response 活跃期间，Esc SHALL 中断当前模型回答；但已有 command surface、tool approval、ask user questions 等 modal 仍优先消费 Esc。
- 当前 turn SHALL 通过标准取消信号向 agent loop 和底层 provider 传播中断请求，避免只清理 UI 而后台 stream 继续运行。
- 中断后 SHALL 停止 pending preview 与 spinner，释放 response lock，使用户可以继续输入。
- 中断前已产生的 partial assistant draft SHALL 被保留为 assistant transcript record；系统 SHALL 追加本地中断提示，且该提示不得作为 provider input 发送给模型。
- OpenAI provider 和 fake provider SHALL 支持取消正在进行的 streaming turn；agent loop SHALL 在中断后停止后续 provider/tool continuation。
- 已经启动的本地工具进程强制终止不纳入本次范围；本次只保证模型请求、fake streaming 和后续 loop 不再继续。

## Capabilities

### New Capabilities
- `response-interruption`: 描述用户在 assistant response 活跃期间通过 Esc 中断当前模型回答的外部行为、transcript 结果和 provider 取消语义。

### Modified Capabilities
- `streaming-llm-service-adapter`: agent contract、OpenAI/fake provider streaming 和 agent loop 需要支持可选取消信号。
- `terminal-tui-prototype`: TUI 输入事件和 assistant 生命周期需要定义 response 活跃期间 Esc 的中断行为及可见反馈。

## Impact

- 影响 `src/app/main.ts` 的输入事件分发和 assistant turn lifecycle。
- 影响 `src/app/turn-context.ts` / `src/app/app-context.ts` 的中断收尾、pending 清理和本地 notice 追加能力。
- 影响 `src/types/agent.ts`、`src/agent/agent-loop-runtime.ts`、`src/agent/openai-agent.ts` 和 `src/agent/fake-agent.ts` 的取消信号传递与处理。
- 影响 transcript provider 转换、上下文压缩 token 估算和 renderer 对本地中断提示 role 的处理。
- 需要新增或更新 app、agent loop、OpenAI provider、fake provider 和渲染相关测试。

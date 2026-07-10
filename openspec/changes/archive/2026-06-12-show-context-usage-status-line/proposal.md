## Why

用户目前无法在 TUI 中看到真实模型请求已经占用了多少上下文窗口，只能等到压缩或模型失败时才感知上下文压力。把 provider 返回的真实 input usage 显示在 status line，可以让用户提前判断是否需要压缩、清理或切换更大窗口模型。

## What Changes

- 在 status line 展示最近一次真实 provider input token usage 和当前模型 context window，例如 `ctx last 18.2k/128k`。
- 真实 usage 来自 provider 返回的 `usage.input_tokens`，不是本地字符估算；没有 provider usage 时不显示 context usage。
- agent loop runtime 在收到真实 usage 后通过 app callback 上报 usage 与 context window。
- AppContext 持有当前进程内的 transient context usage 状态，并通过 render state 注入 status line。
- 切换模型、清空 transcript、恢复 session 等会让旧 usage 失去语义的操作 SHALL 清空 context usage。
- 不持久化 context usage，不写入 transcript 或 `/resume` session。

## Capabilities

### New Capabilities

### Modified Capabilities
- `streaming-llm-service-adapter`: 扩展 agent callback contract，上报真实 provider input usage 与 context window。
- `terminal-tui-prototype`: 扩展 status line 行为，展示最近一次真实 context usage，并在窄宽度下保持单行裁剪。
- `app-context-state-container`: 扩展 AppContext transient state，保存和清理 context usage，不持久化。

## Impact

- 影响 `src/types/agent.ts` 的 callback 类型和 `src/agent/agent-loop-runtime.ts` 的 usage 上报逻辑。
- 影响 `src/app/app-context.ts`、`src/app/render-context.ts` 和 `src/types/render.ts` 的 render state/status line 数据结构。
- 影响 `src/render/footer/composer-surface.ts` 的 status line 文本拼接。
- 影响 `/model`、`/clear`、`/resume` 等会使旧 usage 失效的 app 状态路径。
- 增加 agent/runtime、app context、footer rendering 和相关 app integration 测试；不引入新依赖，不改变 transcript persistence schema。

## Why

现在的 status line 只能回答“已经跑了多久”（`working 00:12`），回答不了“模型现在还在出词吗、出得多快”。流式期间出现长时间停顿（provider 排队、限流、网络抖动）与稳定出词在界面上完全一致，用户无法判断该继续等还是该中断。

同时，其他编码 agent 普遍显示的 token 速率只覆盖正文文本，而模型生成工具调用参数时同样在出词——尤其大段 `apply_patch` 或 `write` 参数，往往比正文更耗时间，却完全没有任何进度反馈。

## What Changes

- 新增 provider 级回调 `onStreamDelta(text)`：模型每吐出一段原始输出文本（正文、reasoning 摘要、工具调用参数分片）就上报一次，不做任何解析。
- 三个 provider adapter 全部接入该回调：OpenAI Chat 的 `delta.content` / `reasoning_content` / `tool_calls[].function.arguments`，Anthropic 的 `text_delta` / `thinking_delta` / `input_json_delta.partial_json`，以及 OpenAI Responses 的 `output_text.delta` / `reasoning_summary_text.delta` / 新增监听的 `response.function_call_arguments.delta`。
- 新增滑动窗口速率统计：用现有 `estimateTextTokens` 把上报文本换算成 token 估算值，取最近 3 秒的样本求每秒 token 数。该数值是**本地估算**，只用于感知节奏，不作为计费、context 或 `/usage` 依据。
- status line 的 activity 段追加速率：`⠋ working 00:12 · 42 t/s`。工具本地执行期间没有 token 到达，速率显示为 `0 t/s`，明确表达“模型当前没有出词”。
- `ui.statusLine` 新增第 7 个开关 `rate`（默认 `true`）；关闭后 activity 段回到 `⠋ working 00:12`。`/config` → 常规 → 状态栏显示项子面板新增一行「输出速率」。
- 速率只属于 assistant turn 的模型输出活动。shell 本地执行、MCP 初始化、会话引用总结、手动压缩等非 assistant turn 占用不显示速率，避免在纯本地操作旁边显示 `0 t/s`。
- 主会话与 `/btw` 侧会话各自持有独立统计器，速率不跨 owner 串扰。subagent 视图与并行子运行本次不显示速率。
- 无 **BREAKING**：默认开启只新增一段短文本，关闭开关后完全等价于当前行为。

## Capabilities

### New Capabilities

- `output-rate-metering`: 定义流式输出 token 速率的采集口径（哪些 delta 计入）、本地估算与滑动窗口算法、assistant turn 归属判定、重试与中断边界、精度声明，以及多 owner 隔离。

### Modified Capabilities

- `status-line-segments`: 可选 segment 从 6 个扩展为 7 个，新增 `rate` 段；子面板行集合与入口行摘要随之变化。
- `terminal-tui-prototype`: `footer status line` 要求中“这 6 个 segment”的表述需要更新，并补充 activity 段在模型流式期间显示速率的可见行为。

## Impact

- provider 回调：`src/types/agent.ts`（`AgentCallbacks.onStreamDelta`）、`src/agent/loop-runtime/types.ts`、`provider-step.ts`、`provider-stream-retry.ts`（透传，不参与 attempt gate）。
- provider adapter：`src/agent/openai-chat/agent.ts`、`src/agent/anthropic/agent.ts`、`src/agent/openai-responses/agent.ts`。
- 统计：新增 `src/app/state/output-rate-tracker.ts`；`src/app/state/turn-context.ts` 持有一个实例并在 turn 边界重置。
- 接线：`src/app/assistant-turn-runner.ts`（`onStreamDelta` → tracker）、`src/app/btw-conversation-controller.ts`（独立 tracker 与 activity 速率）。
- 渲染：`src/types/render.ts`（`StatusLineActivityState.ratePerSecond`）、`src/render/footer/composer-surface.ts`（activity 段文案）。
- 配置：`src/config/app-settings-config.ts`（第 7 个字段）、`src/commands/config/state.ts` 与 `src/render/footer/config-surface.ts`（子面板行）。
- 测试：`test/agent/*`（adapter 上报）、`test/app/*`（tracker 与 wiring）、`test/render/footer.test.js`、`test/config/app-settings-config.test.js`、`test/commands/config-command-handler.test.js`、`test/render/config-surface.test.js`。
- 文档：`docs/configuration.md`、`docs/tui-architecture.md`。
- 不影响：transcript 与 journal 格式、provider 请求体、context 估算、compaction、`/context`、`/usage`、headless `--once` 的既有行为。

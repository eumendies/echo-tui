## 1. 配置与类型

- [x] 1.1 在 agent/config 类型中增加 `ReasoningSummary` 取值类型，并让 `LlmConfig` 携带可选 `reasoningSummary`。
- [x] 1.2 更新 `src/config/llm-config.ts`，从模型 profile 的 `reasoning.summary` 读取 `auto`、`concise`、`detailed`，并对无效值给出明确配置错误。
- [x] 1.3 更新模型上下文与 status 相关类型传递，确保新增 summary 配置不影响现有 `reasoning.effort` 显示和选择逻辑。
- [x] 1.4 补充配置解析测试，覆盖 summary 有效值、无效值、未配置 summary、summary 与 effort 同时配置。

## 2. OpenAI adapter 请求与 stream 解析

- [x] 2.1 更新 OpenAI Responses request 构造，在配置 summary 时发送 `reasoning.summary`，并保持只配置 effort 时的既有请求形态。
- [x] 2.2 实现 reasoning summary stream 累积，处理 `response.reasoning_summary_text.delta` 与 `response.reasoning_summary_text.done`，按 `output_index` / `summary_index` 稳定合并 summary parts。
- [x] 2.3 确保 raw `response.reasoning_text.*` 事件不会进入 assistant draft、reasoning summary 或 transcript。
- [x] 2.4 从 `response.output_item.done` 中识别 `type: "reasoning"` output item，作为 provider-private continuation item 返回给 runtime。
- [x] 2.5 补充 OpenAI adapter 测试，覆盖 summary request、summary delta/done、done 覆盖 delta、多段 summary、raw reasoning text 忽略、reasoning output item 捕获。

## 3. Agent loop continuation

- [x] 3.1 扩展 `AgentTurnResult` 和 callbacks，支持 provider turn 返回 `reasoningSummary` 与 OpenAI provider-private continuation items。
- [x] 3.2 更新 agent loop runtime，在每个 provider turn 后、tool call 或 final complete 前提交非空 reasoning summary。
- [x] 3.3 在 runtime 内部 continuation records 中保留 provider-private reasoning items，使下一次 OpenAI provider turn 能在 function call output 前回传它们。
- [x] 3.4 确保 provider-private reasoning items 不触发 app transcript append callback、不进入 session persistence、非 OpenAI/fake provider 不需要理解该结构。
- [x] 3.5 补充 agent loop runtime 测试，覆盖 summary+tool call、summary+final answer、空 summary、reasoning item continuation 顺序。

## 4. Transcript、渲染与持久化

- [x] 4.1 在 transcript 类型中增加 `reasoning_summary` role，并在 turn context 中提供追加 reasoning summary record 的方法。
- [x] 4.2 更新 app 主流程 callback，收到 reasoning summary 时追加 record、渲染到 transcript 历史区域，并保持 response lock 生命周期不变。
- [x] 4.3 新增 reasoning summary block/line renderer，使用低强调样式并区别于 assistant final answer、error 和 tool result。
- [x] 4.4 更新 app renderer role 分发，支持 resize/destructive recovery 后重新投影 `reasoning_summary` record。
- [x] 4.5 确认 transcript store clone/load/save 可保留 `reasoning_summary` record，补充 resume/preview 相关测试。
- [x] 4.6 补充 app/render 测试，覆盖 summary 位于 tool records 前、summary 位于 assistant 前、session 恢复后显示、resize 重新渲染。

## 5. Provider input 与上下文压缩

- [x] 5.1 更新 OpenAI transcript converter，过滤可见 `reasoning_summary` record，同时识别并回传 OpenAI provider-private reasoning item。
- [x] 5.2 更新 context compaction 的 non-provider role 集合，使 token 估算和压缩摘要输入跳过 `reasoning_summary`。
- [x] 5.3 补充 converter 和 compaction 测试，覆盖 reasoning summary 过滤、后续 records 顺序保持、压缩摘要输入跳过 summary、边界保护不受 summary 影响。

## 6. 文档与验证

- [x] 6.1 更新用户配置文档，说明 `reasoning.summary` 的取值、默认关闭、模型/组织不支持时会走服务端错误反馈。
- [x] 6.2 更新架构文档，说明 visible `reasoning_summary` 与 provider-private reasoning item 的边界。
- [x] 6.3 运行 `npm run typecheck`。
- [x] 6.4 运行 `npm test`。
- [x] 6.5 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 6.6 做针对性手动验证：启用 `reasoning.summary` 后触发真实/fixture tool loop，确认 summary、tool_call/tool_result、final assistant 的可见顺序和 resume 显示符合预期。

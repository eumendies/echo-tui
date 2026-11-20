## 1. provider 增量上报

- [x] 1.1 在 `src/types/agent.ts` 的 `AgentCallbacks` 增加 `onStreamDelta?: (text: string) => void`，用中文行内注释说明语义：模型又输出的一段原始文本，不做解析、不携带草稿全量。
- [x] 1.2 在 `src/agent/loop-runtime/types.ts` 的 `AgentTurnCallbacks` 纳入该回调，保持与既有 `onToken` / `onReasoningUpdate` 相同的可选与透传约定。
- [x] 1.3 在 `src/agent/loop-runtime/provider-step.ts` 的 `stepCallbacks` 透传 `onStreamDelta`；确认抢占后 `active === false` 时不再上报，避免收尾期污染速率。
- [x] 1.4 在 `src/agent/provider-stream-retry.ts` 的 `wrapAttemptCallbacks` 透传该回调，并确认它不参与 attempt gate 判定（重试不重置窗口）。
- [x] 1.5 在 `src/agent/openai-chat/agent.ts` 的正文 delta、`reasoning_content`、`mergeToolCallDelta` 三处上报对应文本。
- [x] 1.6 在 `src/agent/anthropic/agent.ts` 的 `text_delta`、thinking delta、`input_json_delta.partial_json` 三处上报对应文本。
- [x] 1.7 在 `src/agent/openai-responses/agent.ts` 的正文 delta 与 reasoning 摘要 delta 处上报，并新增 `response.function_call_arguments.delta` 分支只做上报；工具调用提取仍由 `extractFunctionCall` 在 `output_item.done` 完成。
- [x] 1.8 三处上报路径对未知或畸形事件保持静默跳过，不改变错误分类、流完成判定与重试决策。

## 2. 速率统计器

- [x] 2.1 新增 `src/app/state/output-rate-tracker.ts`：暴露 `record(text)`、`getRate(now)`、`reset()`，内部维护 `[{at, tokens}]` 样本序列。
- [x] 2.2 实现 3000 毫秒滑动窗口与 1000 毫秒最小跨度：`record` 时淘汰过期样本，`getRate` 时按窗口求和并四舍五入为整数，无样本返回 `0`。
- [x] 2.3 复用 `src/agent/context/token-estimator.ts` 的 `estimateTextTokens` 换算 token，不引入第二份字符系数。
- [x] 2.4 为模块与导出函数补中文 JSDoc 注释，说明窗口口径、估算性质与"不作为计费依据"的边界。
- [x] 2.5 新增 `test/app/output-rate-tracker.test.js`：持续出词、窗口过期归零、首样本不产生尖峰、`reset` 清空、样本序列不无限增长。

## 3. 状态接线

- [x] 3.1 在 `src/app/state/turn-context.ts` 持有主会话 tracker，提供 `recordStreamDelta(text)` 与 `getOutputRate()`，并在 assistant turn 起点重置。
- [x] 3.2 在 `src/app/assistant-turn-runner.ts` 的 turn callbacks 中增加 `onStreamDelta` 转发到 `turnContext.recordStreamDelta`，保持 `isCurrentTurn()` 守卫。
- [x] 3.3 在 `src/app/state/render-context.ts` 的 `resolveStatusLineActivity` 中只在 assistant turn 活跃时附带 `ratePerSecond`，复用 `canInterruptAssistantTurn()` 判定，排除 shell、MCP 初始化、引用总结与手动压缩。
- [x] 3.4 在 `src/app/btw-conversation-controller.ts` 建立独立 tracker，接入自身 `onStreamDelta` 并在 BTW status line 活动中附带速率；确认与主会话互不影响。

## 4. 渲染

- [x] 4.1 在 `src/types/render.ts` 的 `StatusLineActivityState` 增加 `ratePerSecond?: number`，中文注释说明"本地估算，非 provider 精确值"。
- [x] 4.2 在 `src/render/footer/composer-surface.ts` 新增速率 segment 构造，位置固定在左侧 segment 末尾（`dir` 之后），文本为 `<整数> t/s`；宽度变化只压缩中间填充。
- [x] 4.3 让 `createRightStatusSegments` 按 `visible.rate` 决定是否插入该 segment；`createMcpInitializationSegment` 与其他非 assistant turn 分支不输出速率。
- [x] 4.4 确认速率 segment 不改变既有左右对齐、右侧整体丢弃与左侧截断的降级顺序。

## 5. 配置

- [x] 5.1 在 `src/config/app-settings-config.ts` 的 `StatusLineSegments` 增加 `rate: boolean`（默认 `true`），并在 `STATUS_LINE_SEGMENT_KEYS` 末尾追加 `'rate'`。
- [x] 5.2 核对 `normalizeStatusLineSegments`、`applyAppSettingsDraft`、`validateAppSettingsDraft` 在加入第 7 个字段后仍然逐项独立回退与浅合并。
- [x] 5.3 在 `src/render/footer/config-surface.ts` 的 `STATUS_LINE_SEGMENT_LABELS` 增加「输出速率」，确认入口行摘要自动从 `6 项` 变为 `7 项`。

## 6. 测试

- [x] 6.1 新增或扩展 provider adapter 测试：正文、reasoning、工具参数分片三类增量都触发上报；畸形事件被忽略且不中断流。
- [x] 6.2 扩展 `test/render/footer.test.js`：assistant turn 活动显示 `N t/s`；速率为 0 时显示 `0 t/s`；`rate` 关闭后不显示；非 assistant turn 活动（shell、MCP）不显示。
- [x] 6.3 扩展 `test/config/app-settings-config.test.js`：`rate` 缺失默认 `true`、非法值逐项回退、保存写入第 7 个字段并保留未知兄弟键。
- [x] 6.4 扩展 `test/commands/config-command-handler.test.js` 与 `test/render/config-surface.test.js`：子面板第 7 行渲染与切换，入口行摘要变为 `7 项全开`。
- [x] 6.5 把既有断言中的 `6 个字段` / `6 项` / 六类 segment 相关期望同步为 7，确保既有用例与运行时一致。
- [x] 6.6 扩展 `test/app/turn-context.test.js` 或等价用例：turn 起点重置、工具执行期间速率为 0、turn 结束后不再投影。

## 7. 文档与验证

- [x] 7.1 在 `docs/configuration.md` 的状态栏显示项表格加入「输出速率」行，并补充"本地估算、不用于计费、工具执行期间显示 0 t/s"的说明。
- [x] 7.2 在 `docs/tui-architecture.md` 的 status line 说明与 footer 组件表中补充速率 segment 的位置、归属判定与多 owner 隔离。
- [x] 7.3 依次运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`。
- [ ] 7.4 手工验证：`npm start` 后触发真实或 fake 流式输出，确认正文与工具参数生成期间速率跳动、工具执行期间显示 `0 t/s`、关闭开关后回到 `working 00:12`、`/btw` 侧会话独立计数、Esc 中断后速率消失。

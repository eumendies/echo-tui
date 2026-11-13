## 1. Provider 错误分类层

- [x] 1.1 新增 provider-neutral 错误分类模块，定义 `ProviderErrorKind`、`ProviderError` 与分类入口，并复用现有 `redactSensitiveText` 保持脱敏语义
- [x] 1.2 实现分类优先级链：provider 结构化错误码 → SDK 错误类与 HTTP 状态 → 运行时网络错误特征 → 兼容文案表
- [x] 1.3 实现 `never` / `server-directed` / `backoff` 三态重试决策与默认策略常量（预算 5 次重试、硬上限 20、基础延迟 500ms、因子 2、单次上限 60s、抖动 ±20%、`rate_limit` 保守基础延迟 5s、`overloaded` 保守基础延迟 2s、保守子预算各 2 次）
- [x] 1.4 实现服务端重试建议解析：`Retry-After` 秒数与 HTTP 日期、`retry-after-ms`、stream 内错误对象 headers、限流文案中的 `try again in <N>s|ms`
- [x] 1.5 把旧 `RetryableResponseStreamError` 语义映射到新分类，保证本阶段不改变任何 adapter 的现有行为
- [x] 1.6 增加分类矩阵单元测试，覆盖每个 kind 的结构化证据、SDK 错误类、网络错误码与文案兜底

## 2. 共享重试执行器

- [x] 2.1 新增 provider-neutral 执行器，接收 stream 工厂、单次 attempt 读取函数、分类入口、策略与取消信号
- [x] 2.2 实现 attempt 级门控拆分：分别跟踪 assistant 正文增量、reasoning 预览、reasoning 完成通知、完整工具调用与 provider-private record，并实现 compaction 与 abort 的排除条件
- [x] 2.3 实现可被 turn 取消与 active-turn steering 抢占中断的退避等待
- [x] 2.4 实现 SSE 空闲看门狗，超时转换为 `stream_incomplete` 并进入重试决策；放弃 attempt 时必须显式调用 stream 迭代器的释放入口，不得只靠 `Promise.race`
- [x] 2.5 抽出可注入的 `sleep`、`random`、`now` 依赖，缺省使用真实实现，使测试可断言退避区间而不 pin 精确毫秒
- [x] 2.6 实现 `createStream()` 工厂抛错不扣减流式预算的边界：工厂失败直接交由 SDK 请求级重试，执行器不介入分类
- [x] 2.7 实现重试通知与预算耗尽后的最终错误包装（含已重试次数与最后一次 attempt 的 request ID）
- [x] 2.8 增加执行器单元测试，覆盖重试成功、预算耗尽、三态决策、保守子预算、空闲超时、取消中断、迭代器释放与门控组合

## 3. OpenAI Responses 与 Codex 接入

- [x] 3.1 改造 `src/agent/openai-responses/agent.ts`：`response.failed` 错误码、迭代期异常、无完成事件即 EOF、`response.incomplete` 分别映射到新分类，并接入共享执行器
- [x] 3.2 移除 `RETRYABLE_RESPONSE_STREAM_ERROR_TEXTS` 与本地 `runResponseStreamWithRetry` 的重复职责，保留文案表作为分类层的兼容兜底
- [x] 3.3 改造 `src/agent/codex/agent.ts` 复用共享执行器，确保每个 provider turn 只解析一次 OAuth credential、client 与请求快照
- [x] 3.4 实现重试前的 reasoning 预览清空：优先复用空 reasoning draft，验证渲染层可正确清空；必要时改为显式 reset 语义并同步 spec
- [x] 3.5 重写 `test/agent/openai-agent.test.js` 中硬编码退避序列与「最多额外重试一次」断言，改为断言决策、等待区间与通知内容
- [x] 3.6 重写 `test/agent/codex-agent.test.js` 的对应断言，并覆盖凭据只解析一次与 compaction 不重试

## 4. OpenAI Chat 与 Anthropic 接入

- [x] 4.1 改造 `src/agent/openai-chat/agent.ts`：错误 chunk 按错误码分类、缺失 `finish_reason` 即 EOF 归为 `stream_incomplete`，并接入共享执行器
- [x] 4.2 改造 `src/agent/anthropic/agent.ts`：`overloaded_error` / `rate_limit_error` / `api_error` 分类映射，停止原因失败保持不重试，并接入共享执行器
- [x] 4.3 把 Anthropic 的 reasoning 完成通知从「每个 `content_block_stop` 时发出」改为「`message_stop` 之后统一发出一次」，消除重试时的摘要重复落盘
- [x] 4.4 区分 Anthropic 的两种终止：缺 `message_stop` 归为 `stream_incomplete` 可重试，有 `message_stop` 但缺 `stop_reason` 归为 `never`
- [x] 4.5 保持 `max_tokens`、`refusal`、`pause_turn` 等既有停止原因失败语义不变
- [x] 4.6 增加 Chat 与 Anthropic 的重试测试，覆盖瞬时失败重试成功、服务端建议等待、保守退避回退、不可重试类别与取消中断

## 5. 可见性与配置

- [x] 5.1 扩展 `ProviderRetry` 类型，增加失败类别与可读原因，并更新 `src/types/agent.ts` 字段注释
- [x] 5.2 更新 `src/app/assistant-turn-runner.ts` 与 `src/app/btw-conversation-controller.ts` 的重试 notice 文案，包含失败原因、当前次数、预算上限与下次等待时长
- [x] 5.3 确认两个 app controller 都能正确处理 reasoning 预览清空（空 draft 或显式 reset），并覆盖 BTW 会话的中断隔离
- [x] 5.4 在 `src/config/llm-config.ts` 增加可选 `streamMaxRetries` 与 `streamIdleTimeoutMs` 读取：合法值直接采用、超硬上限 clamp 到上限、非整数/负数/非数字回退默认值、空闲阈值下限 10000ms
- [x] 5.5 增加配置测试，覆盖合法值、超上限 clamp、非整数值、负数值与缺省值
- [x] 5.6 确认 app 侧重试 notice 在正文流式显示期间的插入顺序符合 `incremental-streaming-commit` 的 drain 语义
- [x] 5.7 在 `docs/configuration.md` 的 provider profile 说明中补充 `streamMaxRetries` 与 `streamIdleTimeoutMs` 的可选字段、默认值与 clamp 规则

## 6. 验证

- [x] 6.1 运行 `npm run typecheck`
- [x] 6.2 运行 `npm test`
- [x] 6.3 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 6.4 手工验证：真实 provider 下制造 SSE 断流（如中断网络）观察重试 notice 与服务恢复
- [x] 6.5 手工验证：思考模型在已展示 reasoning 预览后失败时重试，确认预览被清空且正文不出现回退
- [x] 6.6 手工验证：重试退避期间按 Esc 中断，确认不再创建新 attempt 且 turn 正常结束
- [x] 6.7 手工验证：`/compact` 失败路径不产生额外 provider 请求
- [x] 6.8 手工验证：第三方兼容后端触发限流时不带 `retry-after` 时走保守退避，而不是直接失败
- [x] 6.9 手工验证：Anthropic 多 thinking block 响应只产生一条 reasoning summary record

## Why

`web_search` 当前使用通用 tool message renderer，调用行会暴露原始 arguments JSON，结果区则直接显示面向 provider 的 `results/url/snippet` 文本协议；连续搜索或较窄终端下信息层级不清晰，低质量诊断也容易显得突兀。为网页研究链路提供专属终端投影，可以在不改变工具执行和模型上下文的前提下，让查询、结果来源、摘要及质量状态更易读。

## What Changes

- 为 `web_search` 的 pending call、孤立 call 和相邻 call/result pair 增加专属 tool message renderer。
- 使用 `Web search · “<query>”` 语义标题替代原始工具名和 arguments JSON，并根据完成状态着色调用标记。
- 将成功结果投影为紧凑的两行式结果树：第一行展示标题，第二行展示可辨识的 URL 与 snippet。
- 将结果数量、partial match、未匹配 query terms 和截断状态显示为弱化 metadata，不使用突兀的独立 warning block。
- 为无结果、失败、超时、非标准参数和不可解析结果提供有界状态展示或通用 renderer fallback。
- 保持 transcript、tool result text、provider continuation、持久化内容和 `web_search` 执行协议不变。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `tool-message-rendering`: 增加 `web_search` 查询摘要、搜索结果树、质量 metadata、状态投影和安全降级要求。

## Impact

- 主要影响 `src/render/tool-message-renderer.ts` 和新增的 `src/render/tool-message-renderers/web-search.ts`。
- 需要扩展 `test/render/app-renderer.test.js`，覆盖 pending、成功、partial match、无结果、失败、截断、窄宽度和 malformed fallback。
- 不改变 `src/tools/web-search/` 的执行输出、tool schema、agent loop、provider adapter、transcript schema 或第三方依赖。

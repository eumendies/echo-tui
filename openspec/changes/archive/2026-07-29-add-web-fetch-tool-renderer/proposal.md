## Why

`web_fetch` 当前使用通用 tool message renderer，调用行暴露原始 arguments JSON，结果区直接显示 URL、状态字段、`content:` 与 fence marker 等 provider-facing 协议文本，页面正文的阅读层级不清晰。为明确 URL 读取提供专属终端投影，可以与现有 `web_search` 形成一致的“发现链接 → 阅读正文”体验，同时减少 transcript 中的协议噪音。

## What Changes

- 为 `web_fetch` 的 pending call、孤立 call 和相邻 call/result pair 增加专属 tool message renderer。
- 使用 `Web fetch · <display-url> · <metadata>` 单行逻辑标题替代原始工具名和 arguments JSON；HTTP status、redirect、分页、截断及生命周期状态均与 tool call 标题放在同一逻辑行。
- 将成功或带正文的 HTTP 错误结果投影为与 Bash 工具一致的连续 `▌` rail 文档摘录，隐藏 `content:`、fence marker 和内部字段名。
- 为 redirect、分页、响应截断、预览截断、offloading、空正文、HTTP 错误、timeout、网络失败和不支持媒体提供紧凑状态表达。
- 对长 URL 使用保留 host 和末尾路径语义的有界显示，并让标题与正文 rail 遵守 safe render width。
- 无法安全解析的参数或结果继续降级到通用 renderer；保持 transcript、tool result text、provider continuation、持久化内容和 `web_fetch` 执行协议不变。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `tool-message-rendering`: 增加 `web_fetch` 单行标题 metadata、文档摘录 rail、redirect/分页/截断/错误状态及安全降级要求。

## Impact

- 主要影响 `src/render/tool-message-renderer.ts`，并新增 `src/render/tool-message-renderers/web-fetch.ts`。
- 需要扩展 `test/render/app-renderer.test.js`，覆盖 pending、正常正文、redirect、分页、截断/offloading、HTTP 错误、timeout、unsupported、malformed fallback、窄终端和主题颜色。
- 不改变 `src/tools/web-fetch-tool-handler.ts` 的 formatter、tool schema、agent loop、provider adapter、transcript schema或第三方依赖。

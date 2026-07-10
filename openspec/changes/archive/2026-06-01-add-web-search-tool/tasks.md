## 1. Tool handler implementation

- [x] 1.1 新增 `src/tools/web-search-tool-handler.ts`，定义 `WEB_SEARCH_TOOL_NAME`、strict function schema、默认 timeout/response/output/count/query 限制和 handler 工厂。
- [x] 1.2 实现参数归一化：校验 `query`、`count`、`offset`、`market` 和 `safe_search`，无效输入返回 `ok: false` 且不发起网络请求。
- [x] 1.3 实现公共 Bing 搜索页 GET 请求：使用内置 fetch、AbortController timeout、响应体 byte cap 和克制的浏览器风格请求头，不携带 API key/cookie/认证信息。
- [x] 1.4 实现 Bing HTML best-effort 解析：抽取自然搜索结果 title/url/snippet，轻量 HTML 文本化、entity 解码、空白折叠、URL 过滤和去重。
- [x] 1.5 实现结果格式化和失败语义：输出 provider/query/count/offset/returned_results/truncated metadata，处理验证码/异常 HTML、无结果、HTTP 错误、网络失败、timeout 和输出截断。

## 2. Runtime integration

- [x] 2.1 在 `src/types/tool.ts` 增加 `WebSearchToolExecutionResult` 并纳入 `ToolExecutionResult` union。
- [x] 2.2 在 `src/types/transcript.ts` 增加 `WebSearchToolResultTranscriptRecord` 并纳入 tool result transcript union。
- [x] 2.3 在 `src/tools/tool-registry.ts` 默认注册 `createWebSearchToolHandler()`，保持已开发工具默认开启且不引入 enabled/API key 配置。
- [x] 2.4 在 `src/agent/agent-loop-runtime.ts` 为 `web_search` result 保留 `ok`、`timedOut` 和 `truncated` metadata。

## 3. Tests

- [x] 3.1 更新 default registry 和 OpenAI request schema 测试，确认 `web_search` 默认暴露且 strict schema required 字段包含所有 nullable 参数。
- [x] 3.2 补充 `web_search` 参数校验测试，覆盖空 query、超长 query、无效 count/offset/market/safe_search 且验证不会调用 fetch。
- [x] 3.3 补充成功解析测试，使用 fake fetch 返回 Bing 样例 HTML，验证请求 URL/headers、结果顺序、title/url/snippet、entity 解码、URL 过滤和去重。
- [x] 3.4 补充失败和边界测试，覆盖验证码/异常 HTML、可解析但无自然结果、HTTP 错误、网络失败、timeout、响应体截断和总输出截断。
- [x] 3.5 更新 agent loop runtime 测试，确认 `web_search` tool result record 保留 continuation 所需 metadata。

## 4. Documentation and validation

- [x] 4.1 更新 `docs/README.md` 和 `docs/tui-architecture.md`，说明 `web_search` 是无需 API key 的公共 Bing 页面 best-effort 搜索，正文读取仍使用 `web_fetch`。
- [x] 4.2 运行 `npm run typecheck`。
- [x] 4.3 运行 `npm test`。
- [x] 4.4 运行 `find bin src test -name '*.js' -exec node --check {} \;`。

## Context

现有 agent loop 已有 provider-neutral tool registry / executor，并默认注册 `run_bash_command`、`apply_patch`、`glob`、`grep`、`read_files` 和 `web_fetch`。其中 `web_fetch` 解决“已知 URL 的远程内容读取”，但不负责搜索；模型在不知道目标 URL 时只能依赖用户提供链接或使用 bash 自行请求搜索页，体验和边界都不稳定。

本变更新增 `web_search`，定位为无需 API key 的公开网页发现工具。它通过公共 Bing 搜索页面做 best-effort HTML 解析，只返回候选网页结果摘要，并把正文读取继续交给已有 `web_fetch`。设计必须保持现有工具运行时边界：provider agent 只发送 schema 和收集 tool call，agent loop runtime 负责执行工具和 continuation，TUI 可先使用通用 tool message 渲染。

## Goals / Non-Goals

**Goals:**

- 默认暴露 `web_search` 工具，让模型可以先搜索公开网页候选，再按需调用 `web_fetch` 读取明确 URL。
- 不要求用户配置 API key，不调用官方 Bing Search API。
- 对公共搜索页 HTML 做有界、可测试的 best-effort 解析，返回 title、url、snippet 和分页/截断 metadata。
- 对输入、响应体、输出文本、timeout 和异常页面设置明确边界，失败时返回 tool failure，而不是抛出未捕获异常中断 app。
- 不新增 npm 依赖，继续使用 Node 20 内置能力。

**Non-Goals:**

- 不保证搜索结果完整性、排序稳定性、地区一致性或长期 HTML 兼容性。
- 不绕过验证码、反爬、登录墙或地区限制；不使用 cookie、用户登录态、代理池或浏览器自动化。
- 不自动抓取搜索结果页面正文；正文读取由 `web_fetch` 显式完成。
- 不实现多搜索引擎抽象、搜索 provider 配置或 API-key 模式。
- 不新增 TUI 专属渲染；第一版沿用通用 tool call/result 展示。

## Decisions

### 1. 新增独立 `web_search` handler，而不是扩展 `web_fetch`

`web_fetch` 的契约是读取一个明确 HTTP(S) URL，并且明确不支持搜索。把搜索塞进 `web_fetch` 会模糊“发现 URL”和“读取 URL”的边界，也会让 URL 安全校验和搜索参数校验耦合。新增 handler 可以保持职责清晰：`web_search` 只返回候选结果，`web_fetch` 读取用户或模型选中的 URL。

替代方案是让模型用 bash/curl 访问搜索页，但这样会绕开工具级结构化结果、timeout/output caps 和测试覆盖，因此不采用。

### 2. 使用公共 Bing HTML 页面，并声明 best-effort 语义

用户明确希望无需 API key，因此不使用官方 Bing Search API。公共 HTML 页面不是稳定 API，工具应把它当作 best-effort 数据源：能解析自然网页结果时返回成功；检测到验证码/异常页面、HTML 结构不可识别或网络失败时返回明确失败。

替代方案是引入 headless browser 或第三方 scraper 库来提高解析能力，但这会增加依赖、运行成本和反爬边界风险，不符合当前 CLI 工具的轻量方向。

### 3. 保持请求模拟克制，不做反爬绕过

handler 可以发送普通浏览器风格的 User-Agent 和 Accept-Language，避免被默认 Node fetch UA 影响结果；但不维护 cookie、不复用登录态、不自动重试绕验证码、不走代理、不执行 JS。这让工具行为可解释，也避免把本地 CLI 变成浏览器自动化/爬虫系统。

### 4. 解析只抽自然结果的稳定子集

第一版只解析自然搜索结果中的标题、URL 和摘要，过滤空 URL、非 HTTP(S) URL、脚本 URL、Bing 内部跳转和重复 URL。结果格式保持结构化文本，便于模型继续选择 URL。解析失败不返回原始 HTML，避免污染 transcript 和模型上下文。

### 5. 配置只承载执行限制，不引入 enabled/API key

遵循当前工具默认开启的方向，`web_search` 默认注册。第一版可使用内置 timeout、响应体 byte cap、总输出 byte cap、最大结果数等安全默认；如后续需要配置，也应只配置限制参数，不引入 `enabled` 或 API key 必填项。

## Risks / Trade-offs

- [Risk] Bing HTML 结构变化导致解析失败 → Mitigation: spec 明确 best-effort；测试覆盖可解析样例、异常 HTML 和无结果；失败文本提示公共搜索页不可解析。
- [Risk] 搜索页返回验证码、反爬或地区提示页 → Mitigation: 检测常见异常信号并返回 `ok: false`；不绕过反爬，不输出原始 HTML。
- [Risk] 搜索结果摘要不含足够正文信息 → Mitigation: 工具只负责发现 URL；模型需要正文时继续调用 `web_fetch`。
- [Risk] 公共页面结果受地区、语言、网络环境影响 → Mitigation: result metadata 标明 provider、query、count、offset 等；不承诺排序或地区稳定。
- [Risk] HTML/实体解码实现过复杂 → Mitigation: 复用 `web_fetch` 中类似的轻量文本化思路，保持有限实体解码和空白折叠，不引入完整 DOM parser。

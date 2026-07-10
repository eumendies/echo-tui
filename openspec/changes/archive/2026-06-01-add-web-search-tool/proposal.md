## Why

当前工具集已经支持本地文件检索、明确 URL 抓取和 bash 执行，但模型无法在不知道具体 URL 的情况下发现公开网页资料。新增无需 API key 的 `web_search` 可以补齐“先发现网页候选，再用 `web_fetch` 读取明确 URL”的常见研究链路，同时避免要求用户配置第三方搜索 API 凭据。

## What Changes

- 新增默认工具 `web_search`，通过 Bing 公共搜索页执行 best-effort 搜索并返回受限的网页结果摘要。
- `web_search` 不使用官方 Bing Search API、不读取 API key、不使用登录态、cookies、浏览器自动化、代理池或反爬绕过机制。
- 工具返回结构化文本结果，包含 query、provider、分页参数、返回数量、截断状态，以及自然搜索结果的 title、url、snippet。
- 工具遇到验证码/反爬页、异常 HTML、网络失败、超时或无法解析自然结果时返回明确的工具失败或空结果语义，不追加本地 error transcript。
- 默认 registry 向模型暴露 `web_search`，并让 agent loop / transcript 保留该工具的执行状态和截断 metadata。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-tool-execution`: 增加默认远程搜索工具 `web_search` 的注册、执行边界、输入校验、公共搜索页解析和结果语义。

## Impact

- 影响 `src/tools/`：新增 Bing HTML 搜索 handler，并注册到默认 tool registry。
- 影响 `src/types/` 与 `src/agent/agent-loop-runtime.ts`：增加 `web_search` tool result 类型和 transcript metadata 传递。
- 影响测试：补充 schema、registry、成功解析、异常 HTML、网络失败、timeout 和截断场景。
- 影响文档/spec：说明 `web_search` 是无需凭据的公共页面 best-effort 解析，不保证搜索页 HTML 稳定性，不替代 `web_fetch` 的明确 URL 内容读取。
- 不新增 npm 依赖，不引入浏览器自动化或第三方搜索 API。

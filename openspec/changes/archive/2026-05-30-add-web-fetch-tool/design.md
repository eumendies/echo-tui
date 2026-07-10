## Context

当前默认工具链已经覆盖本地开发工作流：`glob` 发现路径，`grep` 搜索内容，`read_files` 读取已知文件，`apply_patch` 修改文本，`run_bash_command` 执行验证和复杂命令。缺口在于用户或模型拿到明确远程 URL 时，只能退回 `bash` 运行 `curl`，这会绕过工具级 URL 校验、redirect 处理、内容类型判断和输出预算。

`web_fetch` 是第一个默认网络工具，因此设计重点不是“能否发 HTTP 请求”，而是把网络访问限制在清晰、可测试、输出有界的读取语义里。第一版把它定义成“远程 read_files”：读取一个明确 HTTP(S) URL，并把支持的文本/HTML 内容投影成有限文本。

## Goals / Non-Goals

**Goals:**

- 提供默认注册的 `web_fetch` function tool，用于读取一个明确 HTTP(S) URL 的远程内容。
- 对 URL、redirect、timeout、body bytes、输出 bytes 和 line pagination 建立明确边界。
- 支持文本类响应和轻量 HTML-to-text 投影，让模型能理解常见文档页面。
- 对 HTTP 错误、网络失败、超时、redirect 超限、危险 URL、非文本媒体返回明确 tool failure 或 unsupported 结果。
- 不新增运行时 npm 依赖，不扩展第一版用户配置。

**Non-Goals:**

- 不提供 web search；模型必须已有明确 URL。
- 不做浏览器渲染、JS 执行、DOM 完整解析、CSS 处理或截图。
- 不支持自定义 headers、cookies、认证、POST、文件上传或文件下载。
- 不支持批量 URL 抓取、缓存、离线镜像或站点爬取。
- 不承诺强沙箱级 SSRF 防护；第一版只做工具边界内的明确危险目标拒绝。

## Decisions

### 1. `web_fetch` 是远程内容读取工具，不是搜索或浏览器

工具只接收一个明确 URL，返回该 URL 的 bounded 文本投影。搜索、URL 发现、认证网页、动态渲染网页都不在本次范围内。

备选方案是做更接近浏览器的抓取器或加 `query` 参数。这样会把搜索、排序、摘要和浏览器执行混进工具边界，难以测试也更难控制安全风险，因此不采用。

### 2. 使用 strict schema 的 nullable 分页字段

schema 使用现有工具约定：所有 properties 都列入 `required`，可选语义通过 `null` 表示。第一版字段为 `url`、`offset`、`limit`。`offset` / `limit` 对最终文本投影生效，语义与 `read_files` 文本分页保持一致。

备选方案是加入 `prompt`、`headers`、`method`、`max_bytes` 等字段。第一版不加入这些字段，避免模型把工具误解成分析器、认证客户端或任意 HTTP 客户端。

### 3. 使用 Node 内建 fetch 和 manual redirect

实现 SHALL 使用 Node.js 内建网络能力，避免新增依赖。请求使用 manual redirect；每次 redirect 都解析 `Location`、重新校验 URL、递增 redirect count，超过上限返回失败。

备选方案是使用 `http` / `https` 模块加自定义 DNS lookup 做更强 IP 校验。这能加强 SSRF 边界，但代码复杂度明显更高；考虑项目当前已有 bash 工具且不是强沙箱产品，第一版先用 URL/host 层拒绝明显危险目标，后续如需要更强安全再单独升级 transport。

### 4. URL 安全先拒绝明显危险目标

handler SHALL 只允许 absolute `http:` / `https:` URL，拒绝 credentials、空 host、过长 URL、localhost、loopback、link-local、metadata IP、unspecified 和 multicast 这类明显危险目标。redirect 目标也 SHALL 重新执行相同校验。

第一版不支持模型传入自定义 headers、cookies 或认证 token，因此避免把凭据放入 transcript 或 provider continuation。工具可以设置固定 `User-Agent` 和 `Accept`，但这些不由模型控制。

### 5. 内容处理分为文本、HTML 和 unsupported

`text/*`、JSON、XML、JavaScript 等文本类响应按 UTF-8 文本处理；`text/html` 先做轻量 HTML-to-text：移除 script/style 等无正文标签，把常见 block 标签转为换行，去标签，解码常见 HTML entities，并折叠多余空白。

图片、PDF、压缩包、音视频和其他非文本媒体不输出原始 body，只返回 status、content-type 等 metadata 和 unsupported 说明。这样避免二进制内容污染 transcript 和 provider input。

### 6. 截断使用内置常量而不是用户配置

第一版使用 handler 内置常量，例如 timeout、max response bytes、max output bytes、max redirects。它们和 `read_files` / `apply_patch` 的内置限制一致，避免扩展 `~/.echo/config.json` 复杂度。

如果后续用户确实需要调节这些值，可以另起 change 添加 `tools.webFetch` 配置，但本次不做。

## Risks / Trade-offs

- [Risk] URL/host 校验不是完整 SSRF 沙箱 → Mitigation: 第一版明确拒绝 localhost、loopback、link-local、metadata 和 credentials；redirect 后重复校验；不支持 headers/cookies/auth；文档说明该工具不是网络沙箱。
- [Risk] fetch 自动解压或平台网络行为可能带来响应大小差异 → Mitigation: handler 对读取后的 body bytes 和最终输出 bytes 都做上限，并在超限时截断或失败。
- [Risk] 轻量 HTML-to-text 会丢失复杂页面结构 → Mitigation: 第一版只承诺可读文本投影，不承诺浏览器级渲染；复杂网页可由模型要求用户提供更明确文本资源。
- [Risk] 默认暴露网络访问会扩大模型能力边界 → Mitigation: 只支持明确 URL 的 GET；不支持搜索、认证和自定义 headers；system prompt 引导仅在需要读取明确远程 URL 时使用。
- [Risk] README 当前工具说明已经滞后于实际默认工具 → Mitigation: 本次文档任务同步默认工具列表和 web_fetch 风险说明。

## Migration Plan

新增工具默认注册后无需用户迁移。若实现出现问题，可以从默认 registry 和 system prompt 移除 `web_fetch`；已有 transcript 中的历史 `tool_call` / `tool_result` 仍按通用记录类型显示和持久化。

## Open Questions

无。第一版按明确 URL 的 bounded 文本读取工具实现；web search、认证抓取、缓存、PDF 解析和强 SSRF transport 后续如有需求再单独讨论。

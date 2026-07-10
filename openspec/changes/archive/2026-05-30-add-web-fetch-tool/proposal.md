## Why

当前默认工具已经覆盖本地文件发现、搜索、读取和编辑，但模型遇到用户给出的远程 URL 时仍需要退回 `bash` 执行 `curl` 等自由命令。新增 `web_fetch` 可以把“读取一个明确远程 URL 的文本内容”收敛到受限、可测试、输出有界的工具边界。

这个 change 让远程文档/网页读取成为一等工具能力，同时避免第一版就引入搜索、浏览器渲染、认证或任意 header 等高风险范围。

## What Changes

- 新增默认本地工具 `web_fetch`，按明确的 HTTP(S) URL 获取远程内容，并返回受限文本结果。
- `web_fetch` 只支持单个 URL 的 GET 请求；不支持 web search、浏览器 JS 渲染、自定义 headers、cookies、认证、文件下载或多 URL 批量抓取。
- `web_fetch` 对 URL 做安全校验：仅允许 absolute `http` / `https` URL，拒绝 credentials、空 host、localhost、loopback、link-local、metadata 等明显危险目标，并在每次 redirect 后重新校验。
- `web_fetch` 支持有限 redirect、timeout、响应 body byte cap、输出 byte cap 和基于最终文本的 `offset` / `limit` 行分页。
- `web_fetch` 支持文本类响应和轻量 HTML-to-text 投影；图片、PDF、压缩包等非文本媒体只返回 metadata 和 unsupported 错误，不输出二进制内容。
- 默认 tool registry 暴露 `web_fetch`，真实 OpenAI 请求可发送该 function tool schema。
- 内置 system prompt 引导模型在读取明确远程 URL 内容时优先使用 `web_fetch`，而不是普通 bash 网络命令。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-tool-execution`: 增加 `web_fetch` 远程内容读取工具的输入、URL 安全、网络执行、内容投影、分页、截断和错误语义。
- `streaming-llm-service-adapter`: 默认真实 agent 的工具暴露和内置提示词增加 `web_fetch` 使用边界。

## Impact

- 影响 `src/tools/`：新增 web_fetch handler，并接入默认 tool registry。
- 影响 `src/agent/system-prompt.ts`：更新默认工具使用提示。
- 影响测试：新增 URL 校验、redirect、timeout、内容类型、HTML 文本化、分页和截断覆盖。
- 影响文档和 OpenSpec：同步本地工具架构说明、README 默认工具说明和相关 capability delta。
- 不新增运行时 npm 依赖；第一版使用 Node.js 内建网络能力和内置常量限制，不扩展 `~/.echo/config.json` 工具配置。

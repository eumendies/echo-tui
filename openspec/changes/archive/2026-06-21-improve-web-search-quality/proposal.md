## Why

当前 `web_search` 在多词查询、中文实体查询和技术文档查询中容易返回只匹配第一个词的低相关结果，例如 `Echo TUI GitHub` 返回 echo 词典/百科，`OpenAI Responses API tools` 返回 OpenAI 首页和社交主页。工具现在只要解析到自然结果就视为成功，缺少 query 编码兼容性保护、结果质量判断和低质量自动重搜能力。

## What Changes

- 修正 `web_search` 构造公共搜索页 URL 时的 multi-term query 编码，确保空格分隔的 query 不会在公共搜索页链路中退化为只搜索第一个 token。
- 为搜索结果增加确定性的相关性质量评估，识别 query token 缺失和显式 `site:` host 不匹配等明显低质量结果。
- 当搜索页无结果、被拦截/不可解析，或结果质量低时，使用 provider fallback；Bing 质量仍低时再尝试 DuckDuckGo HTML fallback。
- 对多次尝试的结果做 URL 去重、相关性排序，并在 tool result 文本中输出 attempts、quality、matched/missing terms 等质量 metadata。
- 保持 `web_search` 的运行边界：不使用官方搜索 API、登录态、cookies、浏览器自动化、代理池、反爬绕过或 LLM 评估。

## Capabilities

### New Capabilities

### Modified Capabilities
- `local-tool-execution`: 更新 `web_search` 本地工具的查询编码、质量评估、重搜、结果合并和 metadata 输出要求。

## Impact

- 主要影响 `src/tools/web-search/` 和对应测试。
- 需要新增或扩展 `web_search` 测试，覆盖 `%20` query 编码、token 缺失重试、相关结果不重试、中文查询、DuckDuckGo fallback 和 blocked/parse failure 后续尝试。
- 不改变工具 schema、工具名称、registry 注册方式或 agent loop 的 tool result 结构；只增强 result 文本内容和内部搜索策略。

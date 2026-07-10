## Context

`web_search` 目前通过抓取 Bing public HTML 搜索页提供无 API key 的 best-effort 搜索。实际测试样本显示，多词 query 在 public page 链路中容易表现为“只按第一个 token 搜索”，例如 `Echo TUI GitHub` 返回 echo 词典/百科，`OpenAI Responses API tools` 返回 OpenAI 泛主页。当前实现只要解析到自然结果就返回 `ok: true`，没有判断结果是否覆盖 query 的关键限定词，也不会在低质量结果时重搜。

约束条件：该工具仍必须保持无 API key、无登录态、无 cookies、无浏览器自动化、无代理池和无反爬绕过；质量判断应是确定性启发式，不能依赖 LLM judge 或外部新服务。

## Goals / Non-Goals

**Goals:**

- 保留 multi-term query 语义，避免空格分词查询退化为首 token 搜索。
- 对解析出的自然结果做确定性相关性评分，识别 query token 缺失或显式 `site:` host 不匹配的结果集。
- 对空结果、被拦截/不可解析页面或低质量结果执行 provider fallback。
- 合并多次尝试中的候选结果，按 URL 去重，并优先返回更相关的结果。
- 在 tool result 文本中暴露 attempts、quality、matched/missing terms 等 metadata，帮助模型判断搜索结果可信度。
- 增加单元测试覆盖编码、重试、质量门禁、中文 query 和最大尝试次数。

**Non-Goals:**

- 不引入官方搜索 API、浏览器自动化、代理、cookies 或登录态。
- 不用 LLM 对结果做相关性评估。
- 不实现完整搜索引擎或复杂中文分词；中文只做轻量 token 提取和局部短语保留。
- 不改变 `web_search` 的 tool schema、tool name、registry 注册方式或 `ToolExecutionResult` 类型。
- 不承诺所有 public web 搜索都准确；低质量时应明确标注，而不是假装高质量。

## Decisions

### 1. query 参数使用严格百分号编码

`URLSearchParams` 会把空格编码成 `+`。虽然这符合表单编码语义，但 public HTML 搜索页在实际样本中表现出 multi-term query 退化问题。实现将对 `q` 参数使用 `encodeURIComponent`，使空格编码为 `%20`，其他参数继续受控拼接。

替代方案是保留 `URLSearchParams` 并依赖 Bing 正常解析 `+`，但这与样本观察冲突；另一个方案是只在测试中接受 `+`，无法解决真实召回问题。

### 2. 结果质量由确定性 token coverage 评估

从 query 按结构提取 tokens：英文/数字 token、中文连续片段和显式 `site:` host，不内置业务词、站点词或意图词表。每条结果用 title、snippet 和 URL 归一化文本计算 token 命中覆盖率。

结果集质量判断重点识别：

- `missing-terms`：query token 在所有结果中都未出现。
- `required-host-mismatch`：query 明确包含 `site:` host，但结果 URL host 不匹配。

质量通过条件保持简单：有结果、query tokens 均被覆盖，且未触发显式 `site:` host mismatch。不引入复杂排序模型或样本特化规则。

### 3. 原始 query + provider fallback

每次搜索只使用调用方传入的原始 query，不自动生成短语、`site:` 或领域术语变体。query 通常由大模型生成，额外自动改写缺少稳定收益证据，且可能收窄或污染召回。

只有当前一次无可用结果、页面失败可继续尝试，或质量不达标时才进入 provider fallback。达到 acceptable quality 后停止远程请求，避免不必要的网络访问。

### 4. 多次尝试结果合并与 metadata 输出

候选结果按规范化 URL 去重，保留较高 relevance score 的版本。最终排序优先 relevance score，再保留 attempt 顺序作为 tie-breaker。输出新增 metadata：

- `attempts`
- `quality: acceptable | low`
- `quality_score`
- `matched_query_terms`
- `missing_query_terms`

如果 Bing 原始 query 尝试后仍低质量，再尝试 DuckDuckGo HTML fallback。若仍低质量但有结果，返回 `ok: true` 并标注 `quality: low`；如果全部尝试都网络失败、blocked 或解析失败且没有可用结果，则返回 `ok: false`，失败原因包含最终或汇总原因。

## Risks / Trade-offs

- [Risk] 启发式质量判断误判，导致不必要重搜 → 只在明显低质量场景重试，并将最大尝试次数限制为 3。
- [Risk] query variant 过窄降低召回 → variant 只基于原 query 加强，不删除原 token；最终可合并多次尝试结果。
- [Risk] 中文 token 处理不足 → 不引入分词库，先覆盖“中文连续短语 + 英文产品词 + 官方文档/官网/文档”这类高价值场景。
- [Risk] public Bing HTML 结构继续变化 → 保持现有解析失败处理，重试不做反爬绕过；测试使用 fixture 锁定内部逻辑。
- [Risk] 输出 metadata 增加文本长度 → 继续受 `maxTotalOutputBytes` 约束，必要时截断。

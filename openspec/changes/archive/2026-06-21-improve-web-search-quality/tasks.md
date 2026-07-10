## 1. 基线与编码修复

- [x] 1.1 补充 `web_search` 测试 fixture/helpers，能够捕获 fetch URL、模拟 Bing HTML 自然结果、blocked 页面和低质量结果。
- [x] 1.2 修改 Bing 搜索 URL 构造，确保 query 参数使用严格百分号编码，空格编码为 `%20` 而不是 `+`。
- [x] 1.3 增加 multi-term query URL 编码测试，覆盖英文空格、中文和 `site:` 查询。

## 2. 质量评估

- [x] 2.1 实现 query 结构化 token 提取，覆盖英文/数字 token、中文连续短语和显式 `site:` host，不内置业务/意图词表。
- [x] 2.2 实现结果相关性评分，根据 title、snippet、url 计算 token 覆盖、matched/missing terms 和整体 quality。
- [x] 2.3 实现低质量判定，覆盖 query token 缺失和显式 `site:` host mismatch。
- [x] 2.4 增加质量评估单元测试，覆盖 `Echo TUI GitHub`、`OpenAI Responses API tools`、`Example Editor 官方文档` 等失焦样本。

## 3. 有界重搜与结果合并

- [x] 3.1 使用原始 query 执行搜索；不生成自动 query variants。
- [x] 3.2 修改 `webSearch` 执行流程，在空结果、blocked/parse failure、网络失败或低质量结果时进入下一次尝试，达到可接受质量后停止。
- [x] 3.3 合并多次尝试的候选结果，按规范化 URL 去重，并优先返回相关性更高的结果。
- [x] 3.4 增加重搜测试：相关结果不重试、token 缺失触发重试、低质量时有界重试、blocked 后续尝试成功。

## 4. 输出与验证

- [x] 4.1 更新 result 文本格式，输出 attempts、quality、quality_score、matched_query_terms 和 missing_query_terms metadata。
- [x] 4.2 增加输出格式测试，确认低质量但有结果时 `ok: true` 且标记 `quality: low`，全部失败时 `ok: false`。
- [x] 4.3 运行 `npm run typecheck` 并修复类型问题。
- [x] 4.4 运行 `npm test` 并修复测试失败。
- [x] 4.5 运行 `find bin src test -name '*.js' -exec node --check {} \;`，确认 JS 测试与脚本语法有效。

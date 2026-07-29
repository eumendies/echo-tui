## 1. web_search 结果解析与显示模型

- [x] 1.1 新增 `src/render/tool-message-renderers/web-search.ts`，定义工具名、查询参数解析和保守的成功/无结果/失败文本协议解析；非法字段或未知形状返回 fallback 信号
- [x] 1.2 将合法 HTTP(S) URL 转换为保留 hostname、path、query/fragment 的 display URL，并为 query、missing terms、失败原因和结果字段建立有界显示规则
- [x] 1.3 使用结构化 result details 解析 timeout/truncated 权威状态，确保不从 title、URL、snippet 或自然语言正文推断状态

## 2. 专属 tool message 投影

- [x] 2.1 实现 pending 与孤立 `web_search` call 投影，显示 `Web search · “<query>” · searching` 摘要并隐藏原始 arguments JSON
- [x] 2.2 实现相邻 call/result 的 pair-aware 标题和状态投影，成功、失败与 pending 调用标记复用现有 theme semantic token
- [x] 2.3 实现两行式搜索结果树、结果数量、无结果状态、失败短诊断和弱化的 `partial match`/missing terms/truncated metadata
- [x] 2.4 在既有工具结果逻辑行预算内按完整结果项分配空间，默认完整显示五条结果，超出时显示准确的省略数量
- [x] 2.5 为标题、metadata、树节点和详情行应用 safe render width 与稳定 continuation prefix，保证窄终端和宽字符内容不会产生超宽行或隐藏物理换行

## 3. Renderer 分发与安全降级

- [x] 3.1 在 `src/render/tool-message-renderer.ts` 注册 `web_search` call renderer 和 pair-aware renderer，并保持孤立 result、无效 arguments 或不可解析 result 走现有通用 fallback
- [x] 3.2 确认专属投影不修改 transcript record、tool result text、provider continuation、journal 持久化或 `web_search` handler 输出协议

## 4. 自动化测试与验证

- [x] 4.1 扩展 renderer 测试，覆盖 pending call、普通成功 pair、五条默认结果、超过预算的结果省略和 URL/path/snippet 投影
- [x] 4.2 补充 partial match、多个 missing terms、无结果、失败、timeout、truncated 和正文状态字面量不影响结构化状态的测试
- [x] 4.3 补充 malformed arguments/result fallback、非法 URL、长 query/URL/snippet、窄宽度、宽字符及每行无原始换行/不超过 safe width 的测试
- [x] 4.4 运行 `npm run typecheck`、`npm test` 和 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 4.5 向用户提供定向手动验证清单，覆盖真实/fixture 搜索的 pending、成功、partial match、失败、截断、resize 和主题切换效果

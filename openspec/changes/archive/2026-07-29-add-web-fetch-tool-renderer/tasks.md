## 1. web_fetch 参数与结果协议解析

- [x] 1.1 新增 `src/render/tool-message-renderers/web-fetch.ts`，定义工具名并保守解析 call 中的合法 HTTP(S) URL、offset 和 limit；无效参数返回 fallback 信号
- [x] 1.2 实现 display URL 生成和中间省略，保留 host、末尾 path/query 与 safe title metadata 预算
- [x] 1.3 解析完整 success/HTTP error response envelope，覆盖 status、requested/final URL、has_more、body_truncated、空正文及使用最末 closing fence 的任意正文边界
- [x] 1.4 解析简单 failure、timeout、unsupported media、输出 cap 尾注和 offloading marker；只有结构化 details 确认后才投影 timedOut/truncated 状态
- [x] 1.5 对结构化截断且缺少 closing fence 的 result 只恢复可信 header 与正文前缀，其他未知或歧义形状返回 fallback 信号

## 2. 专属标题与文档 rail 投影

- [x] 2.1 实现 pending 和孤立 call 标题 `Web fetch · <display-url> · fetching`，隐藏原始 arguments JSON 和内部字段名
- [x] 2.2 实现 pair-aware 完成标题，将 HTTP status、redirect、分页范围、more、截断、offloading、空正文和生命周期状态放在 tool call 同一逻辑标题
- [x] 2.3 实现 requested → final redirect 标题和 metadata 优先级压缩，保证长 URL 下仍保留 final URL、status、timeout/failure 与截断事实
- [x] 2.4 实现最多十个逻辑展示行的 document rail；超出时使用第十行显示省略数量，空正文不绘制 rail
- [x] 2.5 将 document rail 前缀独立固定为 `toolOutput` 语义色，正文使用 `text`，并为宽字符、空行和视觉换行维持一致 rail 与 safe render width
- [x] 2.6 实现 HTTP error 正文 rail、网络/timeout 短诊断和 unsupported media 状态，避免在明确 HTTP status 后重复无信息量的 failed 文案

## 3. Renderer 分发与事实边界

- [x] 3.1 在 `src/render/tool-message-renderer.ts` 注册 `web_fetch` call renderer 和 pair-aware renderer，并保持孤立 result、无效参数或不可解析结果走通用 fallback
- [x] 3.2 确认渲染过程不修改 transcript record、tool result text、provider continuation、offloading artifact、journal 持久化或 `web_fetch` handler/formatter

## 4. 自动化测试与验证

- [x] 4.1 扩展 renderer 测试，覆盖 pending、普通成功正文、空行、空正文、十行预算和正文省略数量
- [x] 4.2 补充 redirect、长 URL 中间省略、offset/limit 一基行号范围、has_more 和所有 metadata 保持在调用标题的测试
- [x] 4.3 补充 HTTP 404 正文、timeout、普通网络失败、unsupported media、body truncation、preview truncation 和 offloading saved 状态测试
- [x] 4.4 补充正文内 fence、marker/status 字面量不改变结构化状态、截断 envelope、malformed fallback、窄终端、宽字符、rail 统一颜色和原始记录不变性测试
- [x] 4.5 运行 `npm run typecheck`、`npm test` 和 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 4.6 向用户提供定向手动验证清单，覆盖真实/fixture fetch 的 pending、正常正文、redirect、分页、HTTP 错误、timeout、unsupported、截断、resize 和主题切换效果

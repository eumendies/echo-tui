## 1. 工具实现

- [x] 1.1 新增 `src/tools/web-fetch-tool-handler.ts`，实现 strict function schema、参数校验、URL 解析和 `WEB_FETCH_TOOL_NAME` / 默认限制常量导出。
- [x] 1.2 实现 URL 安全校验：仅允许 absolute HTTP(S)，拒绝 credentials、空 host、localhost、loopback、link-local、metadata、unspecified、multicast 和过长 URL。
- [x] 1.3 使用 Node 内建网络能力执行 GET 请求，支持 timeout、manual redirect、redirect 目标重复校验和 redirect 上限。
- [x] 1.4 实现响应读取限制：响应 body byte cap、输出 byte cap、`body_truncated` / `truncated` 状态和网络失败错误格式。
- [x] 1.5 实现内容投影：文本类响应直接读取，HTML 轻量转可读文本，非文本媒体返回 metadata 和 unsupported 说明且不输出二进制。
- [x] 1.6 实现最终文本 `offset` / `limit` 行分页和 `web_fetch:` result envelope。
- [x] 1.7 将 `web_fetch` handler 接入 `createDefaultToolRegistry`，并更新内置 system prompt 的工具使用引导。

## 2. 测试覆盖

- [x] 2.1 扩展默认 tool registry 和 OpenAI request 工具列表测试，确认 `web_fetch` 默认暴露且顺序符合预期。
- [x] 2.2 添加 `web_fetch` schema 测试，确认 strict required 字段和 nullable `offset` / `limit` 契约。
- [x] 2.3 添加 URL 校验测试，覆盖无效 URL、相对 URL、非 HTTP(S)、credentials、localhost、loopback、link-local、metadata、unspecified、multicast 和过长 URL。
- [x] 2.4 添加成功抓取测试，覆盖 text/plain、application/json、text/html 到文本投影、`offset` / `limit` 分页和 result envelope metadata。
- [x] 2.5 添加 redirect 测试，覆盖正常 redirect、redirect 后 URL 校验、redirect loop 或超过上限失败。
- [x] 2.6 添加失败和限制测试，覆盖 HTTP 非 2xx、timeout、网络错误、body cap、output cap、非文本媒体 unsupported。

## 3. 文档与验证

- [x] 3.1 更新 `docs/tui-architecture.md` 的本地工具说明，记录 `web_fetch` 的定位、输入、输出、网络边界和限制。
- [x] 3.2 更新 `docs/README.md` 的默认工具说明，移除旧的“只支持 bash / 不支持 web tool”表述，并说明 `web_fetch` 风险边界。
- [x] 3.3 运行 OpenSpec 状态检查，确认 `add-web-fetch-tool` artifacts 可被识别为 apply-ready。
- [x] 3.4 运行 `npm run typecheck`。
- [x] 3.5 运行 `npm test`。
- [x] 3.6 运行 `find bin src test -name '*.js' -exec node --check {} \;`。

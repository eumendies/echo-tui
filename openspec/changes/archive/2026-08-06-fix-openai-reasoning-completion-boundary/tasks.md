## 1. OpenAI Responses 完成边界

- [x] 1.1 调整 Responses stream reader，使 reasoning `response.output_item.done` 只校正累计 draft，并仅在成功收到 `response.completed` 后发送一次完整 complete
- [x] 1.2 确认失败、取消、不完整结束和缺少 `response.completed` 的路径不会提交 transient reasoning draft
- [x] 1.3 确认复用 Responses stream reader 的 Codex adapter 保持相同完成边界且无行为回归

## 2. 自动化测试

- [x] 2.1 覆盖多个 reasoning output item 与重复 `response.output_item.done`，验证累计全文只 complete 一次且顺序晚于已交错的正文 token
- [x] 2.2 覆盖 `response.completed` 前失败、取消或不完整结束，验证没有 reasoning complete
- [x] 2.3 覆盖 reasoning complete 到达时 assistant 正文 pending 已存在，验证 summary 落盘不清除正文 draft

## 3. 文档与验证

- [x] 3.1 更新 `docs/tui-architecture.md`，说明 `output_item.done` 校正预览、`response.completed` 唯一提交累计摘要，以及正文交错语义
- [x] 3.2 运行 `npm run typecheck`、`npm test` 和 JavaScript 批量语法检查

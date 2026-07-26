## 1. /hooks surface 交互改进

- [x] 1.1 扩展 hooks command session 数据与 surface 类型，加入 command 横向查看位置，并在切换 event、entry、编辑态或退出 detail 时重置。
- [x] 1.2 在 entryDetail 的 command 焦点行处理 Left/Right/Home/End 横向查看事件，确保只改变可见窗口、不修改 command 草稿。
- [x] 1.3 更新 hooks surface 渲染，让长 command 按横向查看位置显示窗口，并用省略号表达左侧或右侧隐藏内容。
- [x] 1.4 将 entries 层列表扩展为 entry/action rows，加入 `Save changes` action row，并让 Enter 在该行触发保存。
- [x] 1.5 将 entryDetail 动作区加入 `Save changes` action row，并让 Enter 在该行触发保存。
- [x] 1.6 移除 `s` 快捷保存语义与相关 hint 文案，确保按 `s` 不保存、不 reload、不关闭 hooks session。
- [x] 1.7 为 command 编辑态加入可移动光标与跟随光标的单行窗口，支持 Left/Right/Home/End、当前位置插入、Backspace 和 Delete。
- [x] 1.8 移除 `a` 添加快捷键，在 entries 中加入“添加 Hook”操作行，并将新增的普通 UI 文案统一为中文。

## 2. lifecycle hook event 扩展

- [x] 2.1 扩展 lifecycle hook event 常量、payload 类型和 synthetic payload 构造，加入 `tool_approval_request`、`tool_approval_response`、`user_question_request`、`user_question_response`。
- [x] 2.2 在 agent loop runtime 的 tool approval 流程中派发 request/response hook，payload 包含 tool 上下文、preview、decision、feedback 文本和 command 级授权文本。
- [x] 2.3 在 agent loop runtime 的 `ask_user_questions` 流程中派发 request/response hook，payload 包含问题上下文、ok 状态、答案/结果文本和可解析的 answer count。
- [x] 2.4 确保新增 hook 事件覆盖 interactive 与 headless 路径，且 hook 失败、超时或输出不会改变授权决策、用户答案、tool result 或 transcript。
- [x] 2.5 更新用户 bootstrap 文档中的 supported events 与 payload 说明。
- [x] 2.6 命中 allow-all、tool 级或 command 级会话授权缓存时不派发 approval interaction hooks，避免把自动放行误报为等待审批。

## 3. 测试与验证

- [x] 3.1 更新 `/hooks` command handler 和 renderer 测试，覆盖长 command 横向查看、entries/detail 保存 action row，以及 `s` 不再保存。
- [x] 3.2 更新 lifecycle hooks 相关测试，覆盖新增 event 配置读取、synthetic payload、tool approval request/response 和 user question request/response 派发。
- [x] 3.3 运行 `npm run typecheck`。
- [x] 3.4 运行 `npm test`。
- [x] 3.5 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`。
- [x] 3.6 运行 `npx openspec validate improve-hook-surface-and-events --strict` 和 `git diff --check`。

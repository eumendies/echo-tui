## 1. Mode transition 状态与消息构造

- [x] 1.1 定义 normal/plan 模型可见 mode、结构化 `modeTransition` metadata 和纯函数式 user message 包装格式，分别覆盖进入 plan 与返回 normal 的指令文本
- [x] 1.2 在 app state 中维护上一条已提交给 agent 的 mode，默认使用 normal，并只在真实 agent user record 创建时更新
- [x] 1.3 在 session load、transcript clear 和 undo 截断后，根据剩余 user records 的 `interactionMode` 重建上一条模型可见 mode；缺少有效元数据时回退到 normal

## 2. User turn 提交流程

- [x] 2.1 在 assistant turn 提交边界比较当前 mode 与上一条模型可见 mode，仅在发生有效 normal/plan 切换时包装 provider-facing user text
- [x] 2.2 为切换消息保留用户原始 `displayText`、composer `historyText`、附件和既有 workflow/skill metadata，确保文件 mention 展开后的请求仍完整发送给 provider
- [x] 2.3 确保 shell/shell-local 本地命令和未提交给 agent 的多次 UI mode 切换不推进上一条模型可见 mode

## 3. Runtime context 调整

- [x] 3.1 从 provider runtime context suffix 中移除 Plan Mode section 和对应动态 prompt，仅保留 open todo 状态的动态注入
- [x] 3.2 保留 agent session interaction mode 在工具风险分类、usage、debug 和 lifecycle hook 中的现有用途
- [x] 3.3 确认 mode transition user records 按普通 user records 参与 provider adapter 转换、session 持久化、resume 和 context compaction

## 4. 自动化测试

- [x] 4.1 添加进入 plan、退出 plan、同 mode 连续提交和未提交多次切换的 user record 测试，断言 `text`、`displayText`、`interactionMode` 与 `modeTransition` metadata
- [x] 4.2 添加 shell/shell-local、session resume、transcript clear 和 undo 后模型可见 mode 重建测试
- [x] 4.3 添加 transcript 渲染和输入历史测试，确认内部 mode prompt 不出现在 UI 或 composer 历史中
- [x] 4.4 更新 agent runtime context 测试，确认 plan mode 不再产生动态 mode suffix，而 todo suffix 在 normal/plan 下继续工作
- [x] 4.5 保留并补充 plan 写工具拒绝与 normal 写工具审批测试，确认提示注入变化不影响 runtime 安全边界

## 5. 文档与验证

- [x] 5.1 更新架构文档中 interaction mode、user record 双文本投影和 runtime suffix 的说明
- [x] 5.2 运行 `npm run typecheck`
- [x] 5.3 运行 `npm test`
- [x] 5.4 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 5.5 手动验证 Tab 与 `/mode` 的 plan→normal→plan 切换、隐藏 prompt 渲染、todo continuation、apply-patch 审批和 restart + `/resume` 行为
